# CresTrack (Crescent Transit) — UI Polish Prompt

You are a senior product designer and front-end engineer. Your job is to raise the UI of this project — the React web app in `client/` and the Expo React Native app in `mobile-app/` — to a polished, production-quality level. **Every existing feature, screen, route, API call, socket event and piece of business logic must keep working exactly as it does now.** This is a visual and UX refinement, not a rewrite.

## 0. Hard rules (read first, never break)

1. **Do not change behaviour.** Do not touch `server/`, `shared/`, `api/`, `scripts/`, `data/`, or any file under `client/src/lib/` or `mobile-app/src/lib/` (api, session, sampler, schedule, format, hooks, notify, rules, storage, events). Do not change props, state logic, effects, data fetching, socket handlers, timers, or form submit logic in components — only markup structure, class names, styles and purely presentational sub-components.
2. **Keep every screen and every role:** guest, student, driver, admin, and the finance account (the finance app stays *switched off*, showing the `FinanceOff` panel — keep the commented-out finance code as it is).
3. **Keep every route path and nav entry** in `client/src/App.jsx` `NAV` and in `mobile-app/src/navigation.js`, with the same labels and order, unless a label is clearly wrong.
4. **Keep all text that carries meaning** (ETA bands like "0–4 min", "Did you board?", status names Live / Delayed / Offline, ₹ amounts, phone numbers, attendance rules). You may improve microcopy for clarity, but never change numbers, rules or meanings.
5. **Keep the brand:** navy `#1c315e`, gold `#f7bc31`, crimson `#a02022`, slate `#3e4c57`, light grey `#f1f1f1`; Inter for interface text, Poppins only for the logo and large headings/figures (22px+). Status colours (live green, delayed amber, offline grey, danger crimson) stay functional and must never be used decoratively.
6. **No new heavy dependencies.** No UI kits (MUI, Chakra, Tailwind, etc.). Plain CSS on web, `StyleSheet` + the existing `theme.js` on mobile. Small, well-known packages only if truly needed — ask first.
7. Work **one area at a time**, run the app after each step, and confirm nothing broke before moving on. Run `npm test` and `npm run build` at the end; both must pass.

## 1. Fix the foundation first (web)

`client/src/main.jsx` imports ten stylesheets that override each other: `styles.css`, `app-ui.css`, `staff-ui.css`, `public-ui.css`, `mobile-look.css`, `admin-kit.css`, `liquid-glass.css`, `layout.css`, `navbar.css`, `motion.css`.

- Audit them for duplicate and conflicting rules (same selector defined in several files, `!important` wars, values that undo each other). List what you find before changing anything.
- Consolidate design tokens into one `:root` block in `styles.css`: colours, a **type scale** (e.g. 12 / 13 / 14 / 16 / 18 / 22 / 28 / 36), a **spacing scale** on a 4px grid (4, 8, 12, 16, 20, 24, 32, 40, 48, 64), radii (8 / 12 / 16 / 24 / full), shadows (sm / md / lg), z-index layers, and motion durations/easings. Replace hard-coded values with tokens.
- Keep the file split if it helps organisation, but make the cascade intentional: tokens → base → layout → components → pages → motion. Remove dead selectors that no component uses (grep the JSX to confirm before deleting).
- Add a proper **dark mode** using the same tokens under `@media (prefers-color-scheme: dark)` — only if it can be done cleanly for every screen; otherwise skip and note it.

## 2. Fix the foundation first (mobile)

- `mobile-app/src/theme.js` is the single source of truth. Add the same type scale, spacing scale and radii as named exports and use them in `components/ui.js`, `adminkit.js` and the screens instead of magic numbers.
- `package.json` loads four font families (Inter, Montserrat, Playfair Display, Poppins). Use only Inter + Poppins like the web; remove unused font loading so startup is faster (keep the packages if removing them risks breaking the build — just stop loading them).
- Web and mobile should feel like the **same product**: same colours, same card style, same status chips, same icon set and sizes.

## 3. Visual problems already visible in the screenshots — fix these

**Student home (web)**
- Content ends around 800px and the rest of a tall screen is empty background. Make the layout fill the viewport sensibly and balance the two columns (the left column is much shorter than the right).
- Cards switch between dark slate glass and white glass with no clear reason. Define a rule: *one* dark hero card per screen (the next-bus / ETA card), everything else light. Apply it everywhere.
- The ETA ("arrives in 0–4 min") is the single most important piece of information and is currently a small line inside a pill. Make it the visual hero, as the mobile app already does ("ARRIVES AT YOUR STOP IN 0–4 min").
- "Tell me when to leave home" floats alone as a weak text button. Give it a proper place and treatment.
- Quick-action tiles (Attendance / Alerts / Report / Settings) have inconsistent icon colours (the red "Report" one is fine as a danger action; make the rest consistent).

**Admin dashboard (web)**
- Large empty gap below the "Fleet status" card; re-flow the grid so cards align in rows with equal heights.
- Mixed card styles (dark "Fleet now" card next to white stat tiles). Keep one dark hero, unify the rest.
- The "Riders, last 7 days" bar chart uses flat grey bars: use brand navy with the current day highlighted, add a light baseline/grid, and make zero-days visibly empty.
- Stat tiles: make the number the hero, label underneath in small caps, and add a subtle trend or context line only where the data already exists (do not invent data).
- "Needs attention" list repeats "Tracker offline" rows — group or visually compact repeated items, keep all of them accessible (e.g. "5 trackers offline" expandable).
- The top utility bar text is too small (12px) — raise to 13px and improve contrast.

**Mobile app**
- The web preview shows "Map (shown on the phone)" — keep that fallback but style it as a proper placeholder (soft map pattern + icon), not a grey box.
- Section headers (QUICK ACTIONS, BOARDING, BUS CONTACT, NOTIFICATIONS) are good — apply the same pattern on web.
- Check the floating glass tab bar does not cover content on small phones (add bottom padding equal to tab bar height + safe-area inset on every scroll view).

## 4. Screen-by-screen polish (apply to both web and mobile)

Go through **every** screen and make each one consistent with the system:

- **Public home & Login** — strong first impression: clear headline, route search/list easy to scan, sign-in form centred with proper labels, visible password toggle, clear error states, register link obvious.
- **Student:** Home, Live map, Schedule, Attendance, Alerts, Subscription, Settings, plus the Attendance prompt, Boarding check popup, Checkout and Change password modals.
- **Driver:** My trip — big touch targets (min 48px), start/stop trip, crowd level, boarding QR, boarded list and **SOS** must be instantly findable and impossible to tap by accident (SOS keeps its confirmation).
- **Admin:** Dashboard, Fleet map, Trips (+ replay, history, schedule), Attendance (buses → students → history → review → tools), Routes (click-to-place / drag / reorder stops must still work), Fleet, Alerts/Notices, Reports (stop demand, occupancy, exceptions, leakage, ETA accuracy), Trackers.
- **Finance:** only the `FinanceOff` panel — make it a clean, friendly empty state.

For every screen check:
- Clear visual hierarchy: one primary action, the most important number/info largest.
- Consistent page header (title, optional subtitle, actions on the right).
- **Loading** (skeletons, not blank space), **empty** (icon + one helpful line + action if there is one) and **error** states (message + retry) for every list, table, chart and map.
- Tables: sticky header, zebra or hover rows, right-aligned numbers with `tabular-nums`, horizontal scroll on small screens instead of overflow, and a card/list layout under 640px where tables are unreadable.
- Forms: labels above inputs, consistent `--control-h` height, inline validation messages, disabled and loading states on submit buttons.
- Maps (Leaflet / react-native-maps): consistent bus markers with route number, clear Live/Delayed/Offline colour, legend, recenter button, and controls that don't collide with overlays.
- Modals/popups: focus trapped, Esc closes (web), backdrop, consistent width and padding.
- Toasts/feedback after every action (saved, started trip, payment success/failure) using one component.

## 5. Responsiveness

Test web at **360, 390, 768, 1024, 1280 and 1440px**. No horizontal page scroll anywhere. Top nav collapses cleanly on small widths (8 admin items must not overflow). Grids go 1 → 2 → 3/4 columns. Touch targets ≥ 44px on mobile widths.

Test mobile on a small Android (360×640) and a large phone, with large system font size enabled.

## 6. Accessibility

- Text contrast WCAG AA (4.5:1 body, 3:1 large). Gold text on white is not allowed — use crimson or navy there (already a rule in `theme.js`).
- Visible focus ring on every interactive element (keep the gold `:focus-visible` outline).
- Every icon-only button gets `aria-label` (web) / `accessibilityLabel` (mobile) — e.g. the lock, sign-out, bell and avatar buttons in the header.
- Status never shown by colour alone: pair with text or icon.
- Respect `prefers-reduced-motion` (web) and reduced motion settings (mobile).

## 7. Motion

Subtle and purposeful only: 150–250ms, `--ease`, for hover, press, page/route transitions, card entrance and live-value changes (ETA updating, bus moving). No bouncing, no infinite decorative animation, nothing that slows the driver screen.

## 8. Performance

Don't add work to render paths that update every second (live map, ETA, `useNow`). Avoid heavy `backdrop-filter` blur on large scrolling areas on low-end phones; keep the liquid-glass look on headers, tab bars and hero cards only. Keep the Vite bundle size the same or smaller.

## 9. How to work and report

1. First, reply with an **audit**: list of problems found per screen and in the CSS, and your proposed token set. Wait for my OK.
2. Then implement in this order: tokens & CSS cleanup → shared components (`ui.jsx`, `adminkit.jsx`, `ui.js`, `adminkit.js`, `Icon`, `BrandMark`) → student screens → driver → admin → public/login → mobile parity.
3. After each step: run the app (`npm run build && npm start`, plus `npm run simulate:riders` so buses move), check the affected screens for every role (`stu001`, `drv118`, `admin`, `finance`, password `Demo@2026`), and confirm the feature still works.
4. At the end: run `npm test` and `npm run build`, retake the screenshots in `screenshots/web` and `screenshots/mobile` for the same screens, and give me a short before/after summary plus a list of every file changed.

If a visual change would require changing logic, **stop and ask me** instead of doing it.
