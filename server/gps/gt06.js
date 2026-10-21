// GT06 binary protocol over TCP: Concox and most GT06-family trackers (GT06N,
// JM-VL01/VL02, Wetrack, many unbranded units sold for school buses).
//
// Frame:  78 78 | len | protocol | content | serial(2) | CRC-ITU(2) | 0D 0A
//         79 79 | len(2) | ...                                      (long frames)
// `len` counts protocol + content + serial + CRC. The tracker logs in with its
// IMEI, then sends positions; login, heartbeat and alarm packets must be
// answered or it reconnects.

export const MSG = {
  LOGIN: 0x01,
  GPS: 0x10,
  GPS_LBS_1: 0x12,
  HEARTBEAT: 0x13,
  GPS_LBS_STATUS_1: 0x16,
  GPS_LBS_2: 0x22,
  GPS_LBS_STATUS_2: 0x26,
  GPS_4G: 0xa0,
};

const POSITION_TYPES = new Set([MSG.GPS, MSG.GPS_LBS_1, MSG.GPS_LBS_STATUS_1, MSG.GPS_LBS_2, MSG.GPS_LBS_STATUS_2, MSG.GPS_4G]);
const ANSWERED = new Set([MSG.LOGIN, MSG.HEARTBEAT, MSG.GPS_LBS_STATUS_1, MSG.GPS_LBS_STATUS_2]);

/** CRC-16/X-25 ("CRC-ITU" in the GT06 documents). */
export function crc16x25(buf) {
  let crc = 0xffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return ~crc & 0xffff;
}

/**
 * Split a byte stream into frames. Returns complete frames and the bytes left
 * over (a frame split across TCP reads). Garbage before a frame is skipped.
 */
export function splitFrames(buffer) {
  const frames = [];
  let at = 0;
  while (buffer.length - at >= 5) {
    const short = buffer[at] === 0x78 && buffer[at + 1] === 0x78;
    const long = buffer[at] === 0x79 && buffer[at + 1] === 0x79;
    if (!short && !long) {
      at += 1;
      continue;
    }
    const len = short ? buffer[at + 2] : buffer.readUInt16BE(at + 2);
    const head = short ? 3 : 4; // start bytes + length field
    const total = head + len + 2; // + 0D 0A
    if (len < 5) {
      at += 2; // too short to be a frame: not a real start
      continue;
    }
    if (buffer.length - at < total) break; // wait for the rest
    const frame = buffer.subarray(at, at + total);
    if (frame[total - 2] !== 0x0d || frame[total - 1] !== 0x0a) {
      at += 1; // a 78 78 that was not a frame start: look further
      continue;
    }
    const body = frame.subarray(2, head + len - 2); // length field .. serial
    const crc = frame.readUInt16BE(head + len - 2);
    frames.push({
      type: frame[head],
      content: frame.subarray(head + 1, head + len - 4),
      serial: frame.readUInt16BE(head + len - 4),
      crcOk: crc16x25(body) === crc,
    });
    at += total;
  }
  return { frames, rest: buffer.subarray(at) };
}

/** The 8-byte BCD terminal ID of a login packet -> 15-digit IMEI. */
export function decodeImei(content) {
  return content.subarray(0, 8).toString('hex').replace(/^0/, '');
}

/**
 * Date, satellites, position, speed and course: the block every position
 * packet starts with. Times are UTC (set the tracker to GMT, see docs).
 */
export function decodeGps(content) {
  if (content.length < 18) return null;
  const time = Date.UTC(2000 + content[0], content[1] - 1, content[2], content[3], content[4], content[5]);
  const satellites = content[6] & 0x0f;
  let lat = content.readUInt32BE(7) / 1800000; // degrees x 60 x 30000
  let lng = content.readUInt32BE(11) / 1800000;
  const speedKmh = content[15];
  const flags = content.readUInt16BE(16);
  if (!(flags & 0x0400)) lat = -lat; // bit 10: north latitude
  if (flags & 0x0800) lng = -lng; // bit 11: west longitude
  return {
    recordedAt: new Date(time).toISOString(),
    lat: Math.round(lat * 1e7) / 1e7,
    lng: Math.round(lng * 1e7) / 1e7,
    speedKmh,
    heading: flags & 0x03ff,
    valid: Boolean(flags & 0x1000), // bit 12: GPS has a fix
    satellites,
  };
}

/** Ignition and power from a terminal-information byte (heartbeat, alarm). */
function terminalInfo(byte) {
  return { ignition: Boolean(byte & 0x02), charging: Boolean(byte & 0x04) };
}

/** Turn one frame into what it means: login, position, heartbeat or other. */
export function interpret(frame) {
  const { type, content } = frame;
  if (type === MSG.LOGIN) return { kind: 'login', imei: decodeImei(content) };
  if (type === MSG.HEARTBEAT) {
    return { kind: 'heartbeat', info: { ...terminalInfo(content[0] ?? 0), voltageLevel: content[1], gsmSignal: content[2] } };
  }
  if (POSITION_TYPES.has(type)) {
    const gps = decodeGps(content);
    if (!gps) return { kind: 'other' };
    const info = { satellites: gps.satellites };
    if (type === MSG.GPS_LBS_STATUS_1 || type === MSG.GPS_LBS_STATUS_2) {
      // GPS(18) + LBS length(1) + LBS(8) + terminal info(1) + voltage(1) + GSM(1) + alarm(2)
      const status = 18 + 1 + 8;
      if (content.length > status) Object.assign(info, terminalInfo(content[status]));
    } else if (type === MSG.GPS_LBS_2 && content.length >= 18 + 8 + 1) {
      info.ignition = content[18 + 8] > 0; // ACC byte after the cell (LBS) block
    }
    return { kind: 'position', fix: gps, info };
  }
  return { kind: 'other' };
}

/** The acknowledgement a tracker waits for after login, heartbeat or alarm. */
export function reply(type, serial) {
  const body = Buffer.from([0x05, type, serial >> 8, serial & 0xff]);
  const crc = crc16x25(body);
  return Buffer.concat([Buffer.from([0x78, 0x78]), body, Buffer.from([crc >> 8, crc & 0xff, 0x0d, 0x0a])]);
}

export const needsReply = (type) => ANSWERED.has(type);

// ---- Encoders (the simulator and the tests play a tracker with these) -------

function frame(type, content, serial) {
  const len = 1 + content.length + 2 + 2;
  const body = Buffer.concat([Buffer.from([len, type]), content, Buffer.from([serial >> 8, serial & 0xff])]);
  const crc = crc16x25(body);
  return Buffer.concat([Buffer.from([0x78, 0x78]), body, Buffer.from([crc >> 8, crc & 0xff, 0x0d, 0x0a])]);
}

export function encodeLogin(imei, serial = 1) {
  return frame(MSG.LOGIN, Buffer.from(`0${imei}`.slice(-16), 'hex'), serial);
}

export function encodeHeartbeat({ ignition = true } = {}, serial = 1) {
  return frame(MSG.HEARTBEAT, Buffer.from([0x40 | (ignition ? 0x02 : 0), 0x04, 0x04, 0x00, 0x02]), serial);
}

/** A 0x22 position (GPS + cell + ignition), as GT06N-class trackers send. */
export function encodeLocation({ lat, lng, speedKmh = 0, heading = 0, time = new Date(), valid = true, satellites = 9, ignition = true }, serial = 1) {
  const t = new Date(time);
  const gps = Buffer.alloc(18);
  gps.writeUInt8(t.getUTCFullYear() - 2000, 0);
  gps.writeUInt8(t.getUTCMonth() + 1, 1);
  gps.writeUInt8(t.getUTCDate(), 2);
  gps.writeUInt8(t.getUTCHours(), 3);
  gps.writeUInt8(t.getUTCMinutes(), 4);
  gps.writeUInt8(t.getUTCSeconds(), 5);
  gps.writeUInt8(0xc0 | (satellites & 0x0f), 6);
  gps.writeUInt32BE(Math.round(Math.abs(lat) * 1800000), 7);
  gps.writeUInt32BE(Math.round(Math.abs(lng) * 1800000), 11);
  gps.writeUInt8(Math.max(0, Math.min(255, Math.round(speedKmh))), 15);
  const flags = (valid ? 0x1000 : 0) | (lng < 0 ? 0x0800 : 0) | (lat >= 0 ? 0x0400 : 0) | (Math.round(heading) % 360);
  gps.writeUInt16BE(flags, 16);
  const lbs = Buffer.from([0x01, 0x94, 0x5a, 0x00, 0x01, 0x00, 0x00, 0x01]); // MCC 404 (India), MNC 90, LAC, cell
  const tail = Buffer.from([ignition ? 1 : 0, 0x00, 0x00]); // ACC, upload reason, real-time
  return frame(MSG.GPS_LBS_2, Buffer.concat([gps, lbs, tail]), serial);
}
