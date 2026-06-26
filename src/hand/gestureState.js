// Shared mutable state populated by the tracker and read by the renderer.

export function createGestureState() {
  return {
    // -- Presence --
    handPresent: false,

    // -- Mode gates (hysteresis-stable booleans) --
    modeIsPointing: false,
    modeIsAllExtended: false,
    allExtendedHeldMs: 0,

    // -- Cursor (driven by index tip when modeIsPointing) --
    cursorActive: false,
    cursorX: 0.5,
    cursorY: 0.5,
    cursorAtEdge: false,
    handConfidence: 0,

    // -- Pinch (universal commit gesture) --
    pinchState: 'open',
    pinchStartEdge: false,
    pinchEndEdge: false,
    pinchHeldMs: 0,
    pinchRatio: 1.0,

    // -- Palm position (for pinch-drag rotation) --
    palmX: 0.5,
    palmY: 0.5,

    // -- Cursor freshness instrumentation (filled by cursor.js render loop) --
    // Measures how stale the rendered cursor anchor is relative to the most
    // recent tracker write — render frame time minus tracker last-write
    // time.  Does NOT include camera capture time or MediaPipe inference
    // time; full input-to-photon = freshness + ~1 camera frame + inference.
    // Renamed from "latency*" so HUD readers don't misinterpret the value.
    cursorFreshnessMedianMs: 0,
    cursorFreshnessP95Ms: 0,

    // -- Data source metadata (read from stocks.json at boot) --
    dataSource: '',
    dataAsOf: '',

    // -- Diagnostics --
    cameraFps: 0,
    lastUpdateMs: 0,
  };
}
