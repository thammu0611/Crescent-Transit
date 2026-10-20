# Crescent Transit — test app (Android)

## For the person running the server (your PC)

1. Double-click **`START-PUBLIC-TEST.bat`** in the project folder.
   - It starts the backend, asks whether to start the bus simulator (say **Y** so testers see buses moving),
     and opens a Cloudflare tunnel.
   - It prints a public address like `https://word-word-word-word.trycloudflare.com` and copies it to the clipboard.
2. Send that address and `CrescentTransit-test.apk` to the testers (WhatsApp, Drive, email).
3. Keep the **server** and **tunnel** windows open while people test. The PC must stay on and awake.
4. The address **changes every time** you start the script, so send the new one each time.

## For testers (any Android phone, Android 7 or newer)

1. **Install:** open `CrescentTransit-test.apk` on the phone. If Android asks, allow
   *Install unknown apps* for the app you opened it from (Files, Chrome or WhatsApp). If Play Protect warns
   about an unknown developer, tap *More details → Install anyway*. This test build isn't published on the Play Store.
2. **Connect:** open the app → **Sign in** → scroll down to **Server** → paste the address you were given →
   **Save and test**. It should say *Connected*.
3. **Sign in** with a demo account (password **`Demo@2026`**):

   | Try it as | Username | What to look at |
   |---|---|---|
   | Student | `stu001` … `stu024` | Home with arrival estimate, live map, schedule, attendance, subscription |
   | Driver | `drv118`, `drv119`, `drv117`, `drv127` | Start a trip, share GPS, boarding QR, crowd level, SOS |
   | Transport admin | `admin` | Dashboard, fleet map, trips, routes, reports |
   | Finance | `finance` | Collections, payments, refunds, reconciliation |

   Or tap **New student** to register your own account. Payments use a built-in **test gateway**, so no real money is charged.

4. **Allow location** when asked (driver GPS and student attendance). The camera is used only to scan the boarding QR code.

### Notes
- **No iPhone app:** iPhones can't install an APK. iPhone users can open the same address in Safari to use the web version.
- **Blank maps:** the map background (streets) stays blank until a Google Maps key is added to the build.
  Everything else works: arrival estimates, schedules, attendance, payments and admin screens.
- **Please change only your own account's password:** every tester shares the demo accounts. Changing one signs out everyone else using it.
- **Something wrong?** Note the screen, what you tapped and the time, and send a screenshot.
