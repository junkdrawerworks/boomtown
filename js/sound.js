// Small sounds made on the spot with Web Audio: no files to load. Off until the first tap (browsers insist).

let ctx = null, on = true;
export const setSound = v => { on = v; };
export const soundOn = () => on;

function ac() {
  if (!on) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq, t0, dur, { type = 'sine', vol = 0.15, slide = 0 } = {}) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + t0;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(t0, dur, { vol = 0.2, freq = 2000, q = 1 } = {}) {
  const a = ac(); if (!a) return;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + t0;
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  dice() { for (let k = 0; k < 5; k++) noise(k * 0.055 + Math.random() * 0.02, 0.05, { vol: 0.35, freq: 2500 + Math.random() * 1500, q: 4 }); },
  hop() { tone(520, 0, 0.06, { type: 'triangle', vol: 0.05 }); },
  coin() { tone(1320, 0, 0.12, { vol: 0.08 }); tone(1980, 0.06, 0.22, { vol: 0.07 }); },
  payday() { tone(880, 0, 0.1, { vol: 0.08 }); tone(1320, 0.08, 0.12, { vol: 0.08 }); tone(1760, 0.16, 0.3, { vol: 0.08 }); noise(0.16, 0.12, { vol: 0.12, freq: 5000 }); },
  pay() { tone(660, 0, 0.14, { type: 'triangle', vol: 0.08, slide: 0.6 }); },
  build() { for (let k = 0; k < 3; k++) { noise(k * 0.13, 0.05, { vol: 0.5, freq: 400, q: 2 }); tone(140, k * 0.13, 0.08, { vol: 0.12 }); } },
  sold() { for (const k of [0, 0.16]) { noise(k, 0.09, { vol: 0.55, freq: 650, q: 1.2 }); tone(110, k, 0.14, { vol: 0.16 }); } },
  fanfare() { [392, 523, 659, 784].forEach((f, k) => tone(f, k * 0.09, k === 3 ? 0.45 : 0.12, { type: 'square', vol: 0.045 })); },
  stamp() { noise(0, 0.08, { vol: 0.45, freq: 900, q: 1.5 }); tone(180, 0, 0.1, { vol: 0.1 }); },
  paper() { noise(0, 0.25, { vol: 0.18, freq: 3500, q: 0.7 }); },
  end() { [523, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.14, 0.35, { type: 'triangle', vol: 0.09 })); },
};
