// Teltonika FMB / FMC trackers over TCP, Codec 8 and Codec 8 Extended.
//
//   1. Tracker sends its IMEI: length(2) + 15 ASCII digits. We answer 01
//      (accepted) or 00 (refused).
//   2. Then AVL packets: 00000000 | data length(4) | codec | count | records |
//      count | CRC-16/IBM(4). We answer the number of records (4 bytes); a
//      tracker that gets no answer sends the same records again.

export const CODEC_8 = 0x08;
export const CODEC_8E = 0x8e;

// IO element ids used here (FMB/FMC parameter list).
const IO_IGNITION = 239;
const IO_EXTERNAL_VOLTAGE = 66; // mV
const IO_BATTERY_VOLTAGE = 67; // mV
const IO_GSM_SIGNAL = 21; // 0-5

/** CRC-16/IBM (ARC), as in the AVL packet trailer. */
export function crc16ibm(buf) {
  let crc = 0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** The IMEI greeting, or null while incomplete. Throws on bytes that cannot be one. */
export function readImei(buffer) {
  if (buffer.length < 2) return null;
  const len = buffer.readUInt16BE(0);
  if (len < 8 || len > 20) throw new Error('not a Teltonika IMEI greeting');
  if (buffer.length < 2 + len) return null;
  const imei = buffer.subarray(2, 2 + len).toString('ascii');
  if (!/^\d+$/.test(imei)) throw new Error('not a Teltonika IMEI greeting');
  return { imei, consumed: 2 + len };
}

/**
 * One AVL packet from the front of the buffer, or null while incomplete.
 * Returns { codec, records, crcOk, consumed }. Throws on a broken frame.
 */
export function readPacket(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.readUInt32BE(0) !== 0) throw new Error('missing AVL preamble');
  const dataLength = buffer.readUInt32BE(4);
  if (dataLength < 3 || dataLength > 1 << 20) throw new Error('bad AVL data length');
  const total = 8 + dataLength + 4;
  if (buffer.length < total) return null;
  const data = buffer.subarray(8, 8 + dataLength);
  const crcOk = crc16ibm(data) === buffer.readUInt32BE(8 + dataLength);
  const codec = data[0];
  const count = data[1];
  const records = [];
  if (codec === CODEC_8 || codec === CODEC_8E) {
    let at = 2;
    for (let i = 0; i < count; i++) {
      const { record, next } = readRecord(data, at, codec === CODEC_8E);
      records.push(record);
      at = next;
    }
    if (data[at] !== count) throw new Error('AVL record count mismatch');
  }
  return { codec, count, records, crcOk, consumed: total };
}

function readRecord(data, start, extended) {
  let at = start;
  const time = Number(data.readBigUInt64BE(at));
  at += 8;
  const priority = data[at];
  at += 1;
  const lng = data.readInt32BE(at) / 1e7;
  const lat = data.readInt32BE(at + 4) / 1e7;
  const altitude = data.readInt16BE(at + 8);
  const angle = data.readUInt16BE(at + 10);
  const satellites = data[at + 12];
  const speed = data.readUInt16BE(at + 13);
  at += 15;
  const io = {};
  const num = extended ? 2 : 1; // 8E widens ids and counts to two bytes
  const readNum = (pos) => (extended ? data.readUInt16BE(pos) : data[pos]);
  at += num * 2; // event IO id + total IO count
  for (const size of [1, 2, 4, 8]) {
    const n = readNum(at);
    at += num;
    for (let k = 0; k < n; k++) {
      const id = readNum(at);
      at += num;
      io[id] = size === 8 ? Number(data.readBigUInt64BE(at)) : data.readUIntBE(at, size);
      at += size;
    }
  }
  if (extended) {
    // Variable-length elements (NX): skipped, nothing here needs them.
    const n = data.readUInt16BE(at);
    at += 2;
    for (let k = 0; k < n; k++) at += 4 + data.readUInt16BE(at + 2);
  }
  return { record: { time, priority, lat, lng, altitude, angle, satellites, speed, io }, next: at };
}

/** A record as a fix for the pipeline, plus what the tracker says about the bus. */
export function toFix(record) {
  const info = { satellites: record.satellites };
  if (record.io[IO_IGNITION] !== undefined) info.ignition = record.io[IO_IGNITION] === 1;
  if (record.io[IO_EXTERNAL_VOLTAGE] !== undefined) info.externalVoltage = record.io[IO_EXTERNAL_VOLTAGE] / 1000;
  if (record.io[IO_BATTERY_VOLTAGE] !== undefined) info.batteryVoltage = record.io[IO_BATTERY_VOLTAGE] / 1000;
  if (record.io[IO_GSM_SIGNAL] !== undefined) info.gsmSignal = record.io[IO_GSM_SIGNAL];
  return {
    fix: {
      lat: record.lat,
      lng: record.lng,
      speedKmh: record.speed,
      heading: record.angle % 360,
      recordedAt: new Date(record.time).toISOString(),
      // Without a GPS fix the tracker repeats the last position with 0 satellites.
      valid: record.satellites > 0,
    },
    info,
  };
}

/** The 4-byte acknowledgement: how many records were received. */
export function ack(count) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(count);
  return buf;
}

// ---- Encoders (the simulator and the tests play a tracker with these) -------

export function encodeImei(imei) {
  const digits = Buffer.from(String(imei), 'ascii');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(digits.length);
  return Buffer.concat([len, digits]);
}

/** A Codec 8 packet with one record per position. */
export function encodePacket(positions) {
  const records = positions.map(({ lat, lng, speedKmh = 0, heading = 0, time = new Date(), satellites = 10, ignition = true, altitude = 20 }) => {
    const r = Buffer.alloc(8 + 1 + 15);
    r.writeBigUInt64BE(BigInt(new Date(time).getTime()), 0);
    r.writeUInt8(0, 8);
    r.writeInt32BE(Math.round(lng * 1e7), 9);
    r.writeInt32BE(Math.round(lat * 1e7), 13);
    r.writeInt16BE(altitude, 17);
    r.writeUInt16BE(Math.round(heading) % 360, 19);
    r.writeUInt8(satellites, 21);
    r.writeUInt16BE(Math.round(speedKmh), 22);
    // IO: event 0, total 2; one 1-byte element (ignition), one 2-byte (external voltage, mV)
    const io = Buffer.from([0x00, 0x02, 0x01, IO_IGNITION, ignition ? 1 : 0, 0x01, IO_EXTERNAL_VOLTAGE, 0x5e, 0x0f, 0x00, 0x00]);
    return Buffer.concat([r, io]);
  });
  const data = Buffer.concat([Buffer.from([CODEC_8, positions.length]), ...records, Buffer.from([positions.length])]);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc16ibm(data));
  return Buffer.concat([head, data, crc]);
}
