# Module 1 — Source Code Walkthrough

Use this to explain the code in the review. Follow one GPS fix from the
driver's phone to the student's map. File references are `file:line`.

---

## 0. The idea in one sentence

Every GPS fix goes through **one** path — *authenticate ➜ validate ➜ store ➜
broadcast* — and the live map only ever shows what survived that path, labelled
with how old it is.

## 1. Database — `server/schema.sql`

Seven tables:

| Table | Why it exists |
|---|---|
| `routes`, `stops`, `buses` | The BSACIST timetable: 28 routes, 395 ordered boarding points, one bus per route. |
| `users` | Admin / driver / student with a bcrypt password hash; a driver is linked to a bus. |
| `trips` | One run of a bus. `trips_one_active_per_bus` (line 55) is a **partial unique index**: the database itself refuses a second active trip for the same bus. |
| `location_pings` | Every accepted fix = trip history, later used to learn ETA. Indexed by `(trip_id, recorded_at)`. |
| `bus_latest` | Exactly one row per bus — the newest fix. The live map reads this, never the history. |
| `rejected_pings` | Every rejected fix with its reason, so GPS quality can be measured. |

`recorded_at` (device time) and `received_at` (server time) are both stored:
the difference is the network delay.

## 2. Database connection — `server/db.js`

`openDatabase()` returns the same small interface for two drivers:

- `DATABASE_URL` set ➜ **node-postgres** Pool (Supabase / Render in production).
- not set ➜ **PGlite**, the real PostgreSQL engine compiled to WebAssembly,
  so the demo needs no database installation. Same SQL, same schema.

`transaction(fn)` exists because a Pool gives each query a different connection;
a transaction must pin one client (`BEGIN … COMMIT`, `ROLLBACK` on error).

## 3. Seeding — `server/seed.js`

On first start, loads `data/bsacist_routes.json` inside one transaction:
routes ➜ stops ➜ bus ➜ driver account `drv<code>`. Passwords are stored only
as bcrypt hashes.

## 4. Authentication — `server/auth.js`

- `login()` (line 13): looks the user up, compares with `bcrypt.compare`, and
  returns a **JWT** containing `sub`, `role`, `busId`, valid 12 h. The same
  error text is returned for a wrong username and a wrong password, so an
  attacker cannot find out which usernames exist.
- `requireRole('driver')` (line 48): Express middleware. Reads
  `Authorization: Bearer <token>`, verifies the signature, checks the role.
  401 = no/invalid token, 403 = valid token but wrong role.

**The bus id comes from the token, not from the request body** — a driver can
only ever move their own bus.

## 5. Validation — `server/validation.js` (`validateFix`, line 46)

A pure function: same input ➜ same output, no database, so it is fully
unit-tested. Checks in order:

1. lat/lng are finite numbers within ±90 / ±180
2. not `0,0` — what phones report before a satellite lock
3. inside the **service area**: bounding box of all 395 stops + 0.25° margin
4. accuracy ≤ 100 m, speed 0–120 km/h, heading 0–360 (when sent)
5. timestamp parses, is not > 30 s in the future and not > 10 min old
6. against the previous accepted fix of the same trip:
   - must be newer (else `OUT_OF_ORDER`)
   - implied speed = haversine distance ÷ time; > 150 km/h over more than
     50 m ➜ `IMPOSSIBLE_JUMP`. Moves under 50 m are allowed: that is normal GPS jitter.

Returns `{ok:true, fix}` or `{ok:false, reason, detail}`.

## 6. The pipeline — `server/tracking.js`

`TrackingService` holds an in-memory **cache**: `busId ➜ newest snapshot`.

- `ingest()` (line 170): requests of one bus are queued so that each fix is
  compared with the fix accepted just before it (no race between two requests).
- `ingestNow()` (line 182):
  1. Accepts a single fix or a batch of up to 200 (phone was offline).
  2. Refuses with 409 if no trip is running.
  3. Sorts the batch **oldest first**, then validates each fix against the
     previous *accepted* one.
  4. Rejected ➜ row in `rejected_pings`, per-fix reason returned to the phone.
  5. Accepted ➜ in one transaction: insert into `location_pings`, **upsert**
     `bus_latest` (`ON CONFLICT (bus_id) DO UPDATE`).
  6. Only the newest accepted fix is broadcast (line 238), to rooms `all` and
     `route:<code>`, with the nearest stop added.
- `checkReanchor()` (line 153): if the last accepted fix was itself a glitch,
  every correct fix after it would look like a jump and the bus would be stuck.
  After **3 consecutive rejected jumps that agree with each other**, the new
  position is trusted.
- `startFreshnessTicker()` (line 45): every 5 s re-computes Live/Delayed/Offline
  and pushes only *changes* (`bus:freshness`).

## 7. REST + realtime — `server/app.js`

- Public read endpoints: routes, live positions, trip path, stats.
- Driver endpoints behind `requireRole('driver')`.
- `POST /api/driver/locations` (line 111) answers **202** if at least one fix
  was accepted, **422** if all were rejected.
- Socket.IO (line 137): a client emits `subscribe {route}` and immediately gets
  a `snapshot`, then `bus:location` events. Rooms mean a student watching
  route 118 does not receive route 101's traffic.

## 8. Freshness — `shared/freshness.js`

`freshnessOf(recordedAt)`: ≤ 30 s **live**, ≤ 120 s **delayed**, else **offline**.
Shared by server and browser, so both always agree. The map recomputes it every
second, so a bus turns amber even if the browser missed an event.

## 9. Driver app — `client/src/pages/DriverApp.jsx`

- Login ➜ token in `sessionStorage`.
- Location source: `navigator.geolocation.watchPosition` (line 125) with
  `enableHighAccuracy`, or **Simulate along route** (walks the stop polyline
  with `PathWalker` from `shared/geo.js`).
- Send loop `tick` (line 191): every 5/10/15 s, add the newest fix to a buffer
  and send the whole buffer. Network failure ➜ keep the buffer (max 200) and
  retry next tick as a batch. A server answer (even a rejection) empties it.
- *Test server validation* buttons (line 239) send deliberately bad fixes
  during the demo.

## 10. Student live map — `client/src/pages/LiveMap.jsx`

- Socket listeners: `snapshot`, `bus:location`, `bus:freshness`, `bus:trip-ended`.
- Sidebar: counts per state, route filter, bus cards (updated *x* s ago, speed,
  nearest stop), stop timeline with the nearest stop highlighted.
- `BusMarker.jsx`: a Leaflet marker that **glides** to each new position over
  1.2 s (`requestAnimationFrame`, ease-in-out), coloured by freshness, with a
  heading arrow.
- `RouteLayer.jsx`: route line and stops; interpolated stops drawn hollow and
  labelled *approx.*

## 11. Tests — `test/`

- `validation.test.js`: every rejection rule, jitter tolerance, freshness
  boundaries (30 s / 31 s / 120 s / 121 s), haversine, PathWalker.
- `api.test.js`: starts the real server on an in-memory PostgreSQL and checks
  seeding (28 routes / 395 stops), login, 401/403, 409 without a trip,
  accepted fix stored **and** received over Socket.IO, rejected fix **not**
  broadcast, batch ordering, re-anchoring, trip end.

`npm test` ➜ 29 passing.

## Likely viva questions

| Question | Answer |
|---|---|
| Why not write GPS straight to Firebase from the phone? | Then any client can write anything; there is no place to validate. Here the server is the only writer. |
| Why keep `bus_latest` separate from `location_pings`? | The map needs one row per bus instantly; history grows by ~65,000 rows a day (28 buses, 5 s fixes). |
| Why WebSocket and not polling? | One push per fix instead of every student asking every few seconds; measured median 19.5 ms from POST to map. |
| What if the phone loses network? | Fixes are buffered on the phone and uploaded as a batch; the map shows the bus as Delayed, then Offline with last-seen place. |
| What if GPS jumps? | Rejected as IMPOSSIBLE_JUMP; three consistent fixes re-anchor. |
| Can a driver move another bus? | No — the bus id is taken from the signed token. |
| Where does the ETA come from? | Module 2: segment travel times learned from `location_pings`, evaluated with mean absolute error per route. |
