# Real Time Hand Interface

Control a 3D financial dashboard with your hand — point, hover, and pinch in front of your laptop webcam. No mouse. No keyboard. No special hardware.

Submission for **Youth Code x AI 2026**.

- **Live demo:** https://real-time-hand-interface.vercel.app
- **Source:** https://github.com/rkceve/Real-time-hand-interface

---

## What you need

- A laptop or desktop with a webcam
- Chrome or Edge (recent version)
- Decent lighting on your hand
- A GPU helps but is not required — a fallback Performance Mode kicks in automatically on integrated graphics

---

## How to use it

1. Open the demo URL in your browser.
2. Click **ENTER CONSOLE** — the browser will ask for camera permission. Allow it.
3. Lift one hand into the webcam view, about 30–60 cm from the camera.
4. Try the gestures below.

### Gestures

| Gesture | What happens |
|---|---|
| **Point** (index finger extended, others curled) | A cursor appears and follows your fingertip |
| **Hover and hold** the cursor on a panel for ~1 second | That panel opens in full-screen detail view |
| **Pinch** (thumb + index finger together) and drag | The whole 3D sphere rotates |
| **Open hand** (all 5 fingers spread) and hold for ~1 second | The detail view closes |

The cursor is sticky around each panel — once it's close, it snaps to the panel so you don't have to be pixel-perfect.

### Keyboard shortcuts (also work without webcam)

| Key | Action |
|---|---|
| `S` | Open Settings panel (bloom, theme, cursor sensitivity, panel toggles) |
| `Esc` | Close the open detail view |
| `Tab` / `Shift+Tab` | Cycle keyboard focus across panels |
| `Enter` / `Space` | Open the focused panel (mouse-clickable too) |
| `R` | Start / stop telemetry recording (developer tool, dumps NDJSON) |

### If the demo feels laggy

After ~3.5 seconds of sustained low FPS, a yellow banner offers **Enable Performance Mode** — one click drops the renderer pixel ratio and disables bloom, usually recovering 2× the frame rate. You can also toggle it manually under Settings (`S`).

---

## What you see on screen

- A wireframe sphere in the center with **8 sector panels** orbiting it (Information Technology, Financials, Health Care, Consumer Discretionary, Communication Services, Industrials, Energy, Consumer Staples) and **4 global panels** above (Top Gainers, Top Losers, Market Heatmap, Sector Pulse).
- **64 real US tickers** classified into their actual GICS sectors. The displayed numbers (price change %, P/E, dividend yield, RVOL, earnings date) are sector-typical synthetics — labeled `SIM` on the bottom status bar.
- The status bar shows NYSE market state, ET clock, render FPS, and data source.

---

## Run it locally

```bash
git clone https://github.com/rkceve/Real-time-hand-interface.git
cd Real-time-hand-interface
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome / Edge. Allow camera access.

### Build for production

```bash
npm run build       # output goes to dist/
npm run preview     # serve dist/ locally
```

### Refresh the synthetic stock data

```bash
python scripts/enrich-stocks.py
```

Regenerates `src/data/stocks.json` with sector-typical synthetic values (deterministic per ticker). Berkshire / Alphabet / Amazon / Tesla and other known no-dividend tickers are hardcoded to 0% yield.

---

## Tech stack

- **Three.js r170** — 3D scene
- **@mediapipe/tasks-vision 0.10.35** — hand landmark detection (WebAssembly + XNNPack CPU)
- **Vite 6** — build / dev server
- **Vanilla JavaScript** — no framework
- **WebAudio** — UI sounds
- **Inter / JetBrains Mono** — Google Fonts

The MediaPipe WASM bundle (~22 MB, CPU SIMD + nosimd pair) ships under `public/wasm/` so the demo does not depend on a CDN at runtime.

---

## Project structure

```
src/
├── main.js                 entry point
├── settings.js             settings panel + localStorage
├── data/stocks.json        64 tickers x 8 GICS sectors
├── hand/                   webcam input + smoothing + gesture detection
│   ├── tracker.js
│   ├── smoothing.js
│   ├── finger.js
│   ├── pinch.js
│   ├── presence.js
│   ├── gestureState.js
│   └── telemetry.js
├── viz/                    3D scene + UI panels + overlays
│   ├── scene.js
│   ├── icosphere.js
│   ├── panels.js
│   ├── cursor.js
│   ├── controls.js
│   ├── fullscreen.js
│   ├── help.js
│   ├── onboarding.js
│   ├── skeleton.js
│   ├── statusbar.js
│   ├── perf-banner.js
│   ├── mouse-fallback.js
│   └── audio.js
└── util/
    └── fmt.js              number formatting helpers
```

---

## Known limits

- Numbers shown are synthetic, not live market data.
- The whole interface is view-only by design — no forms, no order entry.
- Single hand only (a second hand in frame is ignored).
- Webcam tracking quality depends on lighting and on your hand staying in the camera's field of view.

---

## License

MIT.
