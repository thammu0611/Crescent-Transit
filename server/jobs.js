// Background jobs:
//   every 15 s   attendance tick (prompt timeouts, dead trackers) and boarding
//                question reminders (every 10 min until answered)
//   every 15 min payment reconciliation (orders whose webhook never came, doc 8.5)
//   23:30 daily  nightly: lock records, auto-confirm old provisionals, expire
//                subscriptions, apply retention (doc 9.5, 9.11), expire the
//                day's unanswered boarding questions
import { localDate, localMinutes } from './clock.js';

export class JobRunner {
  constructor(db, config, { attendance, billing, boarding = null }) {
    this.db = db;
    this.config = config;
    this.attendance = attendance;
    this.billing = billing;
    this.boarding = boarding;
    this.timers = [];
    this.running = new Set();
  }

  /** Run a job by name, never two copies of the same job at once. */
  async run(name) {
    if (this.running.has(name)) return { skipped: 'already running' };
    this.running.add(name);
    try {
      let result;
      if (name === 'tick') result = { ...(await this.attendance.tick()), boarding: await this.boarding?.tick() };
      else if (name === 'reconcile') result = await this.billing.reconcilePending();
      else if (name === 'expire') result = await this.billing.expireSubscriptions();
      else if (name === 'nightly') {
        result = {
          attendance: await this.attendance.nightly(),
          subscriptions: await this.billing.expireSubscriptions(),
          boarding: await this.boarding?.nightly(),
        };
        await this.db.query(
          `INSERT INTO job_runs (job, last_run) VALUES ('nightly', now()) ON CONFLICT (job) DO UPDATE SET last_run = now()`,
        );
      } else throw new Error(`Unknown job ${name}`);
      return result;
    } finally {
      this.running.delete(name);
    }
  }

  /** Has the 23:30 job already run for today's date (campus time)? */
  async nightlyDue(now = new Date()) {
    const [h, m] = this.config.attendance.nightlyLockAt.split(':').map(Number);
    if (localMinutes(now, this.config.timeZone) < h * 60 + m) return false;
    const { rows } = await this.db.query(`SELECT last_run FROM job_runs WHERE job = 'nightly'`);
    const last = rows[0]?.last_run;
    return !last || localDate(new Date(last), this.config.timeZone) !== localDate(now, this.config.timeZone)
      || localMinutes(new Date(last), this.config.timeZone) < h * 60 + m;
  }

  start() {
    const every = (ms, fn) => {
      const t = setInterval(() => fn().catch((err) => console.error('[jobs]', err)), ms);
      t.unref?.();
      this.timers.push(t);
    };
    every(15000, () => this.run('tick'));
    every(this.config.subscription.reconcileEveryMinutes * 60000, () => this.run('reconcile'));
    every(60000, async () => {
      if (await this.nightlyDue()) {
        const r = await this.run('nightly');
        console.log('[jobs] nightly run:', JSON.stringify(r));
      }
    });
    this.run('expire').catch((err) => console.error('[jobs]', err));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
