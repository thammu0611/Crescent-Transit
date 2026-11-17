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
  // Demo mode: the shared demo password, demo students and the demo tools
  // (simulated bus, test payments). On by default except in production;
  // DEMO_MODE=1 or 0 overrides.
  const demoMode = env.DEMO_MODE === '1' ? true : env.DEMO_MODE === '0' ? false : env.NODE_ENV !== 'production';
  const config = {
    demoMode,
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
    seedDemoStudents: env.SEED_DEMO_STUDENTS ? env.SEED_DEMO_STUDENTS !== '0' : demoMode,
    // Outside demo mode: the first administrator's password, used once when the
    // database is empty. Drivers get theirs from the administrator.
    adminPassword: env.ADMIN_PASSWORD || null,
    // Production refuses the embedded database (its data would be lost on the
    // next deploy) unless this is set on a server with a persistent disk.
    allowEmbeddedDb: env.ALLOW_EMBEDDED_DB === '1',
    datasetPath: env.ROUTES_FILE || path.join(ROOT_DIR, 'data', 'bsacist_routes.json'),
    clientDist: path.join(ROOT_DIR, 'client', 'dist'),
    // All dates (subscription validity, registers, travel windows) are local to the campus.
    timeZone: env.TZ_CAMPUS || 'Asia/Kolkata',
    // A trip started from this time (campus time) is the DOWN run unless the driver says otherwise.
    eveningRunFrom: env.EVENING_RUN_FROM || '12:00',
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

    // Students' university email (the one DigiiCampus holds). With a domain set,
    // only addresses @that-domain are accepted; with STUDENT_EMAIL_VERIFY=1 a
    // student confirms the address with an emailed code before using the app.
    studentEmail: {
      domain: (env.STUDENT_EMAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, '') || null,
      verify: env.STUDENT_EMAIL_VERIFY === '1',
      codeTtlMinutes: 10,
      maxAttempts: 5,
      resendSeconds: 60,
    },
    // Outgoing mail for those codes.
    smtp: {
      host: env.SMTP_HOST || null,
      port: Number(env.SMTP_PORT ?? 587),
      secure: env.SMTP_SECURE === '1',
      user: env.SMTP_USER || null,
      pass: env.SMTP_PASS || null,
      from: env.SMTP_FROM || 'Crescent Transit <no-reply@crescent.education>',
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
    // "Another bus can take you": the student's bus passed, went quiet or has not started.
    busAlternatives: {
      enabled: env.BUS_ALTERNATIVES !== '0',
      nearbyM: Number(env.BUS_ALTERNATIVES_NEARBY_M) || 1500, // how far from their stop a student can be sent
      lateAfterMinutes: 15, // a bus this late for the stop counts as not coming
      askWaitMinutes: 3, // time to answer "Did you board?" before the alert goes out
      maxOptions: 3,
    },
    // Parents linked to a student with a one-time code.
    guardians: { codeValidHours: 24 },
    // The digital pass's QR code changes this often, so a screenshot stops working.
    busPass: { codeValidS: 90 },
    // What happens by itself from the bus position (server/automation.js).
    automation: {
      stopAlerts: env.STOP_ALERTS !== '0',
      stopAlertMinutes: Number(env.STOP_ALERT_MINUTES) || 5, // push this long before the bus reaches the stop
      stopAlertEveryS: 30, // how often one bus is checked
      autoEndAtGeofence: env.AUTO_END_TRIPS !== '0',
      // A trip still running this many hours after it started was forgotten: end it.
      staleTripHours: Number(env.STALE_TRIP_HOURS) || 8,
      geofenceM: 300, // inside this far of the run's last stop
      geofenceDwellMin: 3, // for this long, and the trip ends
      speedLimitKmh: Number(env.SPEED_LIMIT_KMH) || 65,
      speedFixesInARow: 2, // one bad reading is not speeding
      speedAlertEveryMin: 10, // per trip
      lateAfterMinutes: Number(env.LATE_AFTER_MINUTES) || 10, // this far behind the timetable is "running late"
      lateIgnoreOverMinutes: 180, // further off than this is not this run's timetable
    },
    service: { feedbackDays: 7 },
    // Little-used stops: this few boardings in the period, and a stop this close to merge into.
    fleetCare: { quietStopBoardings: 2, mergeWithinM: 800 },
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
    otp: { ttlMinutes: 10, maxAttempts: 5, resendSeconds: 60, showInResponse: demoMode && env.NODE_ENV !== 'production' },
    passwordReset: { codeTtlMinutes: 15, maxAttempts: 5, resendSeconds: 60 },

    // The college this copy of the app serves. Another college runs its own copy
    // with its own database and these settings (docs/GO_LIVE.md).
    institution: {
      appName: env.APP_NAME || 'Crescent Transit',
      name: env.COLLEGE_NAME || 'B.S. Abdur Rahman Crescent Institute of Science & Technology',
      shortName: env.COLLEGE_SHORT_NAME || 'BSACIST',
    },

    // How long data is kept (doc 9.11). The privacy notice promises at most a year.
    retention: {
      locationDays: Math.min(365, Number(env.LOCATION_RETENTION_DAYS) || 90),
      rejectedDays: 30,
      eventDays: 90,
      attendanceDays: 365,
    },

    // Daily database copy (server/backup.js).
    backup: {
      enabled: env.BACKUP_ENABLED !== '0',
      dir: env.BACKUP_DIR || null, // default: beside the local database
      keep: Number(env.BACKUP_KEEP) || 14,
      at: env.BACKUP_AT || '01:30',
      key: env.BACKUP_KEY || null,
      s3: env.BACKUP_S3_BUCKET ? {
        bucket: env.BACKUP_S3_BUCKET,
        endpoint: env.BACKUP_S3_ENDPOINT || `https://s3.${env.BACKUP_S3_REGION || 'ap-south-1'}.amazonaws.com`,
        region: env.BACKUP_S3_REGION || 'ap-south-1',
        accessKey: env.BACKUP_S3_ACCESS_KEY,
        secretKey: env.BACKUP_S3_SECRET_KEY,
        prefix: env.BACKUP_S3_PREFIX || 'backups/',
      } : null,
    },

    // Days of the week the buses never run (0 = Sunday ... 6 = Saturday). A calendar entry on
    // one of these days with buses running (a special working Sunday) overrides it.
    calendar: {
      closedWeekdays: (env.NO_SERVICE_WEEKDAYS ?? '0').split(',').map((d) => d.trim()).filter((d) => /^[0-6]$/.test(d)).map(Number),
    },

    // Who is told when something goes wrong (server/monitor.js).
    monitor: {
      alertEmail: env.ALERT_EMAIL || null,
      webhookUrl: env.ALERT_WEBHOOK_URL || null,
      repeatMinutes: 30, // the same problem is not sent again sooner than this
      silentMinutes: Number(env.SILENT_BUS_MINUTES) || 5,
      missedStartMinutes: Number(env.MISSED_START_MINUTES) || 15,
      serviceDays: [1, 2, 3, 4, 5, 6], // Monday to Saturday
      // Demo data has no real buses, so nothing is watched there unless asked.
      watchBuses: env.MONITOR_BUSES ? env.MONITOR_BUSES !== '0' : !demoMode,
    },

    // Websites allowed to open the live connection, besides the app's own address.
    // Phone apps send no origin and are always allowed.
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),

    // Where links in messages point (the renew link): the website's address.
    appUrl: (env.APP_URL || (env.ALLOWED_ORIGINS ?? '').split(',')[0] || '').trim().replace(/\/$/, '') || null,

    // Things the system does by itself on a timer (server/followups.js, server/escalation.js,
    // server/insights.js, server/weekly.js, server/autostart.js).
    followups: {
      renewDaysBefore: [3, 0], // push 3 days before a subscription ends and on its last day; then when grace starts
      checklistBeforeMin: 15, // remind the driver this long before the run if the pre-trip check is not done
      complaintRemindHours: 48, // an unanswered complaint reminds the service desk ...
      complaintEscalateHours: 72, // ... then goes to the transport head
      serviceCredits: env.SERVICE_CREDITS !== '0', // a day added for a run that did not happen
    },
    escalation: {
      afterMinutes: Number(env.ESCALATE_AFTER_MIN) || 5,
      // Usernames in order: the next person, then the transport head (last).
      chain: (env.ESCALATE_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
    },
    weeklyReport: {
      enabled: env.WEEKLY_REPORT !== '0',
      to: (env.WEEKLY_REPORT_TO || env.ALERT_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean),
      weekday: 1, // Monday
      at: env.WEEKLY_REPORT_AT || '07:30',
    },
    insights: {
      timetableMinStops: 3, // a route's timetable is looked at once this many stops differ ...
      timetableDiffMin: 4, // ... by at least this many minutes on average
      timetableMinTrips: 5, // over at least this many recent trips
      crowdedTrips: 3, // FULL this many times in the last ...
      crowdedDays: 10, // ... days flags the route
    },
    // Phone-only drivers: the trip starts by itself once the phone leaves the depot
    // in trip hours (server/autostart.js). Uses the GPS tracker thresholds above.
    phoneAutoStart: { enabled: env.PHONE_AUTO_START !== '0', leaveDepotM: 300 },
    // WhatsApp or SMS to parents who do not use the app (server/messaging.js).
    // WhatsApp: Meta's WhatsApp Cloud API with an approved template that has one
    // text variable ({{1}}). SMS: Twilio. Nothing is sent until one is set.
    messaging: {
      whatsapp: env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID ? {
        token: env.WHATSAPP_TOKEN,
        phoneId: env.WHATSAPP_PHONE_ID,
        template: env.WHATSAPP_TEMPLATE || 'transport_update',
        language: env.WHATSAPP_TEMPLATE_LANG || 'en',
        apiVersion: env.WHATSAPP_API_VERSION || 'v20.0',
      } : null,
      sms: env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM ? {
        sid: env.TWILIO_ACCOUNT_SID,
        token: env.TWILIO_AUTH_TOKEN,
        from: env.TWILIO_FROM,
      } : null,
      defaultCountry: env.PHONE_COUNTRY_CODE || '91',
      // Rough cost per message in paise, for the transport office's count.
      costPaise: { whatsapp: Number(env.WHATSAPP_COST_PAISE) || 80, sms: Number(env.SMS_COST_PAISE) || 25 },
      maxContactsPerStudent: 2,
    },

    emergencyContacts: [
      { label: 'Transport office', phone: env.TRANSPORT_OFFICE_PHONE || '+91 44 2275 1347' },
      { label: 'Campus security (24 h)', phone: env.CAMPUS_SECURITY_PHONE || '+91 44 2275 1350' },
      { label: 'Police', phone: '100' },
      { label: 'Ambulance', phone: '108' },
    ],
    ...overrides,
  };
  config.backup.dir ??= path.join(config.pgliteDir ? path.dirname(config.pgliteDir) : ROOT_DIR, 'backups');
  config.usingDevSecret = config.jwtSecret === DEV_JWT_SECRET;
  config.production = env.NODE_ENV === 'production';
  config.usingDevWebhookSecret = config.payment.webhookSecret === DEV_WEBHOOK_SECRET;
  return config;
}
