# Implementation map

How each section of *University Bus Tracking System — Project Documentation,
Revision 2* is implemented, and which test proves it.

| Doc | Requirement | Code | Test |
|---|---|---|---|
| 1.1 | Student login and bus selection | `client/src/pages/Login.jsx`, `LiveMap.jsx` | `admin.test.js` roles |
| 2.3 | Phone → server → store → broadcast → map | `server/tracking.js` `ingest` | `api.test.js` |
| 3.4 | Billing and attendance beside the pipeline, not in it | `tracking.on('fix'/'tripEnded')`, `server/attendance.js` | — |
| 4.1 | Admin: buses, drivers, routes, stops, order, assignment, trips, announcements, reports, attendance review, exports | `server/routes/admin.js`, `client/src/pages/admin/*` | `admin.test.js` |
| 4.2 | Driver: trip, live location, problems, boarded list, manual marking | `client/src/pages/DriverApp.jsx`, `/api/driver/*` | `attendance.test.js` fallbacks |
| 4.3 | Student: route, active buses, stops, ETA, notifications, report, pay, one-tap prompt, own record, 7-day dispute | `client/src/pages/student/*`, `AttendancePrompt.jsx` | `attendance.test.js`, `billing.test.js` |
| 4.4 | Finance officer, no live locations; least privilege | `server/routes/finance.js`, Socket.IO `live:denied` | `billing.test.js` least privilege |
| 5.2 | Schema (users … notifications) | `server/schema.sql` §1–3 | all suites |
| 5.3 | Indexes on location history | `location_pings_trip_time`, `location_pings_bus_time` | — |
| 6.1 | Driver app: permission, auth, start, 5–15 s, status, background, end | `DriverApp.jsx` (buffer + batch upload) | `api.test.js` batch |
| 6.3 | API names | `server/app.js` (doc names kept as aliases) | `admin.test.js` doc 6.3 names |
| 6.6 | Live / Delayed / Offline | `shared/freshness.js` | `validation.test.js` |
| 6.7 | Server-side validation | `server/validation.js` (11 rules) | `validation.test.js` |
| 7.1 | ETA = distance ÷ speed (3 km at 20 km/h = 9 min) | `shared/eta.js` `estimateArrival` | `colocation.test.js` worked example |
| 7.2 | Historical segment time | `stop_arrivals`, `TrackingService.refreshSegmentTimes` | `colocation.test.js` segment history |
| 7.3 | MAE by route and time band | `eta_predictions`, `ReportService.etaAccuracy` | UI: Reports → ETA accuracy |
| A.1.1 | “Leave now” | `shared/eta.js` `leaveIn`, `StudentHome.jsx` | `colocation.test.js` |
| A.1.2 | Occupancy chip | `/api/driver/occupancy`, `LiveMap.jsx` | `admin.test.js` occupancy |
| A.1.3 | Confidence band, never “9 minutes” | `estimateArrival` low/high/confidence | `colocation.test.js` |
| 8.2 | MONTHLY_60 = 6,000 paise, 30 days, 5-day grace, 7-day refund, term plans | `seed.js` PLANS, `config.subscription` | `billing.test.js` |
| 8.3 | Order → hosted checkout → signed webhook → activate in one transaction | `BillingService.createOrder`, `handleWebhook`, `applyCapture` | `billing.test.js` pay |
| 8.4 | Entitlement middleware, 402, free view | `BillingService.requireSubscription` | `billing.test.js` 402 |
| 8.5 | Webhook never arrives / twice / write failed / bad signature / wrong amount / pays twice / refund / outage | `reconcilePending`, unique `gateway_payment_id`, idempotency key, HMAC, amount check, extension, `applyRefund`, grace | `billing.test.js` (one test each) |
| 8.5 | Month-end reconciliation, line by line | `BillingService.reconcile`, `Reconcile.jsx` | `billing.test.js` reconciliation |
| 8.6 | Exclusion constraint `one_active_per_user` | `schema.sql` §4 (btree_gist) | `billing.test.js` exclusion |
| 8.8 | No card data; HMAC before parsing; server-set amount; audit log; finance-only refunds; rate limit; source allow-list | `gateway.js`, `util.js` `audit`/`rateLimit`, `WEBHOOK_ALLOWED_IPS` | `billing.test.js` |
| 8.9 | ₹1.42 fee, break-even 217 | `BillingService.collections` | `billing.test.js` collections |
| 9.2 | Student coordinates never stored | `AttendanceService.handleDeviceFix` (in memory only) | `attendance.test.js` no lat/lng columns |
| 9.3 | Co-location rule (50 m, 30 s, 8 km/h, ±30°, 2 matches ≥ 40 s, uniqueness) | `shared/colocation.js` | `colocation.test.js` |
| 9.4 | One-tap prompt; No → 10 min cool-down; 3 min → PROVISIONAL (≥ 90 s) or drop; waits 30 min | `AttendanceService.confirm`, `tick`, `pending` | `attendance.test.js` |
| 9.4+ | Boarding check from the bus GPS: "Did you board?" when the bus leaves the student's stop, reminded every 10 min until answered | `BoardingCheckService` (`server/boarding.js`), `BoardingCheck.jsx` / `BoardingCheck.js` | `boarding.test.js` |
| 9.5 | States and 23:30 lock, 72 h auto-confirm | `attendance.status`, `AttendanceService.nightly`, `JobRunner` | `attendance.test.js` no answer |
| 9.6 | Alighting at > 150 m twice, or trip end | `followOpenRecord`, `onTripEnded` | `attendance.test.js` ride end to end |
| 9.7 | QR (offline replay), driver list, tracker failure | `qrCheckIn`, `manual`, `tick` tracker check | `attendance.test.js` fallbacks, tracker |
| 9.8 | One open record, mock-location flag, device binding + OTP, capacity check, evidence | `followOpenRecord`, `bindDevice`, `checkCapacity`, `attendance_events` | `attendance.test.js` |
| 9.9 | Precision / recall / prompt response / provisional share | `ReportService.attendanceAccuracy` | `attendance.test.js` registers |
| 9.10 | Sample only in travel window and near a route corridor | `samplingPlan`, corridor filter, `client/src/lib/sampler.js` | `attendance.test.js` travel window |
| 9.11 | Consent, privacy notice, retention (1 year) | `Settings.jsx` `PrivacyNotice`, `nightly` purge | — |
| 9.14 | Registers, demand, occupancy, exceptions, leakage | `server/reports.js`, `Reports.jsx` | `attendance.test.js` |
| 11.2 | Critical failure cases | see billing and attendance suites | `api.test.js`, `billing.test.js`, `attendance.test.js` |
| B.7 | Driver: large targets, transmission indicator, buffered counter, haptics | `DriverApp.jsx`, `roles.css` | — |
| B.8 | Fleet map, KPI strip, route builder, trip replay 1×/4×/16×, CSV exports | `Dashboard.jsx`, `RoutesAdmin.jsx`, `Trips.jsx`, `Reports.jsx` | — |

## Not built (outside a software prototype)

- Hardware items of doc 12–13 (4G trackers, BLE beacons): the tracker uses the same
  `/api/driver/locations` contract as the phone, and `attendance.method` already
  accepts `BEACON`.
- Native Android/iOS apps and FCM/APNs push, iOS Live Activities (A.1.7).
- Snap-to-road, Redis cache and geofenced automatic trip start (A.1.4, A.1.5, B.11).
- Bilingual interface text (the preference is stored).
