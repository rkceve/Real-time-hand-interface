# Market Console

**Operate the market with one hand.** A 3D market HUD where you point with your index finger, pinch to drill into a sector, and drag to spin the whole sphere — no mouse, no keyboard, just a single RGB webcam.

> Submission to **Youth Code x AI 2026 · Track 01 · Money, Jobs & AI**.

![Market Console — wireframe icosphere surrounded by 12 floating panels showing GICS sector data and global insights, rendered on pure black with Bloomberg-style vivid green/red text](.github/cover.png)

---

## Why

Market Console is one application surface on top of a **general gesture-interaction layer** — a single RGB webcam → MediaPipe hand-pose → custom OneEuro + magnet + dwell cursor system. Finance was picked for the showcase because it has the loudest "I need to scan many things at once" workflow, but the same engine applies anywhere the mouse is wrong for the task.

**Why finance for the demo.** Professional traders use multiple monitors because a 2D screen + mouse can't scan multidimensional market data. Market Console collapses that into one screen + one hand: point to highlight a sector, pinch to drill in, drag in empty space to rotate the whole view.

**Where else this works.** The strongest second domain isn't "another dashboard" — it's **sterile-field medical imaging** (interventional radiology, surgical navigation). When a scrubbed-in surgeon needs to manipulate an image, the mouse genuinely fails; touchless gesture is the documented mitigation (peer-reviewed work uses the exact same MediaPipe + RGB webcam stack). The gesture layer here would port directly. Other plausible targets where touchless beats touch: cleanroom inspection, exhibit / museum kiosks, cooking-mode recipe screens. Finance is the loud one; the layer is general.

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
| Hand detection | **@mediapipe/tasks-vision 0.10.35** (`HandLandmarker`, VIDEO mode, `numHands: 2` with a greedy single-driver picker, CPU (XNNPack SIMD) delegate first with GPU fallback) |
| Build | **Vite 6** (vanilla JS, no TS) |
| Audio | Native **WebAudio** — three short tones for tick / select / exit chime |

What is **NOT** an off-the-shelf library — all written from scratch in `src/`:

- **OneEuro filter** (`smoothing.js`) — port of the CHI 2012 paper, retuned for 8–15 fps input to `minCutoff = 1.5`, `beta = 0.07`.
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

If your numbers are dramatically worse, an auto-suggestion banner ("Low FPS — enable Performance Mode") will pop above the status bar after ~3.5 s of sustained <28 fps. One click drops renderer DPR to 1.0 and disables bloom; on Intel UHD this typically recovers 2× the frame rate. The Settings panel (S key) exposes the same toggle plus a Cursor Sensitivity slider.

---

## Architecture

```
                  ┌──────────────────────────────────────────────────────────┐
                  │                       BROWSER (60 Hz)                    │
                  │                                                          │
  webcam ─MJPEG─▶ │  <video>  ──┐                                            │
   (640×480)      │             │  per detection frame (15–30 Hz)            │
                  │             ▼                                            │
                  │  ┌────────────────────────┐                              │
                  │  │ MediaPipe HandLandmarker│   21 landmarks × XYZ        │
                  │  │  (WASM + XNNPack CPU)  │                              │
                  │  └────────┬───────────────┘                              │
                  │           │                                              │
                  │           ▼                                              │
                  │  ┌────────────────────────┐                              │
                  │  │  hand/tracker.js       │  greedy 2-hand picker,       │
                  │  │  + finger.js + pinch.js│  3-D cosine extension,       │
                  │  │  + presence.js         │  hysteresis gates            │
                  │  └────────┬───────────────┘                              │
                  │           │                                              │
                  │           ▼                                              │
                  │  ┌────────────────────────┐                              │
                  │  │  hand/smoothing.js     │  OneEuro on cursor + palm    │
                  │  │  (CHI 2012, ported)    │                              │
                  │  └────────┬───────────────┘                              │
                  │           │  writes target_*                             │
                  │           ▼                                              │
                  │  ┌────────────────────────┐                              │
                  │  │  hand/gestureState.js  │   shared mutable struct      │
                  │  └────────┬───────────────┘                              │
                  │           │  read every frame ─────┐                     │
                  │           ▼                        ▼                     │
                  │  ┌──────────────┐         ┌────────────────┐             │
                  │  │ viz/cursor.js│         │viz/controls.js │             │
                  │  │ 5-state +    │         │ pinch-drag     │             │
                  │  │ magnet+dwell │         │ rotate (yaw)   │             │
                  │  └──────┬───────┘         └────────┬───────┘             │
                  │         │ click intent             │ rotation delta      │
                  │         ▼                          ▼                     │
                  │  ┌──────────────┐         ┌────────────────┐             │
                  │  │viz/panels.js │         │  viz/scene.js  │             │
                  │  │ 12 panels    │ ◀───────│ Three.js camera│             │
                  │  │ (canvas tex) │  pivot  │ + Bloom + DPR  │             │
                  │  └──────┬───────┘         └────────┬───────┘             │
                  │         │ open                     │                     │
                  │         ▼                          ▼                     │
                  │  ┌──────────────┐         ┌────────────────┐             │
                  │  │viz/fullscreen│         │ <canvas#scene> │ ──▶ pixels  │
                  │  │ DOM detail   │         │                │             │
                  │  └──────────────┘         └────────────────┘             │
                  │                                                          │
                  │  side-channels: viz/statusbar.js · viz/perf-banner.js    │
                  │                 viz/help.js · settings.js (localStorage) │
                  │                 hand/telemetry.js (R-key NDJSON dump)    │
                  └──────────────────────────────────────────────────────────┘
```

Detection runs at the camera's native rate; the render loop runs at the screen refresh rate and uses lerp + velocity-extrapolation to bridge the two (so the cursor visibly moves between MediaPipe frames). `hand/` and `viz/` only intersect at `gestureState` — swap MediaPipe for another tracker by replacing one file.

---

## Engineering deep-dive

A few decisions that took more iteration than the file structure suggests.

**3-D cosine extension over 2-D length.** The first cut classified a finger as extended by 2-D segment length (MCP→TIP); on this data set it false-positived on relaxed-curl pointing 62–83 % of the time, depending on which finger. Switching to the 3-D dot product between the MCP→PIP and PIP→TIP segments and thresholding at `cos > 0.5` collapses the per-finger error to single digits, because the cosine is invariant to wrist roll and per-hand size — both of which the length metric tangles together. Captured via `R`-key telemetry, fixed in `hand/finger.js`.

**OneEuro re-tuning for 8–15 fps.** The reference OneEuro hyper-parameters from the CHI 2012 paper assume 60 fps input. At 15 fps, the same `minCutoff = 0.35, beta = 0.04` produces a perceptible lag (~450 ms time constant exceeds the 67 ms inter-frame gap). Retuning to `minCutoff = 1.5, beta = 0.07` keeps the noise floor low while letting fast movement through one detection at a time. The "Cursor Sensitivity" slider in the settings panel does **not** touch OneEuro — it scales the centred cursor output by `0.8×`–`2.0×` (default 0.85, measured sweet spot). The smoothing constants stay fixed.

**Pinch routing — click vs. drag.** A pinch in empty space rotates the sphere; a pinch over a panel opens that panel. The naive implementation checks the hover state at every frame, which lets a hand that drifts onto a panel mid-drag accidentally fire a click on release. The fix is to latch the routing decision at the pinch-START edge (`gestureState.pinchStartEdge`) and ignore hover changes for the duration of that pinch. See `main.js` line 220-ish.

**Cap-weighted aggregates.** Sector summaries (AVG CHANGE, AVG P/E, AVG DIV Y) are computed as `Σ(value × marketCap) / Σ(marketCap)`, not arithmetic mean. With a naive mean, a small-cap +5 % move pulls the sector display while AAPL is flat — mathematically wrong for the information the user wants. Real terminals weight by cap; matching that is a free credibility win (`util/fmt.js`).

**Auto Performance Mode banner.** Reviewers will run this on whatever laptop they own, which often means an Intel UHD GPU pushing 18 fps with bloom on. Hiding the perf knob in a settings panel is a recipe for "the demo is laggy" feedback. The banner watches a 10-frame EMA of render fps and surfaces a one-click toggle after 3.5 s of sustained slowness — once dismissed it does not nag again that session (`viz/perf-banner.js`).

**Render-rate lerp.** The cursor's screen position is interpolated each render frame toward the tracker's most recent target with `cur += (target − cur) × 0.35` (`RENDER_LERP` in `cursor.js`). When the post-lerp pixel delta falls under a `DEADZONE_PX = 1.5` threshold, the rendered position snaps back to the previous frame so the cursor stops crisply rather than asymptotically drifting. A separate `EXTRAP_SPEED_FLOOR = 0.18` (normalised hand-velocity units) gates the velocity-extrapolation path — same file, distinct mechanism, easy to confuse with the lerp number. Sphere rotation uses the same lerp shape with short-arc angle wrapping.

**Telemetry self-instrumentation.** Press `R` to record every detection frame as NDJSON: landmark positions, derived finger states, OneEuro inputs/outputs, hysteresis gate decisions, pinch state. The live indicator above the scene shows duration, frame count and the per-finger extension pattern as five dots — useful for diagnosing classifier drift without having to download the file mid-session.

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
│   ├── gestureState.js      # shared mutable state read by the renderer
│   └── telemetry.js         # R-key NDJSON dump of every tracker frame
├── viz/
│   ├── scene.js             # Three.js scene, camera, lights, Bloom postprocess
│   ├── icosphere.js         # central wireframe sphere + inner sphere + 3-axis rings
│   ├── panels.js            # 12 floating panels, 4 canvas types, hover focus, refresh()
│   ├── cursor.js            # 5-state machine + magnet + dwell + velocity extrapolation
│   ├── controls.js          # pinch-drag-rotate, yaw-only
│   ├── fullscreen.js        # detail panel modal, palm-dwell + Esc to close
│   ├── help.js              # gesture cheat-sheet (top-right)
│   ├── onboarding.js        # first-time tutorial overlay
│   ├── skeleton.js          # 21-landmark overlay on webcam preview
│   ├── statusbar.js         # bottom bar: NYSE state · ET clock · FPS · GICS count · data source
│   ├── perf-banner.js       # auto Performance Mode suggestion on sustained low FPS
│   └── audio.js             # WebAudio tick / select / exit chime
└── util/
    └── fmt.js               # pro-terminal number formatting (true minus, cap-weighted avg, RVOL bins)
```

---

## License

MIT.
