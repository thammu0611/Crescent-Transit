# DigiiCampus integration request: Crescent Transit (bus app)

**To:** Digii (DigiiCampus) technical team, via BSACIST university IT
**From:** Transport office, B.S. Abdur Rahman Crescent Institute of Science & Technology
**Subject:** Single sign-on and bus-fee status API for the Crescent Transit bus app

## Background

Crescent Transit is the university's bus tracking app (web app and Android app)
for students, drivers and the transport office. Students pay their bus fee on
DigiiCampus (`https://crescent.digiicampus.com/`, BillDesk checkout). We want the
bus app to use the student's DigiiCampus identity, so that:

1. a student signs in to the bus app with their DigiiCampus account (no second password);
2. the bus app can show whether the student's **bus fee** is paid;
3. "Pay bus fee" opens the student's own DigiiCampus fee page, already signed in.

The bus app will never ask for, see or store a student's DigiiCampus password.

## What we are asking for

### 1. Single sign-on (preferred: OpenID Connect / OAuth 2.0 authorization code flow with PKCE)

Please register Crescent Transit as a client application and send us:

| Item | Notes |
| --- | --- |
| Issuer / discovery URL | e.g. `https://…/.well-known/openid-configuration` |
| Client ID | one client is fine for web and Android |
| Client secret | for the web server only (the Android app uses PKCE, no secret) |
| Scopes | at least `openid email profile`, plus the student's register number if available |
| Claims in the ID token | email (university email), name, register number / student ID, programme, year |

Redirect URIs to allow:

- `https://crescent-transit-server.vercel.app/api/auth/digii/callback` (web, hosted backend)
- `http://localhost:4000/api/auth/digii/callback` (development)
- `crescenttransit://auth/digii` (Android app)

If OpenID Connect is not available, SAML 2.0 (IdP metadata URL plus the same
attributes) works for us too.

### 2. Bus-fee status API (read-only)

A server-to-server endpoint, authenticated with an API key or OAuth client
credentials, that returns a student's transport fee status for the current
academic year, for example:

```
GET /api/v1/students/{registerNo}/fees?category=transport
→ { "registerNo": "2026ECE101", "academicYear": "2026-27",
    "status": "PAID" | "DUE" | "PARTIAL" | "OVERDUE",
    "amountDue": 0, "dueDate": "2026-07-31", "lastPaidOn": "2026-06-12" }
```

Either a lookup by register number or by university email is fine. A webhook
when a transport fee is paid would let us update the app instantly, but polling
is acceptable.

### 3. A deep link to the fee page

The URL of the student's fee / payment page in DigiiCampus (for example
`https://crescent.digiicampus.com/…/fees`), so "Pay bus fee" can open it
directly. With single sign-on in place the student lands there already signed in.

## Data and security

- Data used: name, university email, register number and transport fee status only.
- Purpose: sign-in to the bus app and showing the student's own fee status.
- The bus app stores the student's email and register number (already held today)
  and the latest fee status; it stores no DigiiCampus passwords or payment details.
- All traffic is HTTPS. API keys and client secrets are kept in the hosting
  provider's encrypted environment settings, never in the app or source code.

## What happens until this is available

- Students verify their **university email** in the bus app with a one-time
  code sent to that inbox, so their bus account matches their DigiiCampus email.
- "Pay bus fee" opens DigiiCampus, where the student signs in and pays as usual.

## Contact

Transport office: +91 44 2275 1347
