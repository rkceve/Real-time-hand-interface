// Telemetry recorder.
//
// Records a snapshot of every detection frame's processing-pipeline state
// to an in-memory ring of records, then dumps the whole thing as NDJSON
// when the user toggles recording off.  Lets the developer (with no
// browser access) read what actually happened during a user's local
// session — what landmarks the model saw, what finger states were
// derived, whether the pointing hysteresis fired, what the OneEuro
// filter wrote to the cursor, what the pinch detector said.
//
// Per frame we capture ~25 fields, ~600 bytes uncompressed.  10 000
// frames ≈ 6 MB, enough for ~11 minutes at 15 fps tracking.
//
// Activation: press R while the app is focused.
//   - First press: start recording, show top-centre REC pill
//   - Second press: stop, trigger a browser download of the ndjson file
//
// File format: NDJSON (one JSON object per line, newline-separated).
// Each line is one tracker frame.  See `record()` for field meaning.

const MAX_FRAMES = 10_000;

class TelemetryRecorder {
  constructor() {
    this.frames = [];
    this.recording = false;
    this.startMs = 0;
    this._indicator = null;
  }

  start() {
    if (this.recording) return;
    this.frames = [];
    this.recording = true;
    this.startMs = performance.now();
    this._showIndicator(true);
    console.info('[telemetry] recording started — press R again to stop & download');
  }

  stop() {
    if (!this.recording) return 0;
    this.recording = false;
    this._showIndicator(false);
    const n = this.frames.length;
    console.info(`[telemetry] stopped — ${n} frames captured. Downloading…`);
    this._download();
    return n;
  }

  toggle() {
    if (this.recording) this.stop();
    else this.start();
  }

  isRecording() { return this.recording; }

  /**
   * Record ONE frame.  `snapshot` is a plain object; we add timing fields
   * and append to the buffer.
   */
  record(snapshot) {
    if (!this.recording) return;
    if (this.frames.length >= MAX_FRAMES) {
      console.warn('[telemetry] MAX_FRAMES reached, auto-stopping');
      this.stop();
      return;
    }
    this.frames.push({
      t: +(performance.now() - this.startMs).toFixed(1),
      ...snapshot,
    });
  }

  _download() {
    const ndjson = this.frames.map((f) => JSON.stringify(f)).join('\n');
    const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `gesture-telemetry-${ts}.ndjson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  _showIndicator(on) {
    if (on) {
      if (this._indicator) return;
      const el = document.createElement('div');
      el.id = 'telemetry-indicator';
      el.innerHTML = `
        <div class="ti-line ti-rec">
          <span class="rec-dot"></span>
          <span class="ti-label">REC</span>
          <span class="ti-dur">00:00</span>
          <span class="ti-frames">0 frames</span>
        </div>
        <div class="ti-line ti-fingers" title="Detected extended fingers">
          <span class="ti-finger" data-f="thumb"></span>
          <span class="ti-finger" data-f="index"></span>
          <span class="ti-finger" data-f="middle"></span>
          <span class="ti-finger" data-f="ring"></span>
          <span class="ti-finger" data-f="pinky"></span>
        </div>
        <div class="ti-hint">R to stop · NDJSON download</div>
      `;
      document.body.appendChild(el);
      this._indicator = el;
      this._tickInterval = setInterval(() => this._tickIndicator(), 250);
    } else if (this._indicator) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
      this._indicator.remove();
      this._indicator = null;
    }
  }

  _tickIndicator() {
    if (!this._indicator || !this.recording) return;
    const elapsed = (performance.now() - this.startMs) / 1000;
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');
    const dur = this._indicator.querySelector('.ti-dur');
    const frames = this._indicator.querySelector('.ti-frames');
    if (dur)    dur.textContent = `${mm}:${ss}`;
    if (frames) frames.textContent = `${this.frames.length} frames`;

    // Reflect the most recent frame's finger-state pattern as five lit /
    // unlit dots — gives a live visual diagnostic that the per-finger
    // 3-D cosine extension test is producing sensible decisions, without
    // having to download and grep the ndjson.
    // The tracker writes per-frame extension flags into the `ext` sub-object
    // as {t,i,m,r,p}; map them to thumb/index/middle/ring/pinky dots.
    const last = this.frames[this.frames.length - 1];
    const dots = this._indicator.querySelectorAll('.ti-finger');
    if (last && last.ext && dots.length === 5) {
      const keys = ['t', 'i', 'm', 'r', 'p'];
      keys.forEach((k, i) => dots[i].classList.toggle('on', !!last.ext[k]));
    }
  }
}

let _shared = null;
export function getTelemetryRecorder() {
  if (!_shared) _shared = new TelemetryRecorder();
  return _shared;
}
