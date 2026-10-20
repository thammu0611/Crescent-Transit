-- University Bus Tracking System - database schema (PostgreSQL)
--
-- Section 1 is Module 1 (the realtime location pipeline). Section 2 upgrades
-- a Module 1 database in place. Sections 3-6 add the modules of revision 2 of
-- the design document: administration, subscription and payment (doc 8.6),
-- GPS attendance (doc 9.12), and ETA evaluation (doc 7.3).
-- Every statement is idempotent: the file is applied on every start.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ===========================================================================
-- 1. Location pipeline (Module 1)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS routes (
  id               SERIAL PRIMARY KEY,
  code             TEXT UNIQUE NOT NULL,          -- e.g. "118"
  name             TEXT NOT NULL,                 -- e.g. "Velachery"
  start_point      TEXT NOT NULL,
  end_point        TEXT NOT NULL,
  departure_time   TEXT,                          -- morning departure from the first stop
  duration_minutes INTEGER
);

CREATE TABLE IF NOT EXISTS stops (
  id             SERIAL PRIMARY KEY,
  route_id       INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,                -- order along the route
  name           TEXT NOT NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  scheduled_time TEXT,                            -- time printed in the timetable
  offset_minutes INTEGER,                         -- minutes after route departure
  geo_source     TEXT NOT NULL DEFAULT 'mapped',  -- 'mapped', 'interpolated' or 'admin'
  UNIQUE (route_id, seq)
);

CREATE TABLE IF NOT EXISTS buses (
  id         SERIAL PRIMARY KEY,
  fleet_code TEXT UNIQUE NOT NULL,                -- e.g. "BSACIST-118"
  route_id   INTEGER REFERENCES routes(id),
  bus_type   TEXT,
  capacity   INTEGER,
  is_ac      BOOLEAN
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'driver', 'student', 'finance')),
  bus_id        INTEGER REFERENCES buses(id)      -- set for drivers only
);

CREATE TABLE IF NOT EXISTS trips (
  id         SERIAL PRIMARY KEY,
  bus_id     INTEGER NOT NULL REFERENCES buses(id),
  route_id   INTEGER NOT NULL REFERENCES routes(id),
  driver_id  INTEGER NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ
);
-- A bus can only run one trip at a time.
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_active_per_bus ON trips (bus_id) WHERE status = 'active';

-- Every accepted GPS fix (trip history for delay and route analysis).
CREATE TABLE IF NOT EXISTS location_pings (
  id          BIGSERIAL PRIMARY KEY,
  trip_id     INTEGER NOT NULL REFERENCES trips(id),
  bus_id      INTEGER NOT NULL REFERENCES buses(id),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  speed_kmh   REAL,
  heading     REAL,
  accuracy_m  REAL,
  recorded_at TIMESTAMPTZ NOT NULL,               -- time on the device
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()  -- time on the server
);
CREATE INDEX IF NOT EXISTS location_pings_trip_time ON location_pings (trip_id, recorded_at);
CREATE INDEX IF NOT EXISTS location_pings_bus_time ON location_pings (bus_id, recorded_at DESC);

-- Only the newest fix per bus: this is what the live map reads.
CREATE TABLE IF NOT EXISTS bus_latest (
  bus_id      INTEGER PRIMARY KEY REFERENCES buses(id),
  trip_id     INTEGER NOT NULL REFERENCES trips(id),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  speed_kmh   REAL,
  heading     REAL,
  accuracy_m  REAL,
  recorded_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL
);

-- Fixes that failed validation, kept with the reason for GPS-quality analysis.
CREATE TABLE IF NOT EXISTS rejected_pings (
  id          BIGSERIAL PRIMARY KEY,
  bus_id      INTEGER REFERENCES buses(id),
  trip_id     INTEGER REFERENCES trips(id),
  reason      TEXT NOT NULL,
  payload     JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- 2. In-place upgrade of a Module 1 database
-- ===========================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'driver', 'student', 'finance'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS email            TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone            TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS register_no      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_route_id    INTEGER REFERENCES routes(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_stop_seq    INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at       TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS travel_windows   TEXT;      -- "06:30-09:00,16:00-18:30"; NULL = default
ALTER TABLE users ADD COLUMN IF NOT EXISTS language         TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT now();
-- Set when the user changes their password; sign-in tokens issued before it stop working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended'));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

ALTER TABLE buses ADD COLUMN IF NOT EXISTS registration_number TEXT;
ALTER TABLE buses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE buses DROP CONSTRAINT IF EXISTS buses_status_check;
ALTER TABLE buses ADD CONSTRAINT buses_status_check CHECK (status IN ('active', 'inactive', 'maintenance'));

ALTER TABLE routes ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_status_check;
ALTER TABLE trips ADD CONSTRAINT trips_status_check CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS occupancy     TEXT CHECK (occupancy IN ('SEATS_FREE', 'STANDING', 'FULL'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS flagged       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS flag_reason   TEXT;
CREATE INDEX IF NOT EXISTS trips_route_started ON trips (route_id, started_at DESC);

-- ===========================================================================
-- 3. Administration: announcements, incidents and the audit log
-- ===========================================================================

-- Announcements and alerts. route_id NULL = whole network (the notice board).
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'ANNOUNCEMENT'
             CHECK (kind IN ('ANNOUNCEMENT', 'ROUTE_CHANGE', 'DELAY', 'BREAKDOWN', 'EMERGENCY')),
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  route_id   INTEGER REFERENCES routes(id) ON DELETE CASCADE,
  trip_id    INTEGER REFERENCES trips(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_route_time ON notifications (route_id, created_at DESC);

-- Expo push tokens, one row per phone; a phone that signs in to another account moves to it.
CREATE TABLE IF NOT EXISTS push_tokens (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens (user_id);

-- Problems reported by drivers and students, and exceptions raised by the system.
CREATE TABLE IF NOT EXISTS incidents (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN (
                'BREAKDOWN', 'DELAY', 'EMERGENCY', 'SOS', 'MISSING_BUS', 'LOST_AND_FOUND', 'OTHER',
                'ATTENDANCE_CONFLICT', 'CAPACITY_BREACH', 'TRACKER_OFFLINE', 'MOCK_LOCATION')),
  source      TEXT NOT NULL CHECK (source IN ('driver', 'student', 'system')),
  message     TEXT,
  route_id    INTEGER REFERENCES routes(id),
  bus_id      INTEGER REFERENCES buses(id),
  trip_id     INTEGER REFERENCES trips(id),
  user_id     INTEGER REFERENCES users(id),
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolution  TEXT,
  resolved_by INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS incidents_status_time ON incidents (status, created_at DESC);

-- Every payment, subscription change and manual override (doc 8.8).
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  reason     TEXT,
  detail     JSONB,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_time ON audit_log (created_at DESC);

-- ===========================================================================
-- 4. Subscription and online fee payment (doc section 8.6)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_id       SERIAL PRIMARY KEY,
  plan_code     VARCHAR(30) UNIQUE NOT NULL,       -- 'MONTHLY_60'
  display_name  VARCHAR(100) NOT NULL,
  amount_paise  INT NOT NULL CHECK (amount_paise > 0),
  duration_days INT NOT NULL CHECK (duration_days > 0),
  active        BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id),
  plan_id    INT NOT NULL REFERENCES subscription_plans(plan_id),
  status     VARCHAR(20) NOT NULL DEFAULT 'PENDING'
             CHECK (status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'REFUNDED')),
  valid_from DATE,
  valid_to   DATE,
  auto_renew BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  ended_at   TIMESTAMPTZ,
  -- Overlapping active periods for one student are impossible (doc 8.6).
  CONSTRAINT one_active_per_user
    EXCLUDE USING gist (
      user_id WITH =,
      daterange(valid_from, valid_to, '[]') WITH &&
    ) WHERE (status = 'ACTIVE')
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_valid ON subscriptions (user_id, valid_to DESC);

CREATE TABLE IF NOT EXISTS payments (
  payment_id         SERIAL PRIMARY KEY,
  subscription_id    INT REFERENCES subscriptions(subscription_id),
  user_id            INT NOT NULL REFERENCES users(id),
  plan_id            INT NOT NULL REFERENCES subscription_plans(plan_id),
  gateway            VARCHAR(30) NOT NULL DEFAULT 'RAZORPAY',
  gateway_order_id   VARCHAR(80) UNIQUE NOT NULL,
  gateway_payment_id VARCHAR(80) UNIQUE,
  idempotency_key    VARCHAR(80) UNIQUE NOT NULL,
  amount_paise       INT NOT NULL,
  method             VARCHAR(20),                  -- UPI | CARD | NETBANKING
  status             VARCHAR(20) NOT NULL DEFAULT 'CREATED'
                     CHECK (status IN ('CREATED', 'AUTHORISED', 'CAPTURED', 'FAILED', 'REFUNDED')),
  signature_verified BOOLEAN DEFAULT FALSE,
  confirmed_by       VARCHAR(20),                  -- WEBHOOK | RECONCILIATION
  receipt_no         VARCHAR(40) UNIQUE,
  failure_reason     TEXT,
  paid_at            TIMESTAMPTZ,
  gateway_refund_id  VARCHAR(80),
  refund_reason      TEXT,
  refunded_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user_created ON payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments (status, created_at);

-- The built-in test gateway keeps its own ledger, separate from `payments`,
-- so that month-end reconciliation compares two independent records.
CREATE TABLE IF NOT EXISTS mock_gateway_orders (
  id           TEXT PRIMARY KEY,
  amount_paise INT NOT NULL,
  receipt      TEXT,
  status       TEXT NOT NULL DEFAULT 'created',   -- created | paid | attempted
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mock_gateway_payments (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES mock_gateway_orders(id),
  amount_paise INT NOT NULL,
  method       TEXT NOT NULL,
  status       TEXT NOT NULL,                     -- captured | failed | refunded
  refund_id    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at  TIMESTAMPTZ
);

-- ===========================================================================
-- 5. GPS-based automatic attendance (doc section 9.12)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS devices (
  device_id          SERIAL PRIMARY KEY,
  user_id            INT NOT NULL REFERENCES users(id),
  device_uid         TEXT NOT NULL,               -- generated on the phone
  platform           VARCHAR(10) CHECK (platform IN ('ANDROID', 'IOS', 'WEB')),
  push_token         TEXT,
  bound_at           TIMESTAMPTZ DEFAULT now(),
  mock_location_flag BOOLEAN DEFAULT FALSE,
  UNIQUE (user_id)                                -- one active device per account
);

-- One-time codes for moving an account to a new phone (doc 9.8).
CREATE TABLE IF NOT EXISTS device_otps (
  user_id    INT PRIMARY KEY REFERENCES users(id),
  device_uid TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  attendance_id     SERIAL PRIMARY KEY,
  user_id           INT NOT NULL REFERENCES users(id),
  trip_id           INT NOT NULL REFERENCES trips(id),
  bus_id            INT NOT NULL REFERENCES buses(id),
  status            VARCHAR(20) NOT NULL DEFAULT 'PROMPTED'
                    CHECK (status IN ('PROMPTED', 'CONFIRMED', 'ON_BOARD', 'COMPLETED', 'PROVISIONAL',
                                      'REJECTED', 'VOID', 'DISPUTED', 'ADJUSTED')),
  method            VARCHAR(10) NOT NULL DEFAULT 'GPS' CHECK (method IN ('GPS', 'QR', 'MANUAL', 'BEACON')),
  boarded_at        TIMESTAMPTZ,
  boarding_stop_id  INT REFERENCES stops(id),
  alighted_at       TIMESTAMPTZ,
  alighting_stop_id INT REFERENCES stops(id),
  confidence        NUMERIC(4,3),
  locked            BOOLEAN DEFAULT FALSE,
  -- Engine bookkeeping: how long device and bus have moved together.
  first_match_at    TIMESTAMPTZ,
  last_match_at     TIMESTAMPTZ,
  prompted_at       TIMESTAMPTZ,
  answered_at       TIMESTAMPTZ,
  flagged           BOOLEAN NOT NULL DEFAULT FALSE,   -- mock location etc.: never auto-confirms
  flag_reason       TEXT,
  auto_confirmed    BOOLEAN NOT NULL DEFAULT FALSE,   -- provisional > 72 h, reported separately
  adjusted_present  BOOLEAN,                          -- the admin's decision on a dispute
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, trip_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_trip ON attendance (trip_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance (user_id, boarded_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance (status);

CREATE TABLE IF NOT EXISTS attendance_events (
  event_id      BIGSERIAL PRIMARY KEY,
  attendance_id INT REFERENCES attendance(attendance_id) ON DELETE SET NULL,
  trip_id       INT REFERENCES trips(id),
  user_id       INT REFERENCES users(id),
  event_type    VARCHAR(20) NOT NULL
                CHECK (event_type IN ('MATCH', 'PROMPT', 'ANSWER', 'ALIGHT', 'OVERRIDE', 'FLAG', 'DISPUTE', 'RESOLVE')),
  distance_m    NUMERIC(8,2),
  speed_kmph    NUMERIC(6,2),
  bearing_delta NUMERIC(6,2),
  device_ts     TIMESTAMPTZ,
  detail        TEXT,
  server_ts     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_att_events_att ON attendance_events (attendance_id);

CREATE TABLE IF NOT EXISTS attendance_disputes (
  dispute_id       SERIAL PRIMARY KEY,
  attendance_id    INT NOT NULL REFERENCES attendance(attendance_id),
  raised_by        INT NOT NULL REFERENCES users(id),
  reason           TEXT NOT NULL,
  claimed_present  BOOLEAN NOT NULL,              -- what the student says is true
  previous_status  VARCHAR(20) NOT NULL,
  resolution       TEXT,
  resolved_by      INT REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);

-- ===========================================================================
-- 6. ETA evaluation (doc section 7.2 / 7.3)
-- ===========================================================================

-- The moment each bus reached each stop: the "actual" side of the MAE.
CREATE TABLE IF NOT EXISTS stop_arrivals (
  trip_id    INT NOT NULL REFERENCES trips(id),
  stop_seq   INT NOT NULL,
  arrived_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (trip_id, stop_seq)
);

-- Arrival predictions sampled once a minute: the "predicted" side.
CREATE TABLE IF NOT EXISTS eta_predictions (
  id                BIGSERIAL PRIMARY KEY,
  trip_id           INT NOT NULL REFERENCES trips(id),
  stop_seq          INT NOT NULL,
  predicted_at      TIMESTAMPTZ NOT NULL,
  predicted_arrival TIMESTAMPTZ NOT NULL,
  method            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS eta_predictions_trip_stop ON eta_predictions (trip_id, stop_seq);

-- Last run of each scheduled job, so a restart does not repeat the nightly work.
CREATE TABLE IF NOT EXISTS job_runs (
  job      TEXT PRIMARY KEY,
  last_run TIMESTAMPTZ NOT NULL
);

-- ===========================================================================
-- 7. Hardware GPS trackers fitted in the buses (server/gps)
-- ===========================================================================

-- One tracker per bus, identified by what it reports (IMEI for GT06 and
-- Teltonika, the configured id for OsmAnd-style HTTP). HTTP senders also
-- prove themselves with a key; only its hash is stored.
CREATE TABLE IF NOT EXISTS bus_trackers (
  id           SERIAL PRIMARY KEY,
  unique_id    TEXT UNIQUE NOT NULL,
  protocol     TEXT NOT NULL DEFAULT 'auto' CHECK (protocol IN ('auto', 'gt06', 'teltonika', 'osmand', 'webhook')),
  bus_id       INTEGER UNIQUE REFERENCES buses(id) ON DELETE SET NULL,
  label        TEXT,
  key_hash     TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A tracker can run a bus that has no driver assigned, and trips record who started them.
ALTER TABLE trips ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS started_by TEXT;    -- 'driver', 'tracker' or 'admin'
-- Which sender produced each position: the driver's phone or the bus tracker.
ALTER TABLE location_pings ADD COLUMN IF NOT EXISTS source TEXT; -- 'phone' or 'tracker'
ALTER TABLE bus_latest ADD COLUMN IF NOT EXISTS source TEXT;

-- ===========================================================================
-- 8. Boarding check from the bus GPS (server/boarding.js)
-- ===========================================================================

-- When the bus (its tracker, or the driver's phone) leaves a student's saved
-- stop, the student is asked "Did you board?" and reminded until they answer.
-- Works without the student's location: only the bus position is used.
ALTER TABLE users ADD COLUMN IF NOT EXISTS boarding_reminders BOOLEAN NOT NULL DEFAULT TRUE;

-- A "Yes" to that question is an attendance record of its own method.
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_method_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_method_check CHECK (method IN ('GPS', 'QR', 'MANUAL', 'BEACON', 'STOP'));

CREATE TABLE IF NOT EXISTS boarding_checks (
  check_id      SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id       INT NOT NULL REFERENCES trips(id),
  bus_id        INT NOT NULL REFERENCES buses(id),
  stop_id       INT REFERENCES stops(id) ON DELETE SET NULL,
  departed_at   TIMESTAMPTZ NOT NULL,             -- the bus GPS showed it leaving the stop
  status        VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'BOARDED', 'NOT_BOARDED', 'RECORDED', 'EXPIRED')),
  reminders     INT NOT NULL DEFAULT 0,           -- reminders sent after the first question
  last_sent_at  TIMESTAMPTZ NOT NULL,
  answered_at   TIMESTAMPTZ,
  attendance_id INT REFERENCES attendance(attendance_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, trip_id)
);
CREATE INDEX IF NOT EXISTS idx_boarding_checks_pending ON boarding_checks (last_sent_at) WHERE status = 'PENDING';
