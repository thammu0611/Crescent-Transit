# Performance: 1000 students at once

Measured with `npm run load-test` (`scripts/load-test.js`): the real server
(`node server/index.js`, embedded PostgreSQL) with all 28 buses sending a GPS fix
every 5 s, and 1000 subscribed students doing what the phone app does at the
morning peak:

- sign in, then open the app (profile, routes, their route, alerts, sampling plan)
- hold a live socket on their route
- send a location fix every 20 s, with 30% of them riding a bus so the attendance
  engine matches them, prompts them, and they answer YES
- refresh alerts and the arrival estimate now and then

The server and the load generator ran on the same laptop (Intel i5-12450H,
8 cores / 12 threads). The laptop was **on battery**, so its multi-core speed varied
between runs. Treat the numbers as a lower bound for a dedicated server.

## Before and after (1000 students signing in over 60 s)

| | Before | After |
|---|---|---|
| Students who managed to sign in | **189 of 1000** | **1000 of 1000** |
| Sign-in time (median) | 22 s | 0.6 s |
| Failed requests / dropped sockets | 1,600+ / 979 | **0 / 0** |
| Requests served per second | 20 | 105 |
| Attendance prompts answered | 60 | 298 (every rider) |
| Once everyone is in: median / p95 / p99 response | n/a (never got there) | **12–32 ms / 37–315 ms / ≤ 363 ms** |
| Bus position reaching phones (median) | 16 ms (189 phones) | 22 ms (1000 phones) |
| Server memory | | about 450–510 MB |

Headroom: with **2000** students, everyone who was signed in still got a median
response of 11–40 ms. The limit is the sign-in rush itself (next section).

## What was slow, and what changed

1. **Password checks blocked the whole server.** bcrypt costs about 200 ms of CPU per
   check by design, and `bcryptjs` ran it on Node's single main thread. A few hundred
   sign-ins froze every other request, GPS fix and socket behind them. Hashing now runs
   on a pool of worker threads (`server/passwords.js`, `BCRYPT_WORKERS`, default
   CPU cores − 1, max 8). The hash format is unchanged, so existing passwords work.
2. **Every request queried the database 2–3 times before doing its job**, to re-check
   the account (suspended? password changed?) and the subscription. These answers, plus
   the route, stop, plan and alert lists every student loads, now come from an
   in-memory cache (`server/cache.js`). It can't serve stale data after a change: the
   database wrapper records every INSERT/UPDATE/DELETE per table, and any write to a
   table a cached value depends on makes that value stale immediately (also after a
   transaction commits). Suspension, refunds and password changes still take effect at
   once, and the existing tests for each of them pass unchanged.
3. **Everyone was signed out every morning.** Tokens lasted 12 hours, so every
   student signed in again at the daily peak, which is the most expensive moment.
   Sessions now last 7 days (`JWT_EXPIRES_IN`). A password change or suspension still
   ends a session at once.
4. **Overload protection for sign-in.** When the expected wait for a password check
   passes 15 s (measured from actual throughput, so it adapts to slow or throttled
   machines), sign-in replies at once with 503 *"Many students are signing in right
   now. Try again in a few seconds."* and a `Retry-After` header, instead of hanging
   until the phone gives up after 20 s. This also fixed a bug where any deliberate
   5xx reply reached the apps as "Internal server error".
5. **Connections:** keep-alive raised to 65 s (longer than the 60 s hosting proxies
   use, so phones reuse connections), a larger accept queue for bursts, a configurable
   PostgreSQL pool (`PG_POOL_MAX`, default 20, up from 10), and year-long browser
   caching for the web app's fingerprinted files.
6. **Sign-up limit:** raised from 10 to 60 per minute per address, because a whole
   campus on college Wi-Fi shares one public address.

## The one real limit: sign-in rushes

Checking a password is deliberately expensive. That is what makes stolen password
hashes useless, so it should not be made cheap. 1000 sign-ins in one minute needs about
5 CPU cores of hashing alone. On this laptop that worked (all 1000 in, the last ones
waiting up to about 15 s). 2000 in 150 s did not; that rush is what the overload
reply now handles.

In practice, rushes should be rare now: with 7-day sessions a student signs in about
once a week, not every morning, and opening the app doesn't need a password.

## Running the load test

```bash
npm run load-test                                        # 1000 students, 60 s ramp, 120 s steady
npm run load-test -- --students 2000 --ramp 150 --duration 120
npm run load-test -- --students 600 --ramp 1 --duration 30   # everyone signs in in the same second
```

It builds a throwaway database in a temp folder (or uses `DATABASE_URL`), starts the
server on port 4100, prints per-endpoint percentiles, a per-10-second timeline and
errors, and saves `load-test-result.json`. For reliable numbers, plug the laptop in,
close other heavy programs, and ideally run the load generator on a second machine.

## Going beyond a few thousand students

A single Node process with the embedded database handles this campus. For more:
set `DATABASE_URL` to a hosted PostgreSQL (the embedded one runs inside the Node
process). Running several server instances would also need a Socket.IO adapter (for
example Redis) and sticky sessions; the caches above then keep their 30 s safety
expiry for changes made by another instance.
