// Password hashing on worker threads.
//
// bcrypt is deliberately slow (~100 ms of CPU per check at cost 10), and
// bcryptjs is plain JavaScript: on the main thread, a morning sign-in rush of a
// few hundred students would freeze every other request, live socket and GPS
// fix behind it. A small pool of worker threads runs the hashing in parallel
// on the other CPU cores while the main thread keeps serving.
//
// BCRYPT_WORKERS sets the pool size (default: CPU cores - 1, between 1 and 8).
import os from 'node:os';
import { Worker } from 'node:worker_threads';

const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const SIZE = Math.max(1, Number(process.env.BCRYPT_WORKERS) || Math.min(8, cores - 1));
const WORKER_FILE = new URL('./password-worker.js', import.meta.url);

let workers = null;
const queue = []; // tasks waiting for a free worker
let nextId = 0;

function spawn() {
  const worker = new Worker(WORKER_FILE);
  worker.task = null;
  worker.on('message', ({ id, result, error }) => {
    const task = worker.task;
    worker.task = null;
    done.push(performance.now());
    if (done.length > 1000) done.splice(0, done.length - 1000);
    if (task?.id === id) (error ? task.reject(new Error(error)) : task.resolve(result));
    dispatch();
    if (!worker.task) worker.unref();
  });
  worker.on('error', (err) => {
    worker.task?.reject(err);
    worker.task = null;
    worker.unref();
    // Replace a crashed worker so the pool keeps its size.
    workers[workers.indexOf(worker)] = spawn();
    dispatch();
  });
  // After the listeners: attaching a 'message' listener re-references the
  // worker. An idle pool must never keep the process alive.
  worker.unref();
  return worker;
}

// Completion times of recent checks: the measured throughput gives the wait
// estimate, which stays honest when the CPU is busy or throttled.
const RATE_WINDOW_MS = 5000;
const done = [];

function dispatch() {
  for (const worker of workers) {
    if (!queue.length) return;
    if (worker.task) continue;
    const task = queue.shift();
    worker.task = task;
    worker.ref(); // keep the process alive while a request waits on this
    worker.postMessage({ id: task.id, op: task.op, a: task.a, b: task.b });
  }
}

function run(op, a, b) {
  if (!workers) workers = Array.from({ length: SIZE }, spawn);
  return new Promise((resolve, reject) => {
    queue.push({ id: ++nextId, op, a, b, resolve, reject });
    dispatch();
  });
}

export const hashPassword = (password, rounds = 10) => run('hash', String(password), rounds);
export const comparePassword = (password, hash) => run('compare', String(password), String(hash));
export const passwordWorkers = SIZE;

// The phone app gives up on a request after 20 s: a sign-in expected to wait
// longer than this is turned away at once with "try again" instead.
const MAX_WAIT_MS = 15000;
/** Expected wait for a new password check, in ms, from the measured throughput. */
export function passwordQueueWaitMs() {
  if (!queue.length) return 0;
  const now = performance.now();
  let recent = 0;
  let oldest = now;
  for (let i = done.length - 1; i >= 0 && done[i] >= now - RATE_WINDOW_MS; i--) {
    recent += 1;
    oldest = done[i];
  }
  // Over the span the completions cover (a burst that began 2 s ago is not
  // diluted by idle time before it). Until a few checks have finished there
  // is no measurement: assume ~250 ms each.
  const perMs = recent >= SIZE ? recent / Math.max(1000, now - oldest) : SIZE / 250;
  return (queue.length + 1) / perMs;
}
/** True when so many sign-ins are queued that a new one should retry shortly. */
export const passwordQueueFull = () => passwordQueueWaitMs() > MAX_WAIT_MS;
