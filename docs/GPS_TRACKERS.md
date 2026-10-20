# GPS trackers fitted in the buses

The app takes bus positions from two kinds of sender:

- **the driver's phone** (the driver app, as before), and
- **a GPS tracker fixed in the bus**: a box wired to the bus battery, with its own
  SIM and antenna.

Both feed the same pipeline: validation, the live map, arrival estimates, stop
arrivals and the GPS attendance engine. Each position is stored with its source
(`location_pings.source`, shown as "GPS tracker" in the admin screens).

## What changes when a bus has a tracker

- **The tracker comes first.** While it has reported within the last 60 seconds,
  the driver's phone is on standby: its positions are not used, and the driver app
  says so. If the tracker goes quiet (no network, unplugged), the phone takes over
  by itself, and the tracker takes back over when it returns.
- **Trips run themselves.** The driver no longer has to press "Start trip":
  - **Start:** the bus has been moving at 8 km/h or more for 15 seconds, inside the
    trip hours (the travel windows, 06:00-10:30 and 15:30-19:30 by default), and its
    last trip ended at least 30 minutes ago. The bus's assigned driver is recorded
    on the trip if there is one; a bus with no driver is tracked too.
  - **End** (trips the tracker started only):
    - parked 15 minutes within 400 m of the first or last stop, or
    - parked 30 minutes anywhere, or
    - 20 minutes without a position from the tracker, or
    - parked 5 minutes after the trip hours.

  A driver can still start and end trips by hand, and an administrator can end or
  cancel any trip. Trips a driver or administrator started are never ended
  automatically.

## Which way to connect your trackers

Find out the tracker's make and model (printed on the box, or ask the vendor who
fitted it), then pick a row:

| Your tracker | How it reaches the app | What to set on the server |
|---|---|---|
| **Concox / GT06-family** (GT06N, JM-VL01/02/03, X3, Wetrack, most unbranded "GT06" units) | Directly, raw TCP | `GPS_GT06_PORT=5023` |
| **Teltonika** FMB / FMC / FMM (Codec 8 or 8 Extended) | Directly, raw TCP | `GPS_TELTONIKA_PORT=5027` |
| Tracker with an **HTTP upload mode** (OsmAnd protocol), or a spare Android phone running **Traccar Client** left in the bus | Directly, HTTPS | nothing (normal web port) |
| **Any other model**: AIS-140 units, iTriangle, Atlanta, Queclink, Meitrack and the other 200+ protocols | Through a **Traccar** server, which forwards to the app | `GPS_WEBHOOK_SECRET=<long random text>` |
| Trackers already on a **vendor's tracking platform** that can push positions to a URL | The platform posts to the app's webhook | `GPS_WEBHOOK_SECRET=<long random text>` |

[Traccar](https://www.traccar.org) is a free, open-source GPS server that decodes
almost every tracker protocol. The app does not replace it; it accepts Traccar's
forwarded positions, so any tracker Traccar supports works here too.

## Step 1: open the server to trackers

Set the variables from the table (in `.env`, or your host's dashboard) and restart
the server. It prints what it is listening on:

```
  Trackers : GT06 on TCP port 5023
  Trackers : TELTONIKA on TCP port 5027
```

TCP trackers connect to the server's **public IP address or domain** on that port, so:

- **Open the port** in the server's firewall (and your router, if the server is at
  home or in the college).
- **Render (and most "web service" hosts) only accept HTTPS** on one port, so raw
  TCP trackers cannot reach the app there. Either run the app on a VPS (DigitalOcean,
  AWS Lightsail, Hetzner, ...) with Docker (`docker run -p 4000:4000 -p 5023:5023 -p 5027:5027 ...`),
  or keep the app on Render and run Traccar on a small VPS that forwards to it
  (webhook row above). HTTP (OsmAnd) senders and the webhook work on Render as they are.
- `START-PUBLIC-TEST.bat` (Cloudflare quick tunnel) carries HTTP only: fine for
  OsmAnd senders and the webhook, not for raw TCP trackers.

## Step 2: register each tracker

Admin dashboard → **Fleet → GPS trackers → Add tracker** (or on the phone app:
Fleet → GPS):

- **Tracker ID:** the 15-digit **IMEI** on the tracker's label (for HTTP senders,
  the "device identifier" you configure in them);
- **Protocol** and **Fitted in bus**.

Then press **Setup** for the exact server address, port and commands for that
tracker. An HTTP tracker also gets a **key**, shown once, which goes into its
server URL.

A tracker that connects before it is registered is refused, but it is listed under
**"Trackers trying to connect"** with a **Register** button: switch the tracker on,
wait for it to appear, and register it in one click.

## Step 3: point the tracker at the server

The commands below are the usual ones. Models and firmware differ, so check the
manual or ask the vendor; the Setup button fills in your server and port.

### Concox / GT06 family (SMS to the tracker's SIM number)

```
APN,airtelgprs.com#              the SIM's APN (Jio: jionet, Vi: www, BSNL: bsnlnet)
SERVER,1,gps.example.edu,5023,0# domain (use SERVER,0,203.0.113.10,5023,0# for an IP)
GMT,E,0,0#                       report times in UTC
TIMER,10,60#                     a position every 10 s while driving
```

### Teltonika FMB / FMC

In **Teltonika Configurator**:
- **GPRS → Server settings:** domain, port 5027, protocol TCP;
- **System → Data protocol:** Codec 8 or Codec 8 Extended;
- **Data acquisition → On moving:** period 10 s.

Or by SMS, with two spaces before `setparam` (empty login and password):

```
  setparam 2001:airtelgprs.com;2004:gps.example.edu;2005:5027;2006:0
```

### HTTP (OsmAnd protocol) and Traccar Client

- **Server URL:** `https://your-app/api/gps/osmand/<tracker key>`
- **Device identifier:** the Tracker ID you registered.
- **Frequency:** 10 s.

The sender adds `?id=...&lat=...&lon=...&timestamp=...&speed=...&bearing=...`, with
speed in knots, as Traccar Client does. The key can also go in the `key` query
parameter or an `X-Tracker-Key` header.

### Traccar server forwarding

In `traccar.xml`:

```xml
<entry key='forward.enable'>true</entry>
<entry key='forward.type'>json</entry>
<entry key='forward.url'>https://your-app/api/gps/webhook?secret=YOUR_GPS_WEBHOOK_SECRET</entry>
```

Register each tracker in the app with the **same unique id** it has in Traccar.

### A vendor platform or your own bridge

POST JSON to `https://your-app/api/gps/webhook` with the header
`Authorization: Bearer <GPS_WEBHOOK_SECRET>`. Send one position, a list, or
`{ "positions": [...] }`, each like:

```json
{ "imei": "864123456789012", "lat": 12.9716, "lng": 80.2209, "speedKmh": 32,
  "heading": 90, "recordedAt": "2026-10-16T08:00:00Z", "ignition": true }
```

`uniqueId`, `deviceId`, `latitude`/`longitude`, `course` and `time` are understood too.

## Step 4: check it works

Fleet → GPS trackers shows each tracker's state, refreshed every 10 seconds:

| Status | Meaning |
|---|---|
| online / **Live on the map** | Positions arrive and are on the live map. |
| **Waiting** + reason | Positions arrive, but no trip is running; the reason says why (outside trip hours, not moving yet, ...). |
| **No GPS fix** | Connected, but no satellite fix: antenna covered, or the bus is indoors. |
| **Position rejected** + reason | The position failed validation; the reason says which check. |
| **No bus assigned** / **Switched off** | Fix it in the tracker's Edit. |
| offline | Nothing heard for 2 minutes. |

No hardware yet? Watch simulated trackers drive the routes, using the real protocols:

```bash
npm run simulate:trackers                                 # GT06 on buses 118 and 119
npm run simulate:trackers -- --protocol teltonika --routes 117
npm run simulate:trackers -- --protocol osmand --routes 127
```

Start the server with `GPS_GT06_PORT=5023` / `GPS_TELTONIKA_PORT=5027`, and with
`TRAVEL_WINDOWS=00:00-24:00` to test outside the trip hours.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Tracker never appears, not even under "trying to connect" | Wrong server or port in the tracker, port closed in the firewall, no data on the SIM (APN, balance), or the host blocks raw TCP (Render). |
| Listed under "trying to connect" | Not registered, or registered with a different ID: use the IMEI exactly. |
| "Position rejected: FUTURE_TIMESTAMP" (about 5.5 hours ahead) | The tracker reports local time: send `GMT,E,0,0#` (GT06). |
| "Position rejected: OUTSIDE_SERVICE_AREA" or "STALE_FIX" | The tracker is far from the routes, or uploading old buffered positions (older than 10 minutes). |
| "Waiting: outside the trip hours" | Expected outside the travel windows. Change them with `GPS_TRIP_WINDOWS` (e.g. `06:00-11:00,15:00-20:00`). |
| Trips start or end at odd times | Tune the rules in `server/config.js` (`gps.*`), or turn automatic trips off with `GPS_AUTO_TRIPS=0` (drivers start and end trips; the tracker only supplies positions). |

## Security

- **TCP trackers** identify themselves only by IMEI, a limit of the protocols. The
  app accepts only registered, switched-on IMEIs. Treat the IMEI list as private.
- **HTTP senders** need their own key; only its hash is stored. Use **New key** if
  one leaks.
- The **webhook** needs `GPS_WEBHOOK_SECRET`. Use a long random value and HTTPS.
- Every add, edit, key change and removal is in the audit log, and so is every
  automatic trip start and end, with its reason.

## Code map

| File | What it does |
|---|---|
| `server/gps/trackers.js` | Registry, sign-in, live status, automatic trips, HTTP endpoints, admin API |
| `server/gps/gt06.js`, `server/gps/teltonika.js` | Protocol decoders (and encoders, for the simulator and tests) |
| `server/gps/formats.js` | OsmAnd, Traccar forwarding and the generic webhook format |
| `server/gps/tcp.js` | The TCP listeners and per-connection sessions |
| `server/tracking.js` | Source priority (`trackerActive`), source stored per position |
| `test/trackers.test.js` | Decoders byte for byte; whole trackers over HTTP and TCP |
| `scripts/simulate-trackers.js` | Simulated trackers on the real routes |
