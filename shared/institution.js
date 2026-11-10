// What makes this deployment one college's: names, campus and contacts come from
// settings (server/config.js institution), so one codebase can run a separate
// copy, with its own database, for each college (docs/GO_LIVE.md).

/** "BSACIST-118" reads as "Bus 118" whatever the college's fleet prefix is. */
export const busLabel = (fleetCode) => String(fleetCode ?? '').replace(/^[A-Za-z0-9]+-(?=[0-9])/, 'Bus ');
