# Market Console

**Operate the market with one hand.** A 3D market HUD where you point with your index finger, pinch to drill into a sector, and drag to spin the whole sphere — no mouse, no keyboard, just a single RGB webcam.

> Submission to **Youth Code x AI 2026 · Track 01 · Money, Jobs & AI**.

![Market Console — wireframe icosphere surrounded by 12 floating panels showing GICS sector data and global insights, rendered on pure black with Bloomberg-style vivid green/red text](.github/cover.png)

---

## Why

Professional traders use multiple monitors because a 2D screen with a mouse can't scan multidimensional market data. Market Console collapses that idea into one screen and one hand — point to highlight, pinch to drill in, drag in empty space to rotate.

The aim isn't to replace a Bloomberg terminal. The aim is to show that single-RGB-webcam hand input is precise enough for a real information surface, not just a tech demo.

---

## What it does

- **Central wireframe icosphere** — geometric reference / orientation anchor.
- **12 floating panels around the sphere**, in two horizontal rings:
  - **Lower ring (8)**: one summary panel per GICS sector — average % change, market cap, breadth (advancers vs decliners), top 3 holdings, sparkline.
  - **Upper ring (4)**: global insight panels — **TOP GAINERS**, **TOP LOSERS**, **MARKET HEATMAP** (8×8 colored grid of all 64 names), **SECTOR PULSE** (horizontal bar chart of sector averages).
- **Click a panel** to open a full-screen detail view with every constituent sorted by market cap, with bars and signed % change.
- **64 real US tickers** across all 11 → 8 selected GICS sectors. End-of-day prices pulled from Stooq (one-shot, baked into the JSON at build time).

---

## Gesture vocabulary

| Gesture | Detection | Action |
|---|---|---|
| **Point** — index extended, others curled | finger-extension cosine + hysteresis gate (≈330 ms enter / 800 ms exit) | Cursor appears and follows your index fingertip in 2D |
| **Pinch** over a panel — thumb tip to index tip distance below 0.30 of hand size | hysteresis pinch detector (0.30 close / 0.45 open) | Open that panel's detail view |
| **Pinch** in empty space + drag | same detector, routed by cursor hover state | Yaw-rotate the sphere (palm-x driven, ≈400° per full screen swing) |
| **Spread 5 fingers** and hold 1.2 s | all-extended hysteresis gate + local dwell timer | Close the detail view (Esc also works) |

The cursor itself is a small Iron-Man-style reticle with five visible states (lost / idle / hover / arming / fired / cooldown). It magnetically snaps to whichever panel is nearest; once it's on one, the snap radius widens to 1.7× so adjacent panels don't fight for it.

---

## Tech

| Layer | Library |
|---|---|
| 3D scene | **Three.js r170** — icosphere, plane panels, line connectors, Bloom postprocess |
| Hand detection | **@mediapipe/tasks-vision 0.10.35** (`HandLandmarker`, VIDEO mode, single hand, GPU delegate with CPU fallback) |
| Build | **Vite 6** (vanilla JS, no TS) |
| Audio | Native **WebAudio** — three short tones for tick / select / exit chime |

What is **NOT** an off-the-shelf library — all written from scratch in `src/`:

- **OneEuro filter** (`smoothing.js`) — port of the CHI 2012 paper, tuned to `minCutoff = 0.35`, `beta = 0.04`.
- **Cursor state machine** (`cursor.js`) — 5 states, sticky magnet, speed-adaptive pull, velocity extrapolation gated by a speed floor, 1.5 px deadzone, render-rate lerp, dwell-click fallback.
- **Hysteresis gates** (`finger.js`) — pointing / palm-open / pinch each have separate enter / exit frame counts, so transient mis-detections never flip a mode.
- **Pinch-drag routing** (`main.js`) — pinch over a panel fires a click, pinch in empty space starts a drag (yaw only).
- **15 → 60 fps interpolation** — between MediaPipe detections (≈15 fps on integrated GPUs) the cursor lerps and velocity-extrapolates so the rendered motion feels 60 fps.
- **Panel canvas rendering** (`panels.js`) — every panel is a `CanvasTexture`; live tick simulation perturbs each name's % change every 2 s and redraws.

---

## Measured

The HUD's `lat` line shows live detect-to-render latency (`median / p95` over the last 90 render frames):

- Tracker runs at the camera's native rate (15 fps on integrated GPUs, 30 fps on dedicated).
- Render loop runs at the screen refresh rate (typically 60 fps) and lerps + extrapolates between tracker writes.
- Typical detect-to-render lag on integrated GPU: **median ≈ 20–35 ms, p95 ≈ 55–75 ms**. Add one camera frame (~33–66 ms) for full input-to-photon.

If your numbers are dramatically worse, open the Settings panel (S key) and lower Cursor Sensitivity, or disable Bloom — both shift load.

---

## Run it

```bash
npm install
npm run dev        # localhost:5173 — camera permission required
npm run build      # static dist/ for deploy
npm run preview    # serve dist/
```

The MediaPipe WASM bundle is copied to `public/wasm/` from `node_modules/` so the app does not depend on a CDN version match.  The hand-landmarker model file (~5 MB) is fetched once from Google's public model storage and cached by the browser.

### Pull real EOD prices

```bash
node scripts/fetch-real-data.js
```

Hits Stooq's free CSV endpoint for each of the 64 tickers and overwrites `src/data/stocks.json` with real prices + change percentages, plus a fresh `asOf` date. Takes about 8 seconds.

### Deploy

```bash
npx vercel --prod          # one-line static deploy
```

---

## Settings (S key)

| Section | Options |
|---|---|
| Display | Skeleton mirror · HUD · Help cheat-sheet · Sound effects |
| Visual  | Bloom intensity slider · Accent theme (Cyan / Amber / Mono) |
| Interaction | Cursor sensitivity slider |
| Panels | Show / hide each of the 4 global panels |

All persist in `localStorage`. Reset-to-defaults button at the bottom.

---

## What's not in the box

- No live websocket / streaming quotes — one-shot EOD pull only. Live tick simulation is small random perturbation on top of real EOD values; the data-source caption at the bottom of the screen says so.
- No two-hand interaction. `numHands: 2` is enabled for greedy single-hand selection (so a second hand in frame doesn't make the cursor jump), but only one hand drives the UI.
- No precision-input gestures — gesture systems are bad at precise pointing, so the whole UI is viewing-only by design (no forms, no text fields, no order entry).

---

## File structure

```
src/
├── main.js                  # boot, settings wiring, frame loop
├── settings.js              # settings panel + localStorage
├── data/stocks.json         # 64 tickers × 8 GICS sectors (overwritable by scripts/fetch-real-data.js)
├── hand/
│   ├── tracker.js           # MediaPipe wrapper, greedy 2-hand selection, OneEuro on cursor + palm
│   ├── smoothing.js         # OneEuro filter (CHI 2012, ported)
│   ├── finger.js            # finger-extension detection, pose helpers, hysteresis gate
│   ├── pinch.js             # pinch state machine (0.30 / 0.45 hysteresis)
│   ├── presence.js          # 3-IN / 20-OUT hand-presence hysteresis
│   └── gestureState.js      # shared mutable state read by the renderer
└── viz/
    ├── scene.js             # Three.js scene, camera, lights, Bloom postprocess
    ├── icosphere.js         # central wireframe sphere + inner sphere + 3-axis rings
    ├── panels.js            # 12 floating panels, 4 canvas types, hover focus, refresh()
    ├── cursor.js            # 5-state machine + magnet + dwell + velocity extrapolation
    ├── controls.js          # pinch-drag-rotate, yaw-only
    ├── fullscreen.js        # detail panel modal, palm-dwell + Esc to close
    ├── help.js              # gesture cheat-sheet (top-right)
    ├── onboarding.js        # first-time tutorial overlay
    ├── skeleton.js          # 21-landmark overlay on webcam preview
    └── audio.js             # WebAudio tick / select / exit chime
```

---

## License

MIT.
