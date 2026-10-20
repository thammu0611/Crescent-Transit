import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../shared/colocation.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Where the embedded database used to live (and still does outside Windows).
export const LEGACY_PGLITE_DIR = path.join(ROOT_DIR, '.data', 'pgdata');

const DEV_JWT_SECRET = 'dev-only-secret-change-me';
const DEV_WEBHOOK_SECRET = 'dev-only-webhook-secret';

function parseTrustProxy(value) {
  const v = String(value ?? '').trim();
  if (!v || v === '0' || v === 'false') return false;
  if (v === 'true') return true;
  return /^\d+$/.test(v) ? Number(v) : v; // hop count, or e.g. "loopback, 10.0.0.0/8"
}

const portOrNull = (value) => (/^\d+$/.test(String(value ?? '').trim()) ? Number(value) : null);

export function loadConfig(overrides = {}) {
  const env = process.env;
  const config = {
    port: Number(env.PORT ?? 4000),
    // Set DATABASE_URL to use a hosted PostgreSQL (Supabase / Render).
    // Without it the server runs an embedded PostgreSQL (PGlite) stored on disk.
    databaseUrl: env.DATABASE_URL || null,
    // On Windows the database lives in the user's local app data, not in the
    // project: a project folder is often synced (OneDrive), and a sync tool
    // touching the files while the database writes them damages it.
    pgliteDir: env.PGLITE_DIR ?? (process.platform === 'win32' && env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, 'CrescentTrack', 'pgdata')
      : LEGACY_PGLITE_DIR),
    jwtSecret: env.JWT_SECRET || DEV_JWT_SECRET,
    // How long a sign-in lasts. Long enough that students are not all signed
    // out each morning and sign in together at the peak (the costly part of a
    // rush is bcrypt); a password change or suspension still cuts a session
    // off at once (auth.js requireRole).
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
    demoPassword: env.DEMO_PASSWORD || 'Demo@2026',
    seedDemoStudents: env.SEED_DEMO_STUDENTS !== '0',
    datasetPath: path.join(ROOT_DIR, 'data', 'bsacist_routes.json'),
    clientDist: path.join(ROOT_DIR, 'client', 'dist'),
    // All dates (subscription validity, registers, travel windows) are local to the campus.
    timeZone: env.TZ_CAMPUS || 'Asia/Kolkata',
    // When true the server runs its own timers (freshness, attendance, nightly
    // jobs, reconciliation). Tests switch this off and call the jobs directly.
    backgroundJobs: true,

    // Freshness state machine (doc 6.6).
    freshness: { liveSeconds: 30, delayedSeconds: 120 },

    // Server-side validation limits for every incoming GPS fix (doc 6.7).
    validation: {
      maxSpeedKmh: 120, // reported speed ceiling for a city bus
      maxImpliedSpeedKmh: 150, // speed implied by the jump from the previous fix
      maxAccuracyM: 100, // reject fixes the device itself says are poor
      maxFutureSkewS: 30, // device clock may run slightly ahead
      maxAgeS: 600, // buffered fixes older than 10 minutes are not "live" data
      serviceAreaMarginDeg: 0.25, // ~25 km around the outermost boarding point
    },

    // ETA (doc section 7).
    eta: {
      defaultSpeedKmh: 20, // historical average for Chennai traffic before any data exists
      stopArrivalRadiusM: 80, // a bus within this distance of a stop has reached it
      predictionSampleS: 60, // how often predictions are logged for the MAE report
      minSegmentSamples: 3, // learned segment times replace the timetable after this many trips
    },

    // Subscription and payment (doc section 8).
    subscription: {
      // Students use every feature free. Set STUDENT_SUBSCRIPTION_REQUIRED=1 to
      // put live tracking, alerts and attendance behind the paid plan again.
      studentRequired: env.STUDENT_SUBSCRIPTION_REQUIRED === '1',
      defaultPlan: 'MONTHLY_60',
      graceDays: 5,
      refundWindowDays: 7,
      pendingOrderMinutes: 5, // an order older than this with no webhook is reconciled
      reconcileEveryMinutes: 15,
    },
    payment: {
      // 'mock' is a built-in test gateway with the same webhook contract as Razorpay.
      // Set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET + RAZORPAY_WEBHOOK_SECRET for Razorpay test/live mode.
      mode: env.RAZORPAY_KEY_ID ? 'razorpay' : 'mock',
      keyId: env.RAZORPAY_KEY_ID || 'rzp_test_mock_ubts',
      keySecret: env.RAZORPAY_KEY_SECRET || '',
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || DEV_WEBHOOK_SECRET,
      // Comma-separated source addresses allowed to call the webhook; empty = any.
      webhookAllowedIps: (env.WEBHOOK_ALLOWED_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
      merchantName: env.MERCHANT_NAME || 'BSACIST Transport Department',
    },
    // Collection model (doc 8.9).
    finance: {
      gatewayFeeRate: 0.02,
      gstOnFeeRate: 0.18,
      monthlyRunningCostPaise: 1_270_000, // Rs 12,700
      studentsCarried: 1150,
    },

    // Automatic attendance (doc section 9).
    attendance: {
      rules: { ...DEFAULT_RULES },
      // Default travel windows, campus time. Students can set their own in Settings.
      travelWindows: env.TRAVEL_WINDOWS || '06:00-10:30,15:30-19:30',
      sampleIntervalS: 20,
      disputeWindowDays: 7,
      provisionalAutoConfirmHours: 72,
      nightlyLockAt: '23:30',
      trackerOfflineMinutes: 10, // open records are closed at the last position after this
      retentionDays: 365,
      boardingCodeWindowS: 60, // the in-bus QR / code rotates every minute
    },
    // "Did you board?" from the bus GPS (server/boarding.js): when the bus leaves
    // a student's saved stop, the student is asked, and reminded until they answer.
    boardingCheck: {
      enabled: env.BOARDING_CHECKS !== '0',
      remindEveryMinutes: Number(env.BOARDING_REMIND_MINUTES) || 10,
      departRadiusM: 150, // the bus has left a stop once it is this far past it
      giveUpAfterHours: 12, // a question nobody answers stops at the latest after this
    },
    // Hardware GPS trackers fitted in the buses (server/gps, docs/GPS_TRACKERS.md).
    gps: {
      // Raw TCP listeners for trackers that talk their own protocol. Off unless a
      // port is set: GT06 covers Concox and most GT06-family trackers, Teltonika
      // the FMB/FMC range (Codec 8 and 8 Extended).
      gt06Port: portOrNull(env.GPS_GT06_PORT),
      teltonikaPort: portOrNull(env.GPS_TELTONIKA_PORT),
      // Shared secret for positions forwarded by a Traccar server or a vendor
      // platform (POST /api/gps/webhook). Unset = that endpoint is off.
      webhookSecret: env.GPS_WEBHOOK_SECRET || null,
      // While a bus's tracker has reported within this time, the driver's phone
      // is on standby; it takes over by itself when the tracker goes quiet.
      preferTrackerForS: 60,
      // Trips started and ended by the tracker, so a bus is tracked even when
      // the driver never opens the app.
      autoTrips: env.GPS_AUTO_TRIPS !== '0',
      // Hours in which movement starts a trip (default: the travel windows).
      tripWindows: env.GPS_TRIP_WINDOWS || null,
      autoStartSpeedKmh: 8, // moving at least this fast ...
      autoStartAfterS: 15, // ... for this long starts a trip
      autoStartCooldownMin: 30, // no automatic start this soon after the bus's last trip ended
      autoEndParkedMin: 15, // parked this long near the first or last stop ends the trip
      autoEndAnywhereMin: 30, // parked this long anywhere ends it
      autoEndSilentMin: 20, // no position from the tracker this long ends it
      terminalRadiusM: 400,
      idleTimeoutS: 600, // a TCP connection that sends nothing for this long is closed
    },
    // Push notifications through Expo's push service (server/push.js).
    // EXPO_ACCESS_TOKEN is only needed if "enhanced push security" is on for the Expo project.
    push: { enabled: env.PUSH_NOTIFICATIONS !== '0', accessToken: env.EXPO_ACCESS_TOKEN || null },
    // Requests per minute: sign-in per address+username, sign-up per address.
    // A whole campus often shares one public address (college Wi-Fi), so the
    // sign-up limit must allow a class registering together in the first lecture.
    rateLimits: { login: 20, register: 60, orders: 10, webhook: 120, deviceFixes: 20, passwordChange: 5 },
    // Set TRUST_PROXY when the server sits behind a proxy (Render, Nginx): the number
    // of proxy hops (usually 1), or an Express "trust proxy" value. Off by default.
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    otp: { ttlMinutes: 10, maxAttempts: 5, showInResponse: env.NODE_ENV !== 'production' },

    emergencyContacts: [
      { label: 'Transport office', phone: '+91 44 2275 1347' },
      { label: 'Campus security (24 h)', phone: '+91 44 2275 1350' },
      { label: 'Police', phone: '100' },
      { label: 'Ambulance', phone: '108' },
    ],
    ...overrides,
  };
  config.usingDevSecret = config.jwtSecret === DEV_JWT_SECRET;
  config.usingDevWebhookSecret = config.payment.webhookSecret === DEV_WEBHOOK_SECRET;
  return config;
}
