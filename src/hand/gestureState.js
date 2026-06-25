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

    // -- Latency instrumentation (filled by cursor.js render loop) --
    // Measures "detect-to-render" lag = render frame time minus tracker
    // last-write time.  Captures the freshness of the cursor relative to
    // MediaPipe's last detection write.  Not the full input-to-photon path
    // (which would need camera capture timestamps), but the dominant
    // user-perceived lag on a 15 fps source.
    latencyMedianMs: 0,
    latencyP95Ms: 0,

    // -- Data source metadata (read from stocks.json at boot) --
    dataSource: '',
    dataAsOf: '',

    // -- Diagnostics --
    cameraFps: 0,
    lastUpdateMs: 0,
  };
}
