// Pinch hysteresis detector — port of gesture_window/tracker.py PinchDetector.
// Below close_ratio the pinch closes; above open_ratio it opens.
// The gap between the two thresholds prevents flicker at the boundary.

export const PinchState = Object.freeze({ OPEN: 'open', CLOSED: 'closed' });

export class PinchDetector {
  constructor({ closeRatio = 0.30, openRatio = 0.45 } = {}) {
    this.closeRatio = closeRatio;
    this.openRatio = openRatio;
    this.state = PinchState.OPEN;
  }

  // ratio = thumbIndexDistance / handSize.
  // Returns { state, transitioned }
  update(ratio) {
    const prev = this.state;
    if (this.state === PinchState.OPEN && ratio < this.closeRatio) {
      this.state = PinchState.CLOSED;
    } else if (this.state === PinchState.CLOSED && ratio > this.openRatio) {
      this.state = PinchState.OPEN;
    }
    return { state: this.state, transitioned: prev !== this.state };
  }

  reset() {
    this.state = PinchState.OPEN;
  }
}
