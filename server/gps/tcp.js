// Raw TCP listeners for trackers that keep a connection open and speak a
// binary protocol (GT06, Teltonika). Each connection: the tracker identifies
// itself by IMEI, which must be registered and switched on in the admin
// screen; then it streams positions, which go to TrackerService.receive.
import net from 'node:net';
import * as gt06 from './gt06.js';
import * as teltonika from './teltonika.js';

const MAX_BUFFER = 64 * 1024; // a tracker never needs more than this unparsed

export function createTcpListener(protocol, trackers) {
  if (!['gt06', 'teltonika'].includes(protocol)) throw new Error(`No TCP listener for ${protocol}`);
  const server = net.createServer((socket) => session(protocol, socket, trackers));
  server.protocol = protocol;
  server.maxConnections = 5000;
  return server;
}

function session(protocol, socket, trackers) {
  const remote = (socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  let buffer = Buffer.alloc(0);
  let tracker = null; // set once the IMEI is accepted
  let chain = Promise.resolve();

  socket.setNoDelay(true);
  socket.setTimeout(trackers.config.gps.idleTimeoutS * 1000, () => socket.destroy());
  socket.on('error', () => {}); // resets and timeouts are normal for trackers on mobile data
  socket.on('close', () => {
    if (tracker) trackers.disconnected(tracker, socket);
  });

  const accept = async (imei) => {
    const found = await trackers.byUniqueId(imei);
    if (!found || !found.active) {
      if (!found) trackers.noteUnknown(imei, protocol, remote);
      return false;
    }
    tracker = { id: found.id, unique_id: found.unique_id };
    trackers.connected(tracker, socket);
    trackers.seen(tracker, { protocol, remote });
    return true;
  };

  // GT06: frames, each answered if the protocol says so.
  const onGt06 = async () => {
    const { frames, rest } = gt06.splitFrames(buffer);
    buffer = rest;
    const positions = [];
    for (const frame of frames) {
      if (!frame.crcOk) continue; // damaged on the way: the tracker sends again
      const msg = gt06.interpret(frame);
      if (msg.kind === 'login') {
        if (!(await accept(msg.imei))) {
          socket.destroy(); // unregistered or switched off: no acknowledgement
          return;
        }
        socket.write(gt06.reply(frame.type, frame.serial));
        continue;
      }
      if (!tracker) continue; // anything before a login is ignored
      if (gt06.needsReply(frame.type)) socket.write(gt06.reply(frame.type, frame.serial));
      if (msg.kind === 'heartbeat') trackers.seen(tracker, { protocol, remote, info: msg.info });
      if (msg.kind === 'position') positions.push({ fix: msg.fix, info: msg.info });
    }
    if (positions.length) await trackers.receive(tracker, positions, { protocol, remote });
  };

  // Teltonika: IMEI greeting, then AVL packets acknowledged with their record count.
  const onTeltonika = async () => {
    if (!tracker) {
      const greeting = teltonika.readImei(buffer);
      if (!greeting) return;
      buffer = buffer.subarray(greeting.consumed);
      const ok = await accept(greeting.imei);
      socket.write(Buffer.from([ok ? 0x01 : 0x00]));
      if (!ok) {
        socket.end();
        return;
      }
    }
    for (;;) {
      if (buffer[0] === 0xff) { // keep-alive byte some firmware sends
        buffer = buffer.subarray(1);
        continue;
      }
      const packet = teltonika.readPacket(buffer);
      if (!packet) return;
      buffer = buffer.subarray(packet.consumed);
      if (!packet.crcOk) continue; // no acknowledgement: the tracker sends the records again
      if (packet.codec === teltonika.CODEC_8 || packet.codec === teltonika.CODEC_8E) {
        await trackers.receive(tracker, packet.records.map(teltonika.toFix), { protocol, remote });
      } else {
        const s = trackers.seen(tracker, { protocol, remote });
        s.outcome = 'UNSUPPORTED';
        s.detail = `Codec 0x${packet.codec.toString(16)} is not read here: choose Codec 8 or 8 Extended in Teltonika Configurator`;
      }
      // Acknowledged only after the records are stored, so nothing is lost on a crash.
      socket.write(teltonika.ack(packet.count));
    }
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_BUFFER) {
      socket.destroy();
      return;
    }
    // One chunk at a time, in order: positions of one tracker must stay in sequence.
    chain = chain
      .then(() => (socket.destroyed ? null : protocol === 'gt06' ? onGt06() : onTeltonika()))
      .catch((err) => {
        if (!err.message?.startsWith('not a Teltonika') && !err.message?.includes('AVL')) console.error(`[gps] ${protocol} ${remote}:`, err.message);
        socket.destroy();
      });
  });
}
