// Tiny WebAudio "tick" + "exit chime".  Must be unlocked by a user gesture
// (start button) per browser autoplay policy.

let ctx = null;
let muted = false;

export function unlockAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

export function setMuted(m) {
  muted = !!m;
}

function beep({ freq = 800, duration = 0.04, type = 'sine', gain = 0.12 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export function playTick() {
  beep({ freq: 1320, duration: 0.05, type: 'square', gain: 0.10 });
}

export function playSelect() {
  beep({ freq: 880, duration: 0.07, type: 'sine', gain: 0.13 });
  setTimeout(() => beep({ freq: 1320, duration: 0.06, type: 'sine', gain: 0.10 }), 35);
}

export function playExit() {
  beep({ freq: 660, duration: 0.06, type: 'sine', gain: 0.10 });
  setTimeout(() => beep({ freq: 440, duration: 0.08, type: 'sine', gain: 0.10 }), 50);
}
