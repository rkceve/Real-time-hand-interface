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
      el.innerHTML = '<span class="rec-dot"></span>REC · press R to stop';
      document.body.appendChild(el);
      this._indicator = el;
    } else if (this._indicator) {
      this._indicator.remove();
      this._indicator = null;
    }
  }
}

let _shared = null;
export function getTelemetryRecorder() {
  if (!_shared) _shared = new TelemetryRecorder();
  return _shared;
}
