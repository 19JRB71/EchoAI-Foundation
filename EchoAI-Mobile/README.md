# EchoAI Mobile

Native iOS & Android companion app for [EchoAI](../EchoAI), built with **Expo**
(React Native) + **React Navigation**. It talks to the EchoAI **mobile API**
under `/api/v2` (see [`../EchoAI/MOBILE_API.md`](../EchoAI/MOBILE_API.md)).

> This is a **scaffold**: a working, runnable foundation (auth, navigation, the
> Home dashboard, the Leads list, push-event overview, settings) that a React
> Native developer fleshes out into the full app. It is intentionally **not** a
> Replit artifact — it does not run in the Replit preview pane.

## What's included

- **Auth** — email/password login & registration, 30-day access tokens with
  transparent refresh-token rotation, and **biometric** (Face ID / fingerprint)
  unlock via `expo-local-authentication`.
- **Navigation** — auth stack + bottom tabs (Home, Leads, Alerts, Settings),
  themed to match EchoAI (amber on gray-900).
- **Home** — the three key metrics (total spend, total leads, cost per lead)
  from `GET /api/v2/dashboard/:brandId`.
- **Leads** — cursor-paginated, temperature-filtered CRM list from
  `GET /api/v2/leads` with infinite scroll.
- **Alerts** — overview of the three push events EchoAI sends.
- **Settings** — account info, biometric toggle, roadmap, sign out.
- **API client** (`src/api/client.js`) — envelope parsing, bearer auth, auto
  refresh-on-401, and typed endpoint helpers.

## Configure the backend URL

The app needs to know where the EchoAI server lives. Set it via either:

- Environment variable: `EXPO_PUBLIC_API_URL=https://your-echoai-domain` , or
- `app.json` → `expo.extra.apiUrl`.

The mobile API is then reached at `${API_URL}/api/v2`.

## Run it

```bash
cd EchoAI-Mobile
npm install
npm start          # Expo dev server (press i / a, or scan the QR in Expo Go)
```

## Build for the stores

This scaffold uses Expo's managed workflow, so you can build with **EAS**:

```bash
npm install -g eas-cli
eas build --platform ios
eas build --platform android
```

To add push notifications end-to-end, register the device's FCM token with
`POST /api/v2/push/register` after login (the `pushApi.register` helper is
already wired in `src/api/client.js`) and configure FCM credentials in EAS.

## Project layout

```
EchoAI-Mobile/
├── App.js                  # Providers + NavigationContainer
├── index.js                # Expo entry (registerRootComponent)
├── app.json                # Expo config (bundle ids, biometric usage strings)
├── src/
│   ├── config.js           # API base URL + AsyncStorage keys
│   ├── theme.js            # Brand colors / spacing / radius
│   ├── api/client.js       # Fetch wrapper + endpoint helpers
│   ├── context/AuthContext.js
│   ├── components/ui.js    # Button / Field / Card / Banner
│   ├── navigation/         # Root / Auth / MainTabs
│   └── screens/
│       ├── auth/           # Login / BiometricLogin / Register
│       ├── HomeScreen.js
│       ├── LeadsScreen.js
│       ├── NotificationsScreen.js
│       ├── SettingsScreen.js
│       └── PlaceholderScreen.js
```
