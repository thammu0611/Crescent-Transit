import fs from 'node:fs';
import bcrypt from 'bcryptjs';

/** Driver login names are derived from the route code: route 104A -> drv104a. */
export const driverUsername = (routeCode) => `drv${routeCode.toLowerCase()}`;

/**
 * Load the BSACIST 2026-27 timetable into an empty database: one bus and one
 * driver account per route, plus an administrator. Does nothing if routes exist.
 */
export async function seedIfEmpty(db, config) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM routes');
  if (rows[0].n > 0) return false;

  const dataset = JSON.parse(fs.readFileSync(config.datasetPath, 'utf8'));
  const passwordHash = await bcrypt.hash(config.demoPassword, 10);

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, 'admin')`,
      ['admin', passwordHash, 'Transport Administrator'],
    );

    for (const r of dataset.routes) {
      const route = await tx.query(
        `INSERT INTO routes (code, name, start_point, end_point, departure_time, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [r.code, r.name, r.start_point, r.end_point, r.departure_time, r.duration_minutes],
      );
      const routeId = route.rows[0].id;

      for (const s of r.stops) {
        await tx.query(
          `INSERT INTO stops (route_id, seq, name, lat, lng, scheduled_time, offset_minutes, geo_source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [routeId, s.sequence, s.name, s.latitude, s.longitude, s.arrival_time, s.offset_minutes, s.geo_source],
        );
      }

      const bus = await tx.query(
        `INSERT INTO buses (fleet_code, route_id, bus_type, capacity, is_ac)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [r.bus.fleet_code, routeId, r.bus.bus_type, r.bus.capacity, r.bus.is_ac],
      );

      await tx.query(
        `INSERT INTO users (username, password_hash, full_name, role, bus_id) VALUES ($1, $2, $3, 'driver', $4)`,
        [driverUsername(r.code), passwordHash, r.bus.driver_name, bus.rows[0].id],
      );
    }
  });
  return true;
}

// The price lives in a database row, not in the code (doc 8.2).
const PLANS = [
  ['MONTHLY_60', 'Monthly - Rs 60', 6000, 30],
  ['TERM_300', 'Five months - Rs 300', 30000, 150],
  ['YEAR_600', 'Academic year - Rs 600', 60000, 300],
];

// Demo students ride the routes the simulator drives (npm run simulate).
const DEMO_ROUTES = ['118', '119', '117', '127'];
const DEPARTMENTS = ['CSE', 'ECE', 'MECH', 'CA', 'IT', 'EEE'];
const FIRST = ['Aarav', 'Diya', 'Farhan', 'Kavya', 'Nila', 'Rahul', 'Sana', 'Vikram', 'Meera', 'Arjun', 'Zara', 'Karthik'];
const LAST = ['Kumar', 'Iyer', 'Basha', 'Nair', 'Raj', 'Fathima', 'Menon', 'Das'];

/**
 * Seed what revision 2 of the design adds, on every start (idempotent):
 * subscription plans, a finance officer, and - once - a set of demo student
 * accounts, three in four of them with a paid subscription (paid through the
 * built-in test gateway so both ledgers agree for reconciliation).
 */
export async function seedModules(db, config) {
  for (const [code, name, paise, days] of PLANS) {
    await db.query(
      `INSERT INTO subscription_plans (plan_code, display_name, amount_paise, duration_days) VALUES ($1, $2, $3, $4)
       ON CONFLICT (plan_code) DO NOTHING`,
      [code, name, paise, days],
    );
  }
  const passwordHash = await bcrypt.hash(config.demoPassword, 10);
  await db.query(
    `INSERT INTO users (username, password_hash, full_name, role) VALUES ('finance', $1, 'Finance Officer', 'finance')
     ON CONFLICT (username) DO NOTHING`,
    [passwordHash],
  );
  const { rows: notices } = await db.query('SELECT count(*)::int AS n FROM notifications');
  if (notices[0].n === 0) {
    await db.query(
      `INSERT INTO notifications (kind, title, message) VALUES
       ('ANNOUNCEMENT', 'Welcome to the live bus tracker', 'Route list, stops and timetable are free for everyone. Live tracking, arrival estimates, alerts and automatic attendance need the Rs 60 monthly subscription.'),
       ('ANNOUNCEMENT', 'Evening departure', 'All buses leave the campus at 4.30 PM.')`,
    );
  }

  const { rows: students } = await db.query(`SELECT count(*)::int AS n FROM users WHERE role = 'student'`);
  if (!config.seedDemoStudents || students[0].n > 0) return false;

  const { rows: plan } = await db.query(`SELECT plan_id, amount_paise, duration_days FROM subscription_plans WHERE plan_code = 'MONTHLY_60'`);
  await db.transaction(async (tx) => {
    let n = 0;
    for (const code of DEMO_ROUTES) {
      const route = (await tx.query('SELECT id FROM routes WHERE code = $1', [code])).rows[0];
      if (!route) continue;
      const stopCount = (await tx.query('SELECT count(*)::int AS n FROM stops WHERE route_id = $1', [route.id])).rows[0].n;
      for (let i = 0; i < 6; i++) {
        n += 1;
        const username = `stu${String(n).padStart(3, '0')}`;
        const subscribed = i < 5 - (n % 2); // 4 or 5 of every 6
        const user = await tx.query(
          `INSERT INTO users (username, password_hash, full_name, role, email, register_no, department,
                              home_route_id, home_stop_seq, location_consent, consent_at)
           VALUES ($1, $2, $3, 'student', $4, $5, $6, $7, $8, $9, CASE WHEN $9 THEN now() END) RETURNING id`,
          [
            username, passwordHash,
            `${FIRST[n % FIRST.length]} ${LAST[(n * 3) % LAST.length]}`,
            `${username}@students.example.edu`,
            `2026${DEPARTMENTS[n % DEPARTMENTS.length]}${String(100 + n)}`,
            DEPARTMENTS[n % DEPARTMENTS.length],
            route.id,
            Math.max(1, Math.round(((i + 1) / 7) * stopCount)),
            subscribed,
          ],
        );
        if (!subscribed) continue;
        // Paid 1-20 days ago through the test gateway.
        const daysAgo = 1 + ((n * 7) % 20);
        const paidAt = new Date(Date.now() - daysAgo * 86400000);
        const validFrom = paidAt.toISOString().slice(0, 10);
        const validTo = new Date(paidAt.getTime() + (plan[0].duration_days - 1) * 86400000).toISOString().slice(0, 10);
        const orderId = `order_seed_${username}`;
        const payId = `pay_seed_${username}`;
        await tx.query(`INSERT INTO mock_gateway_orders (id, amount_paise, status, created_at) VALUES ($1, $2, 'paid', $3)`, [orderId, plan[0].amount_paise, paidAt]);
        await tx.query(
          `INSERT INTO mock_gateway_payments (id, order_id, amount_paise, method, status, created_at) VALUES ($1, $2, $3, 'upi', 'captured', $4)`,
          [payId, orderId, plan[0].amount_paise, paidAt],
        );
        const sub = await tx.query(
          `INSERT INTO subscriptions (user_id, plan_id, status, valid_from, valid_to, created_at)
           VALUES ($1, $2, 'ACTIVE', $3, $4, $5) RETURNING subscription_id`,
          [user.rows[0].id, plan[0].plan_id, validFrom, validTo, paidAt],
        );
        const pay = await tx.query(
          `INSERT INTO payments (subscription_id, user_id, plan_id, gateway, gateway_order_id, gateway_payment_id, idempotency_key,
                                 amount_paise, method, status, signature_verified, confirmed_by, paid_at, created_at)
           VALUES ($1, $2, $3, 'MOCK', $4, $5, $6, $7, 'UPI', 'CAPTURED', TRUE, 'WEBHOOK', $8, $8) RETURNING payment_id`,
          [sub.rows[0].subscription_id, user.rows[0].id, plan[0].plan_id, orderId, payId, `seed-${username}`, plan[0].amount_paise, paidAt],
        );
        await tx.query('UPDATE payments SET receipt_no = $2 WHERE payment_id = $1', [
          pay.rows[0].payment_id,
          `UBTS-${validFrom.slice(0, 7).replace('-', '')}-${String(pay.rows[0].payment_id).padStart(6, '0')}`,
        ]);
      }
    }
  });
  return true;
}
