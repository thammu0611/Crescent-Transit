# Phase-2 Review — Presentation and Demo Script

Presentation: 5–7 minutes, then the live demo of Module 1.
Speaker notes with timings are in every slide of the deck.

## Before the review (10 minutes earlier)

1. Laptop on charger, internet on (map tiles come from OpenStreetMap).
2. Double-click `RUN-DEMO.bat`. It opens:
   - a **server** window (leave it open),
   - a **simulator** window: buses 117, 118, 119 and 127 moving, some bad
     fixes injected, and bus 127 goes silent after 40 s,
   - the **live map** and the **driver app** in the browser.
3. Check http://localhost:4000/api/health shows `"ok": true`.
4. Open `server/validation.js` and `server/tracking.js` in VS Code (for
   "explain the source code").
5. If you ran demos before and want a clean start: close both windows,
   run `npm run reset-db`, then `RUN-DEMO.bat` again.

## Slide timing (≈ 6½ min)

| Slides | Topic | Time |
|---|---|---|
| 1–2 | Title, rubric coverage | 0:25 |
| 3–4 | Existing systems, limitations | 1:00 |
| 5–8 | Literature survey and comparison | 1:20 |
| 9–12 | Gap, solution, objectives, scope | 1:30 |
| 13–14 | Technology, dataset | 0:45 |
| 15–18 | System design | 1:00 |
| 19–22 | Module 1 status, screens, code, results | 1:00 then demo |

Explain; do not read. The rubric says the proposed solution must be explained
*without reading the PPT*.

## Live demo (≈ 3 min)

1. **Live map** tab: "Four buses are on trips right now, sent by the simulator
   through the same API the driver app uses." Point at the counters and the
   green markers.
2. **Driver App** tab: sign in as `drv120` (password in README). Select
   *Simulate along route*, 5 seconds, **Start trip**. Show the transmission log:
   *Accepted*.
3. Back to **Live map**: bus 120 appears. Click it: route 120, stops, timeline,
   nearest stop highlighted. "Updated 3 s ago · Live".
4. **Driver App** ➜ *Test server validation*: click **0,0 fix**, then
   **12 km jump**. Log shows `NULL_ISLAND` and `IMPOSSIBLE_JUMP` with the reason.
   Live map: bus did **not** move.
5. **Bus 127** (simulator stopped it): show it turned **Delayed** after 30 s
   and **Offline** after 2 min, with "Last seen near …".
6. Show http://localhost:4000/api/stats: accepted vs rejected by reason.
7. Optional: in a terminal `npm test` ➜ 29 passing (takes ~30 s).
8. **End trip** in the driver app: bus 120 disappears from the map.

## If something goes wrong

| Problem | Fix |
|---|---|
| Map is grey | No internet: tiles cannot load. Markers and sidebar still work. Use a phone hotspot. |
| "Could not start the simulation" | Server not running yet: start it first, then the simulator. |
| Port 4000 in use | Close the old server window, or `set PORT=4100` before starting both. |
| Driver fixes all `IMPOSSIBLE_JUMP` | You resumed an old trip far away. After 3 consistent fixes the server re-anchors automatically, or End trip and Start again. |
| Phone GPS "error" | Browsers allow location only on https or localhost; use *Simulate along route*. |
