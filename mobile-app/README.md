# Crescent Transit — mobile app (React Native / Expo)

The Android and iOS app for the University Bus Tracking System. It is a
**separate project** from the React web app in `../client`: its own
`package.json`, its own `node_modules`, its own screens. Both apps talk to the
**same backend** (`../server`: REST API + Socket.IO + PostgreSQL), so accounts,
subscriptions, trips and attendance are shared.

```
university-bus-tracking/
├── client/        React web app (unchanged)
├── server/        Node.js backend, used by both apps (unchanged)
├── shared/        ETA / freshness / geometry rules, used by server, web and mobile (unchanged)
└── mobile-app/    this project
```

The only thing the mobile app reads from outside its folder is `../shared`
(see `metro.config.js`), so arrival estimates and Live/Delayed/Offline states
are computed by the exact same code everywhere.

## Run it on your phone (Expo Go)

**Easiest: double-click `mobile-app/RUN-MOBILE.bat`.** It starts the backend
(port 4000) in its own window if it is not already running, then starts the
app through the Expo tunnel. When "Tunnel ready" and a QR code appear:

- **Android:** open Expo Go and scan the QR code.
- **iPhone:** scan it with the Camera app, or type the `exp://…` address into Safari.

Install or update **Expo Go** first (it must support SDK 57).

By hand, from a terminal:

```bash
cd mobile-app
npm install
npm start
```

`npm start` (and `npm run tunnel`) use **tunnel mode**: the app loads over
the internet, and its API and live-bus calls go through the same tunnel to the
backend on port 4000 (`metro.config.js` forwards them). This works on any
network, including Wi-Fi that Windows marks *Public* (its firewall blocks
phones from a plain `expo start`). While it runs, the dev server and backend
are reachable at a random `*.exp.direct` address; stop it with Ctrl+C when done.

> **Do not run `npm audit fix --force` in `mobile-app`.** npm suggests it after
> every install, but it "fixes" warnings by downgrading Expo and React Native
> to old versions (e.g. Expo 44), after which Expo Go cannot open the app.
> If it happens, restore with `npm install expo@~57.0.26 react-native@0.86.3`
> then `npx expo install --fix`.

On a *Private* Wi-Fi you can skip the tunnel with `npm run lan`; the app then
calls the backend at `http://<your computer's IP>:4000`. If that cannot connect:

- Allow Node.js through **Windows Firewall** for private networks (port 4000).
- Or set the address by hand: sign-in screen → **Server** → e.g. `http://192.168.29.242:4000` → *Save and test* (a saved address is ignored in tunnel mode).
- Or start Expo with `EXPO_PUBLIC_API_URL=http://192.168.29.242:4000 npx expo start`.

Demo accounts are the same as the web app (password `Demo@2026`):
`stu001`–`stu024`, `drv118`…, `admin`, `finance`.
Note: when the simulator runs with `--riders`, it binds the demo students to
simulated phones, so the Attendance screen on a real phone will ask for a
one-time code to move the account (the test-mode code is shown on screen).

## Web → mobile mapping

| Web (React) | Mobile (React Native) |
|---|---|
| Hash routes in `App.jsx` (`NAV` table) | React Navigation: one navigator per role (`src/navigation.js`) |
| Student phone tab bar (Home, Track, Schedule, Attendance, Profile) | Bottom tabs, same five |
| Admin top menu (8 pages) | Tabs: Dashboard, Fleet map, Trips, More → Attendance, Routes, Buses & drivers, Alerts, Reports |
| Finance menu (4 pages) | Bottom tabs, same four |
| Leaflet maps (`react-leaflet`) | `react-native-maps` (Google Maps on Android, Apple Maps on iOS) |
| HTML + CSS | React Native views; colours from the web CSS variables (`src/theme.js`) |
| SVG icon set (`Icon.jsx`) | Same path data via `react-native-svg` (`Icon.js`) |
| `<table>` | Card lists (`DataList`, `ItemCard`) |
| `<select>` | Searchable bottom-sheet picker (`Select`) |
| `<input type="date/datetime-local/month">` | Native date/time pickers (`DateField`), month stepper (`MonthPicker`) |
| `Modal`, `window.confirm`, `window.prompt` | Bottom sheets, `Alert`, `PromptProvider` |
| `localStorage` session | `expo-secure-store` (Keychain / Keystore) |
| `localStorage` QR queue, device id, cleared alerts | AsyncStorage |
| `fetch('/api/...')` via Vite proxy | `fetch(<server>/api/...)` — same endpoints, same Bearer token |
| `socket.io-client` | Same library, websocket transport |
| `navigator.geolocation` | `expo-location` (also reports Android mock-location, which the server already flags) |
| `BarcodeDetector` camera scan | `expo-camera` QR scanning |
| Browser `Notification` | `expo-notifications` local notifications |
| File download (CSV, PDF receipt) | Download + system share sheet (`expo-file-system`, `expo-sharing`) |
| `<input type="file">` (CSV upload) | `expo-document-picker` |
| Razorpay `checkout.js` | Razorpay's hosted checkout in a WebView; built-in test gateway as a native sheet |
| `qrcode` → `<img>` (driver boarding QR) | `react-native-qrcode-svg` |
| `navigator.vibrate` | `Vibration` |
| `tel:` links | `Linking.openURL('tel:…')` |
| Page reload | Pull to refresh |

Every web screen has a mobile counterpart with the same API calls,
validation, permissions and messages: public home + free view, sign-in and
student registration; student home (route card, ETA band, "Leave now",
map preview, bus contact, report problem / SOS), live map with paywall,
schedule, alerts, subscription + checkout + receipts, attendance (sampling
status, one-time-code device move, QR / typed check-in with offline queue,
records, disputes), settings and privacy consent, the boarding prompt; the
driver app (trip start/end, GPS or simulated route, buffered batch upload,
crowd level, rotating boarding QR, on-board list and manual marking, problem
tiles, validation tests, transmission log); the admin dashboard, fleet map,
trips with register and replay, attendance review, route builder
(long-press to add a stop, drag to move, reorder), buses and drivers,
announcements and incidents, reports with CSV export; and finance
collections, payments and refunds, students and suspensions, reconciliation
and audit log.

## Limits of Expo Go (and what a store build changes)

- **Foreground only.** Like the web app, location (driver sharing and
  student attendance sampling) runs while the app is open. True background
  location and closed-app push (FCM/APNs) need a development or store build
  (`expo-task-manager`, remote push); `devices.push_token` already exists on the server.
- **Plain HTTP** to a LAN server works in Expo Go. A store build should use an
  HTTPS backend (Android blocks clear-text HTTP in release builds by default).
- Google Maps on Android in a store build needs a Maps API key in `app.json`.

Build for the stores with EAS: `npx eas-cli@latest build --platform android|ios`.

## Checks

```bash
npx expo-doctor                                            # dependency and config checks
npx expo export --platform android --platform ios          # compiles every screen for both platforms
```
