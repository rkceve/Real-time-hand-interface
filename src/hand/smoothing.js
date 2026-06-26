// OneEuro filter — direct port of gesture_window/smoothing.py.
// Reference: Casiez et al., "1€ Filter: A Simple Speed-based Low-pass Filter
// for Noisy Input in Interactive Systems", CHI 2012.

const TAU = Math.PI * 2;

function smoothingFactor(te, cutoff) {
  const r = TAU * cutoff * te;
  return r / (r + 1);
}

function expSmooth(a, x, xPrev) {
  return a * x + (1 - a) * xPrev;
}

export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this._xPrev = null;
    this._dxPrev = 0;
    this._tPrev = null;
  }

  filter(x, tSec) {
    const t = tSec ?? performance.now() / 1000;
    if (this._xPrev === null || this._tPrev === null) {
      this._xPrev = x;
      this._tPrev = t;
      return x;
    }
    const te = Math.max(t - this._tPrev, 1e-6);
    const aD = smoothingFactor(te, this.dCutoff);
    const dx = (x - this._xPrev) / te;
    const dxHat = expSmooth(aD, dx, this._dxPrev);
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = smoothingFactor(te, cutoff);
    const xHat = expSmooth(a, x, this._xPrev);
    this._xPrev = xHat;
    this._dxPrev = dxHat;
    this._tPrev = t;
    return xHat;
  }

  reset() {
    this._xPrev = null;
    this._dxPrev = 0;
    this._tPrev = null;
  }
}

export class OneEuroFilter2D {
  constructor(opts = {}) {
    this._fx = new OneEuroFilter(opts);
    this._fy = new OneEuroFilter(opts);
  }

  filter(point, tSec) {
    const t = tSec ?? performance.now() / 1000;
    return [this._fx.filter(point[0], t), this._fy.filter(point[1], t)];
  }

  reset() {
    this._fx.reset();
    this._fy.reset();
  }
}


function wrapAngle(a) {
  return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

// Shortest-path angular approach — port of hologram.py _approach_angle.
export function approachAngle(current, target, alpha) {
  const diff = wrapAngle(target - current);
  return wrapAngle(current + diff * alpha);
}
