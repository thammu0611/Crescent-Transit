# University Bus Tracking System

**Real-time GPS tracking, boarding reminders from the bus GPS, GPS-linked automatic
attendance, and online fee collection for the BSACIST transport fleet** — built to the design document
*University Bus Tracking System, Revision 2* (September 2026).

MCA Project · Department of Computer Applications ·
B.S. Abdur Rahman Crescent Institute of Science & Technology

```
Driver phone ──fix──▶ Node.js + Express ──▶ PostgreSQL ──▶ Socket.IO ──▶ React + Leaflet
                         │  validate (11 rules)            live map, ETA band, alerts
Student phone ──fix──▶ Attendance engine (in memory, never stored) ──▶ "Are you on Bus 118?"
Bus GPS leaves a stop ──▶ Boarding check ──▶ "Did you board?" every 10 min until answered
Razorpay / test gateway ──signed webhook──▶ Billing ──▶ subscription (optional for students)
```

Data: the official **BSACIST Bus Route 2026-2027** circular — 28 routes, 28 buses, 395 boarding points.

## Run it

Requires **Node.js 20+**. Nothing else — the database is PostgreSQL running inside
Node (PGlite) and payments use a built-in test gateway. On Windows the database is kept
in `%LOCALAPPDATA%\CrescentTrack\pgdata`, outside the project, because a synced folder
(OneDrive) can damage it; elsewhere it is `.data/pgdata`. Set `PGLITE_DIR` to choose.
If it is ever damaged (for example the server was killed mid-write), the server moves it
aside, keeps the copy, and starts a fresh one with the demo data. Stop the server with
**Ctrl+C** so it can close the database cleanly.

**In VS Code:** open the project folder, then *Terminal → Run Task…* and pick
*Backend*, *Web dev server*, *Bus simulator*, *Mobile app (Expo…)* or *Tests*;
*Run and Debug* (F5) starts the backend with breakpoints. The project's terminals open
in Command Prompt, because PowerShell on many Windows PCs blocks npm with
"running scripts is disabled on this system". To use npm in PowerShell as well, run
this once in PowerShell (it only affects your user account):
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

**One click (Windows):** double-click `RUN-DEMO.bat`. It installs, builds, starts the
server and the simulator (four buses, with the demo students riding them and
answering the attendance prompt), and opens the app.

**By hand:**

```bash
npm install
npm run build                           # build the React app into client/dist
TRAVEL_WINDOWS=00:00-24:00 npm start    # http://localhost:4000 (Windows cmd: set TRAVEL_WINDOWS=00:00-24:00)
npm run simulate:riders                 # second terminal: buses move, students ride
```

`TRAVEL_WINDOWS` opens attendance sampling all day for a demo; the default is
`06:00-10:30,15:30-19:30`, campus time.

### Accounts

Created on first start (password: `DEMO_PASSWORD`, default `Demo@2026`):

| Role | Username | What they see |
|---|---|---|
| Student | `stu001`–`stu024` (routes 118, 119, 117, 127) | Home with ETA and “Leave now”, live map, attendance, boarding check, settings |
| Driver | `drv118`, `drv104a`, … (`drv` + route code) | Trip start/stop, GPS, crowd level, boarding QR, boarded list, SOS |
| Transport admin | `admin` | Dashboard, fleet map, trips and replay, attendance review, routes, buses & drivers, alerts, reports |
| Finance officer | `finance` | Collections, payments and refunds, suspensions, reconciliation — no live locations |

New students can register from the sign-in page. Every account can change its own
password: the lock button next to your name (web), *Settings → Change password*
(student phone), *More → Change password* (admin phone) or the lock in the header
(driver and finance phone). A change signs the account out on every other device.

## What each module does

| Module (doc section) | Where | Highlights |
|---|---|---|
| Location pipeline (6) | `server/tracking.js`, `server/validation.js` | Driver fixes validated, stored, broadcast; Live ≤ 30 s / Delayed ≤ 2 min / Offline |
| ETA (7) | `shared/eta.js` | Band, never a single minute; timetable segment times, replaced by learned stop-to-stop times after 3 trips; predictions logged each minute for the MAE report |
| Boarding check | `server/boarding.js` | Bus GPS only (tracker or driver phone): when the bus leaves a student's saved stop (reached a later stop, or 150 m past it) the student gets a "Did you board?" popup (socket + push), repeated every 10 min until answered; "Yes" is an attendance record (method `STOP`), "No" records nothing; closes by itself when the phone prompt, QR or driver records the trip; respects the student's travel window; never on the run that starts at the campus; on/off in Settings; unanswered questions expire after 12 h or at the nightly run |
| Subscription & payment (8) | `server/billing/` | ₹60 plan stored as 6,000 paise in a row; hosted checkout; HMAC-verified webhook is the only evidence; idempotent; exclusion constraint forbids overlapping periods; 5-day grace; 7-day refunds (finance role + reason); reconciliation job every 15 min; PDF receipts; month-end reconciliation against the settlement report |
| Automatic attendance (9) | `shared/colocation.js`, `server/attendance.js` | ≤ 50 m, ≤ 30 s skew, > 8 km/h, ±30°, two matches over ≥ 40 s; one-tap prompt (socket + waiting in app 30 min); PROVISIONAL after 3 min if co-located ≥ 90 s; alighting at > 150 m twice; trip end / dead tracker closes records; QR / typed code with offline replay; driver manual list; disputes within 7 days; nightly 23:30 lock and 72 h auto-confirm (never for mock-location phones); device binding with one-time code; capacity breach flag; student coordinates never stored |
| Administration (4.1) | `server/routes/admin.js` | Buses, drivers, routes and stops (click-to-place, drag, reorder), trip scheduling, start/end/cancel, announcements, incidents, attendance review with evidence |
| Finance (4.4) | `server/routes/finance.js` | Collections by month/route/department/method vs break-even (217 subscribers), refunds, suspensions, statement CSV, reconciliation, payment audit log |
| Reports (9.14, 7.3, 9.9) | `server/reports.js` | Register per trip/student (CSV), stop demand, occupancy vs capacity, exceptions, subscriber-vs-traveller leakage, ETA MAE by route/hour/method, precision & recall against a manual register |

A section-by-section map of the design document to code and tests is in
[docs/IMPLEMENTATION_MAP.md](docs/IMPLEMENTATION_MAP.md).

## Real Razorpay

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (test keys
first) and point a Razorpay webhook at `https://<host>/api/webhooks/payment` with the
events `payment.captured`, `payment.failed` and `refund.processed`. The app then opens
Razorpay's checkout instead of the test gateway. Nothing else changes: both gateways
are behind the same interface and the same signed webhook (`server/billing/gateway.js`).

## Deploying

Settings come from environment variables (see `.env.example`); for local runs you can
copy it to `.env` and the server reads it at start-up.

- **Render:** *New → Blueprint* with this repository uses `render.yaml`. Add a PostgreSQL
  database (Render or Supabase) and set `DATABASE_URL`; Render's disk does not survive a deploy.
- **Docker:** `docker build -t crescent-transit .` then
  `docker run -p 4000:4000 -e JWT_SECRET=... -e DATABASE_URL=... crescent-transit`
  (or mount a volume at `/data` to keep the embedded database).
- **Production checklist:** `NODE_ENV=production` (the server refuses to start without
  `JWT_SECRET`, and without `RAZORPAY_WEBHOOK_SECRET` when Razorpay is on), `TRUST_PROXY=1`
  behind a proxy, HTTPS in front, a non-default `DEMO_PASSWORD` or `SEED_DEMO_STUDENTS=0`,
  and change the seeded `admin` and `finance` passwords after the first sign-in.

Security built in: bcrypt password hashes, signed tokens (7 days, `JWT_EXPIRES_IN`) checked
against the account on every request (suspension and password changes take effect at once),
per-user and per-address rate limits, an audit log, HMAC-verified payment webhooks,
and browser hardening headers (`nosniff`, frame and referrer policies, `no-store` on API data).

`.github/workflows/ci.yml` runs the tests and the web build on every push.

## Tests and measurements

```bash
npm test          # 118 tests: validation, co-location, ETA, payments, attendance, boarding check, admin, accounts, cache, GPS trackers
npm run measure   # latency from driver POST to map client, on a running server
npm run load-test # 1000 students at once against a throwaway server (docs/PERFORMANCE.md)
npm run simulate:trackers  # GT06 / Teltonika / OsmAnd trackers driving the routes (docs/GPS_TRACKERS.md)
npm run reset-db  # delete the local database (reseeded on next start)
```

The suites run the real server against an in-memory PostgreSQL:
`test/billing.test.js` covers every failure case of doc 8.5 (replayed and forged
webhooks, wrong amount, webhook never arriving, double payment, refunds, grace);
`test/attendance.test.js` rides buses through the whole state machine of doc 9.5 and
the critical cases of doc 11.2; `test/colocation.test.js` checks the matching rules
against traces including the known false positives.

## API

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login`, `/api/auth/register` | – | Sign in (all roles), register (students) |
| GET/PATCH | `/api/me` | any / student | Profile, entitlement; saved stop, travel window, consent |
| GET | `/api/routes`, `/api/routes/:code`, `/api/notices`, `/api/contacts`, `/api/plans` | – | Free view |
| POST | `/api/problems` | any | Missing/delayed bus, lost & found, SOS |
| GET | `/api/live`, `/api/buses/active`, `/api/buses/:id/location`, `/api/eta`, `/api/notifications` | staff, students | Live data (402 without a subscription only when `STUDENT_SUBSCRIPTION_REQUIRED=1`) |
| POST | `/api/driver/trips`, `/api/trips/start`, `/api/driver/trips/:id/end`, `/api/trips/end` | driver | Trips |
| POST | `/api/driver/locations`, `/api/buses/:busId/location` | driver | Fixes (single or buffered batch) |
| POST | `/api/driver/incidents`, `/api/driver/occupancy`; GET `/api/driver/boarding-code` | driver | Problems, crowd level, in-bus QR |
| GET | `/api/trips/:id/attendance`; POST `/api/attendance/manual` | driver, admin | Boarded list; manual marking |
| POST | `/api/subscriptions/order`; GET `/api/subscriptions/me`, `/api/payments/me`, `/api/payments/:id/receipt` | student | Pay, validity, history, PDF receipt |
| POST | `/api/webhooks/payment` | gateway | HMAC-signed; the only source of truth for payments |
| POST | `/api/devices/bind`, `/api/attendance/device-location`, `/api/attendance/:id/confirm`, `/api/attendance/qr`, `/api/attendance/:id/dispute` | student | Attendance |
| GET | `/api/attendance/plan`, `/api/attendance/pending`, `/api/attendance/me?month=` | student | Sampling plan, waiting prompt, own record |
| GET/POST | `/api/boarding-checks/pending`, `/api/boarding-checks/:id/answer` | student | Waiting "Did you board?" questions; answer `YES` / `NO` |
| * | `/api/admin/...`, `/api/notifications`, `/api/reports/...` | admin | Administration and reports |
| * | `/api/finance/...`, `/api/reports/collections`, `/api/admin/subscriptions/:id/refund` | finance | Money |
| GET | `/api/trips/:id/path`, `/api/trips/:id/history` | admin | Trip history (replay) |

Socket.IO: connect with `auth: { token }`. Emit `subscribe {route}` → `snapshot`,
`bus:location`, `bus:freshness`, `bus:trip-ended` (or `live:denied` without a
subscription, when required). Per user: `attendance:prompt`, `attendance:updated`,
`boarding:check` (the question, or a reminder of it), `boarding:closed`,
`subscription:updated`. Everyone: `notification`. Admins: `incident`.

## Project layout

```
server/            Express API, schema, seed, jobs
  billing/         gateways (Razorpay + test), subscription service, PDF receipt
  routes/          admin and finance routers
  gps/             bus GPS trackers: GT06 + Teltonika over TCP, OsmAnd + webhook over HTTP
  attendance.js    the attendance engine and its state machine
  tracking.js      location pipeline, stop arrivals, ETA logging
  reports.js       registers, demand, occupancy, leakage, MAE, precision/recall
shared/            geo, freshness, ETA and co-location rules (server + client)
client/src/        React app: pages/{student,admin,finance}, DriverApp, LiveMap
scripts/           simulate.js (--riders), simulate-trackers.js, measure-latency.js, load-test.js, reset-db.js
test/              node:test suites against in-memory PostgreSQL
data/              BSACIST 2026-27 timetable
docs/              implementation map, code walkthrough, demo script, performance, GPS trackers
```

## GPS trackers in the buses

Buses can be tracked by a GPS tracker fixed in the bus as well as by the driver's
phone. Concox/GT06 and Teltonika trackers connect straight to the server over TCP,
trackers with an HTTP mode (and Traccar Client) post to `/api/gps/osmand`, and
anything else comes through a Traccar server or vendor platform via
`/api/gps/webhook`. While a bus's tracker reports, the driver's phone stands by,
and it takes over if the tracker goes quiet. Trips start and end by themselves from
the bus's movement, so a bus is tracked even if the driver never opens the app.
Register trackers in Fleet → GPS trackers; the setup steps for each tracker type
are in [docs/GPS_TRACKERS.md](docs/GPS_TRACKERS.md). To try it without hardware:
`npm run simulate:trackers`.

## Performance

Load-tested with 1000 students at once (all 28 buses moving, every student sending a
location fix every 20 s, riders being matched and prompted): all 1000 sign in, nothing
fails, and once they're in the median response is 12–32 ms. Before the tuning in
`docs/PERFORMANCE.md`, only 189 of 1000 could sign in. Password hashing runs on worker
threads, per-request account and subscription checks are cached (and refreshed by any
write to their tables), and an overloaded sign-in says "try again" instead of hanging.

## Known limitations

- Stop coordinates are locality-level (285 geocoded, 110 interpolated); the route line
  joins stops directly rather than following roads, so ETA distances are straight-line
  along the stop polyline until learned segment times take over.
- Push notifications use the open app's socket and the browser Notification API; a
  native FCM/APNs push (for a closed app) needs the Android/iOS app. `devices.push_token`
  is stored for it.
- No SMS provider is configured: the one-time code for moving to a new phone is printed
  in the server log (and returned by the API outside `NODE_ENV=production`).
- The Tamil language preference is saved but the interface is English only.
- Policy questions in doc 8.10 (mandatory or optional fee, GST, merchant account,
  refund approver, year-end) are configuration or process decisions for the university;
  the defaults here follow the document's recommendations.
