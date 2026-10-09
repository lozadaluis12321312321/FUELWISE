<p align="center">
  <img src="fuel-tracker/logo.svg" alt="FuelWise" width="96" height="96" />
</p>

<h1 align="center">FuelWise</h1>

<p align="center">
  <b>Low on gas. Two stations. One right answer.</b><br />
  An offline-first AI fuel tracker that decides whether the near-but-pricey pump or the far-but-cheaper one actually costs you less.
</p>

<p align="center">
  <img alt="Offline first" src="https://img.shields.io/badge/offline-first-111111?style=flat-square" />
  <img alt="No accounts" src="https://img.shields.io/badge/accounts-none-111111?style=flat-square" />
  <img alt="Monochrome UI" src="https://img.shields.io/badge/ui-monochrome-111111?style=flat-square" />
  <img alt="Vanilla JS" src="https://img.shields.io/badge/stack-vanilla%20JS-111111?style=flat-square" />
</p>

---

## The problem

Every driver knows the moment: the fuel light comes on, and there are two choices.

| | Option A — around the corner | Option B — across town |
|---|---|---|
| Distance | 1.5 km | 14 km |
| Price | ₱68.50 / L | ₱62.90 / L |
| The catch | You pay for the location | The detour burns fuel and time |

Your gut guesses. **FuelWise calculates.**

## How it decides

For every saved station, FuelWise computes the *true* cost of filling up there:

```
true_cost = (price × litres) + (detour_km ÷ efficiency × price) + (detour_min × your_hourly_value)
```

It then picks the lowest, explains why in plain language, and warns you when the cheaper station is outside your remaining range. The whole model is a few kilobytes of deterministic logic, so it runs with airplane mode on — no API calls, no latency, no "try again later."

## What's in this repo

```
FUELWISE/
├── fuel-tracker/    The app — PWA + Capacitor (Android / iOS)
└── fuelwise-site/   Landing page introducing the concept
```

### `fuel-tracker/` — the app

A vanilla HTML/CSS/JS progressive web app, wrapped with Capacitor for native builds.

- Log fill-ups and odometer readings; the app learns your real consumption
- Save stations with price and distance; get a ranked recommendation when fuel is low
- All data stays on-device (localStorage on web, Preferences on native) with JSON export/import
- Light / dark monochrome theme, follows the system by default

```bash
cd fuel-tracker
npm ci              # Node 22+
npm run dev         # http://127.0.0.1:5501
npm run build       # bundles to dist/
npm test            # Playwright (Chromium + WebKit)
npm run android     # build, sync, open Android Studio
npm run ios         # build, sync, open Xcode (macOS)
```

See [`fuel-tracker/AGENTS.md`](fuel-tracker/AGENTS.md) for the full build and native-tooling notes.

### `fuelwise-site/` — the landing page

A static, dependency-free one-pager that pitches the idea. It includes a live interactive demo of the decision engine on a stylized Metro Manila map: pick brands (Petron, Shell, Caltex, …), drag the distance / price / range sliders, and watch the verdict, route, and cost breakdown update in real time.

Open `fuelwise-site/index.html` directly, or serve the folder with any static server.

## Design principles

- **Offline is the default, not a fallback.** Nothing requires a connection.
- **Your data is yours.** No accounts, no telemetry, no cloud sync. Export a backup file whenever you want.
- **Monochrome by design.** Glanceable at speed, readable in direct sun, kind to your battery.
- **Honest numbers.** Recommendations are deterministic estimates based on your inputs — not a black box.

## Status

Concept / early build. Stations, prices, and distances are entered manually; there is no live price feed or GPS routing yet.
