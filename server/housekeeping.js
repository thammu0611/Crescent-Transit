// Nightly clean-up: personal and location data is kept only as long as the
// privacy notice says, and tables that grow every day stay a sensible size.

const BATCH = 20000;
const MAX_BATCHES = 500; // a backlog is worked through over several nights

/** Delete in batches, so a large first clean-up never holds the tables for long. */
async function deleteInBatches(db, table, key, where, params) {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i += 1) {
    const { rows } = await db.query(
      `WITH doomed AS (SELECT ${key} FROM ${table} WHERE ${where} LIMIT ${BATCH}),
            gone AS (DELETE FROM ${table} x USING doomed WHERE x.${key} = doomed.${key} RETURNING 1)
       SELECT count(*)::int AS n FROM gone`,
      params,
    );
    total += rows[0].n;
    if (rows[0].n < BATCH) break;
  }
  return total;
}

/**
 * Attendance older than the retention period is folded into monthly totals per
 * route ("then only as totals" in the privacy notice), and the records and the
 * disputes about them are removed.
 */
async function foldOldAttendance(db, days) {
  const old = `a.created_at < now() - make_interval(days => $1) AND a.locked`;
  return db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO attendance_totals (month, route_id, records, present)
       SELECT date_trunc('month', a.created_at)::date, t.route_id, count(*)::int,
              count(*) FILTER (WHERE a.status IN ('CONFIRMED', 'COMPLETED', 'ON_BOARD') OR a.adjusted_present)::int
         FROM attendance a JOIN trips t ON t.id = a.trip_id
        WHERE ${old}
        GROUP BY 1, 2
       ON CONFLICT (month, route_id) DO UPDATE
         SET records = attendance_totals.records + EXCLUDED.records,
             present = attendance_totals.present + EXCLUDED.present`,
      [days],
    );
    await tx.query(
      `DELETE FROM attendance_disputes d USING attendance a
        WHERE d.attendance_id = a.attendance_id AND ${old}`,
      [days],
    );
    await tx.query(
      `UPDATE boarding_checks b SET attendance_id = NULL FROM attendance a
        WHERE b.attendance_id = a.attendance_id AND ${old}`,
      [days],
    );
    const { rows } = await tx.query(
      `WITH gone AS (DELETE FROM attendance a WHERE ${old} RETURNING 1) SELECT count(*)::int AS n FROM gone`,
      [days],
    );
    return rows[0].n;
  });
}

export async function purgeOld(db, config) {
  const { locationDays, rejectedDays, eventDays, attendanceDays } = config.retention;
  const result = {
    locations: await deleteInBatches(db, 'location_pings', 'id', `recorded_at < now() - make_interval(days => $1)`, [locationDays]),
    rejected: await deleteInBatches(db, 'rejected_pings', 'id', `received_at < now() - make_interval(days => $1)`, [rejectedDays]),
    events: await deleteInBatches(db, 'system_events', 'id', `created_at < now() - make_interval(days => $1)`, [eventDays]),
    attendance: await foldOldAttendance(db, attendanceDays),
  };
  // One-time codes are useless once expired; nothing should keep them.
  await db.query('DELETE FROM device_otps WHERE expires_at < now()');
  await db.query('DELETE FROM email_codes WHERE expires_at < now()');
  await db.query('DELETE FROM password_resets WHERE expires_at < now()');
  await db.query('DELETE FROM guardian_codes WHERE expires_at < now()');
  await db.query(`DELETE FROM system_alerts WHERE closed_at < now() - interval '30 days'`);
  return result;
}
