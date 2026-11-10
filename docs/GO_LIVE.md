# Going live: Crescent Transit for daily use

This turns the demo into the real service: real accounts, a database that keeps
its data, live bus updates, and email for codes. It takes about an hour.

## What changes in live mode (`DEMO_MODE=0`)

| Demo | Live |
| --- | --- |
| Every account uses `Demo@2026` | The admin password comes from `ADMIN_PASSWORD`; drivers get a temporary password from the admin and choose their own at first sign-in |
| 24 demo students (stu001–stu024), a finance account | None. Students register themselves with their university email |
| "Demo accounts" box on sign-in, simulated bus, bad-fix buttons, transmission log, "ride along" | Hidden |
| Test payment gateway | Off. The bus fee is paid on DigiiCampus (Settings → Pay bus fee) |
| Codes shown on screen | Codes are emailed (university email check, forgot password) |

The server refuses to start in production without `JWT_SECRET` and
`DATABASE_URL`, so data can never be lost silently again.

## 1. Database: Neon (free)

1. Sign up at https://neon.tech and create a project (region: Singapore, the closest to Chennai).
2. Copy the **connection string** (`postgresql://…?sslmode=require`). This is `DATABASE_URL`.

## 2. Email: an SMTP mailbox

Ask university IT for a sending mailbox, e.g. `transport@<university domain>`
(Microsoft 365: host `smtp.office365.com`, port `587`, with SMTP AUTH enabled for
that mailbox). Any SMTP provider works (Brevo, Gmail with an app password, …).

You need: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

Also confirm the **students' email domain** on DigiiCampus (the part after `@`):
this is `STUDENT_EMAIL_DOMAIN`.

## 3. Server: Render

1. Push this repository to GitHub (already: `thammu0611/Crescent-Transit`).
2. Render → **New → Blueprint** → pick the repository. Render reads `render.yaml`.
3. Fill in the values it asks for:
   - `DATABASE_URL`: from Neon
   - `ADMIN_PASSWORD`: a strong password (10+ characters) for the `admin` account
   - `STUDENT_EMAIL_DOMAIN`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
   - `VITE_GOOGLE_MAPS_API_KEY`: optional
4. Deploy. The address looks like `https://crescent-transit.onrender.com`.
5. Open it and sign in as `admin` with `ADMIN_PASSWORD`.

The free Render plan sleeps after 15 minutes without visitors (the first visit then
takes about 30 s). For daily use choose the **Starter** plan so it is always on,
buses update live, and the morning jobs run on time.

## 4. Drivers

Admin → **Fleet** → each driver → **Reset to a temporary password**. Give the driver
their username (`drv118` for route 118, …) and that password. At first sign-in the
app asks them to choose their own.

## 5. Phone app

Build the APK against the live server: in `mobile-app/.env.local` set

```
EXPO_PUBLIC_API_URL=https://crescent-transit.onrender.com
```

then build as usual. Share the APK with students and drivers.

## 6. Students

Students open the app → **New student** → register with their university email →
enter the code emailed to them. Forgot password → a code to the same email.

## Checklist

- [ ] Neon database created, `DATABASE_URL` set
- [ ] `ADMIN_PASSWORD` set, admin can sign in
- [ ] SMTP set; a test student receives the verification code
- [ ] `STUDENT_EMAIL_DOMAIN` matches DigiiCampus emails
- [ ] Every driver has a temporary password and has chosen their own
- [ ] APK built with the live server address
- [ ] (Later) DigiiCampus single sign-on: docs/DIGIICAMPUS_INTEGRATION_REQUEST.md

## Driver phones: location with the phone locked

The installed app keeps sharing the bus location with the phone locked or another
app open. **Expo Go cannot do this**: test it on a built APK.

On each driver's phone:

1. Install the app and start a trip once with **Location source: Phone**.
2. When Android asks, choose **Allow all the time** for location.
3. Tap **Stop the phone closing this app** and set the app to **Unrestricted** or
   **No restrictions**. Xiaomi, Oppo, Vivo, Realme and Samsung phones close
   background apps hard: also allow **Autostart** and lock the app in recent apps.
4. A "Trip running" notification shows while it shares. That is expected.

### Field test before real use

Do this on a real bus, on each brand of phone the drivers use.

| Test | Pass when |
| --- | --- |
| Lock the phone for 20 minutes during a trip | The bus stays Live on the map throughout |
| Open WhatsApp and a phone call for 10 minutes | The bus stays Live |
| Drive through a dead zone | Positions catch up on their own afterwards |
| Restart the phone mid-trip | The dashboard shows a silent-bus alert within 5 minutes |
| End the trip | The notification disappears, and no more positions arrive |

## Backups

Set `BACKUP_KEY` and the `BACKUP_S3_*` settings before real use. A backup runs every
night, is read back in full to prove it is good, and shows on the dashboard.

| Task | Command |
| --- | --- |
| Back up now | `npm run backup` |
| Check a file, changing nothing | `npm run restore -- <file>` |
| Replace the database with a file | `npm run restore -- <file> --yes` |

Stop the server before restoring. **Practise a restore once a term** on a spare
database, because an untested backup is only a hope. Choose a database plan with its
own daily backups too; these are a second copy, not a replacement.

## How long data is kept

| Data | Kept for |
| --- | --- |
| Bus location history | 90 days (`LOCATION_RETENTION_DAYS`, at most 365) |
| Rejected GPS readings | 30 days |
| Error log | 90 days |
| Attendance records | 365 days, then only monthly totals per route |
| Payments | Kept for the accounts, without a name once an account is deleted |

Students' own location is never stored.

## The yearly routine

Everything is in **Fleet > Students and year**. Each upload shows what would change
before anything does.

1. **Student list** (CSV): `register_no, full_name, email`, and optionally `department,
   route, stop, graduation_year, phone`. New students sign in with **Forgot password**
   on their university email, which needs SMTP set up.
2. **Route circular** (CSV): `route, route_name, stop_name, time, lat, lng`, one row
   per stop in travel order. Load it when no bus is running. Students follow their
   stop by name; anyone whose stop has gone chooses a new one.
3. **End of the year**: stop graduates signing in, or remove their personal data.

## Alerts

Set `ALERT_EMAIL` (with SMTP) or `ALERT_WEBHOOK_URL`. Someone is told about server
errors, failed jobs and backups, a bus silent for 5 minutes during a trip, and buses
not started 15 minutes after their departure time (not on holidays). The dashboard's
**System health** card shows the same, and lists anything set up wrongly.

## Parents with iPhones

There is no iPhone app yet: that needs an Apple Developer account and a build. Parents
open the website in Safari and choose **Share > Add to Home Screen**; it then opens
like an app.

## Another college

Each college runs **its own copy**, with its own database: the safest way to keep one
college's students out of another's. Set `APP_NAME`, `COLLEGE_NAME`,
`COLLEGE_SHORT_NAME`, the phone numbers and `ROUTES_FILE`. The logo, campus map position
and a few phone numbers on the website and in the phone app are still in the code, so a
new college also needs its own build. One shared copy for many colleges would need a
college field through every table, and is a project of its own.
