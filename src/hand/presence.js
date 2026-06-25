// Hysteresis presence tracker — port of gesture_window/hologram.py HandPresenceTracker.
// Absorbs single-frame flickers when the hand brushes the camera edge.

export class HandPresenceTracker {
  constructor({ enterFrames = 3, exitFrames = 10 } = {}) {
    this.enterFrames = enterFrames;
    this.exitFrames = exitFrames;
    this._present = false;
    this._detectStreak = 0;
    this._missStreak = 0;
  }

  get present() {
    return this._present;
  }

  update(detected) {
    if (detected) {
      this._detectStreak += 1;
      this._missStreak = 0;
      if (!this._present && this._detectStreak >= this.enterFrames) {
        this._present = true;
      }
    } else {
      this._missStreak += 1;
      this._detectStreak = 0;
      if (this._present && this._missStreak >= this.exitFrames) {
        this._present = false;
      }
    }
    return this._present;
  }

  // Returns how many consecutive frames the hand has been missing.
  get missStreak() {
    return this._missStreak;
  }
}
