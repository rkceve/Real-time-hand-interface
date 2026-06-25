// Finger-state detection, pose helpers, hysteresis gate.
//
// Tuned permissively (2026-06 user feedback: "cursor judgment is too strict
// and disappears too quickly").  Two changes from the strict version:
//   - lower cosine threshold (more tolerant "straight" finger detection)
//   - isPointing accepts up to one other finger slightly extended
//     (real-world pointing rarely has all three other fingers fully curled)

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// Cosine-based "is the finger straight" check.  Uses the angle between
// (PIP-MCP) and (TIP-PIP) in 3D; larger cosine = straighter finger.
//
// History: previous version had cosThreshold = 0.1 (84°) plus a length-
// ratio fallback (`dTip > dMcp * 1.35`).  Telemetry (gesture-telemetry
// 2026-06-25T18-09-08.ndjson, 218 frames) showed this was wildly over-
// permissive: while the user was pointing with just their index finger,
// middle / ring / pinky were flagged "extended" 62% / 70% / 83% of the
// time, causing isPointing to fire only 19% of frames.  The length
// fallback in particular was the killer — even curled fingertips can
// land > 1.35× further from the wrist than their MCP because of fist
// geometry.
//
// New approach: 3D cosine at threshold 0.5 (60°), no fallback.  3D
// catches foreshortening when a finger points at the camera (z catches
// what x/y collapses on).  0.5 means the finger must be visibly
// straight, not just "not folded back."
function fingerExtended(lm, mcpIdx, pipIdx, tipIdx, cosThreshold = 0.5) {
  const mcp = lm[mcpIdx], pip = lm[pipIdx], tip = lm[tipIdx];
  const v1x = pip.x - mcp.x, v1y = pip.y - mcp.y, v1z = pip.z - mcp.z;
  const v2x = tip.x - pip.x, v2y = tip.y - pip.y, v2z = tip.z - pip.z;
  const m1 = Math.hypot(v1x, v1y, v1z);
  const m2 = Math.hypot(v2x, v2y, v2z);
  if (m1 < 1e-5 || m2 < 1e-5) return false;
  const cos = (v1x * v2x + v1y * v2y + v1z * v2z) / (m1 * m2);
  return cos > cosThreshold;
}

// Thumb threshold a bit looser — the thumb naturally bends sideways
// and never gets as straight as the other fingers.
function thumbExtended(lm) {
  return fingerExtended(lm, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP, 0.3);
}

export function detectFingerStates(lm) {
  return {
    index: fingerExtended(lm, LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_TIP),
    middle: fingerExtended(lm, LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_TIP),
    ring: fingerExtended(lm, LM.RING_MCP, LM.RING_PIP, LM.RING_TIP),
    pinky: fingerExtended(lm, LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_TIP),
    thumb: thumbExtended(lm),
  };
}

// Pointing: index extended AND at most one other (M/R/P) extended.
// (Strict "only-index" failed because natural pointing often leaves the
// middle finger partially straight; the gate then flickered off and
// the cursor disappeared.)
export function isPointing(s) {
  if (!s.index) return false;
  let others = 0;
  if (s.middle) others += 1;
  if (s.ring) others += 1;
  if (s.pinky) others += 1;
  return others <= 1;
}

// All five fingers extended (palm out): exit-fullscreen dwell pose.
export function isAllExtended(s) {
  return s.index && s.middle && s.ring && s.pinky && s.thumb;
}

// Generic hysteresis gate.
export class HysteresisGate {
  constructor({ enterFrames = 4, exitFrames = 8 } = {}) {
    this.enterFrames = enterFrames;
    this.exitFrames = exitFrames;
    this._active = false;
    this._enterStreak = 0;
    this._exitStreak = 0;
  }
  get active() { return this._active; }
  update(condition) {
    if (condition) {
      this._enterStreak += 1;
      this._exitStreak = 0;
      if (!this._active && this._enterStreak >= this.enterFrames) this._active = true;
    } else {
      this._exitStreak += 1;
      this._enterStreak = 0;
      if (this._active && this._exitStreak >= this.exitFrames) this._active = false;
    }
    return this._active;
  }
  reset() {
    this._active = false;
    this._enterStreak = 0;
    this._exitStreak = 0;
  }
}
