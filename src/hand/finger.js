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
// (PIP-MCP) and (TIP-PIP); larger cosine = straighter finger.
//
// Combined with a length-ratio fallback that handles foreshortening when
// the finger points directly at the camera (cosine is unreliable there
// because both vectors collapse near zero magnitude in 2D projection).
function fingerExtended(lm, mcpIdx, pipIdx, tipIdx, cosThreshold = 0.1) {
  const mcp = lm[mcpIdx], pip = lm[pipIdx], tip = lm[tipIdx];
  const wrist = lm[LM.WRIST];

  // Cosine check (works for most orientations)
  const v1x = pip.x - mcp.x, v1y = pip.y - mcp.y;
  const v2x = tip.x - pip.x, v2y = tip.y - pip.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 > 1e-5 && m2 > 1e-5) {
    if ((v1x * v2x + v1y * v2y) / (m1 * m2) > cosThreshold) return true;
  }

  // Fallback: tip is markedly farther from wrist than MCP when extended,
  // even when the finger is foreshortened.
  const dMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
  const dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  return dTip > dMcp * 1.35;
}

function thumbExtended(lm) {
  return fingerExtended(lm, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP, 0.0);
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
