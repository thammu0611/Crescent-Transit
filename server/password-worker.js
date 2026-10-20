// Runs bcrypt off the main thread (server/passwords.js).
import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

parentPort.on('message', async ({ id, op, a, b }) => {
  try {
    const result = op === 'hash' ? await bcrypt.hash(a, b) : await bcrypt.compare(a, b);
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
