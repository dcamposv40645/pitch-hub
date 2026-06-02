let audioCtx = null;
let analyser = null;
let source = null;

const KS_MAJOR = [7.5, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 3.5, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [7.5, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 3.5, 3.98, 2.69, 3.34, 3.17];
const NOTE = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

const KEY_INFO = [
  { name: 'C Major',  chords: ['C','Dm','Em','F','G7','Am','Bm'] },
  { name: 'Db Major', chords: ['Db','Ebm','Fm','Gb','Ab7','Bbm','Cm'] },
  { name: 'D Major',  chords: ['D','Em','F#m','G','A7','Bm','C#m'] },
  { name: 'Eb Major', chords: ['Eb','Fm','Gm','Ab','Bb7','Cm','Dm'] },
  { name: 'E Major',  chords: ['E','F#m','G#m','A','B7','C#m','D#m'] },
  { name: 'F Major',  chords: ['F','Gm','Am','Bb','C7','Dm','Em'] },
  { name: 'F# Major', chords: ['F#','G#m','A#m','B','C#7','D#m','Fm'] },
  { name: 'G Major',  chords: ['G','Am','Bm','C','D7','Em','F#m'] },
  { name: 'Ab Major', chords: ['Ab','Bbm','Cm','Db','Eb7','Fm','Gm'] },
  { name: 'A Major',  chords: ['A','Bm','C#m','D','E7','F#m','G#m'] },
  { name: 'Bb Major', chords: ['Bb','Cm','Dm','Eb','F7','Gm','Am'] },
  { name: 'B Major',  chords: ['B','C#m','D#m','E','F#7','G#m','A#m'] },
  { name: 'C Minor',  chords: ['Cm','Dm','Eb','Fm','G7','Ab','Bb'] },
  { name: 'C# Minor', chords: ['C#m','D#m','E','F#m','G#7','A','B'] },
  { name: 'D Minor',  chords: ['Dm','Em','F','Gm','A7','Bb','C'] },
  { name: 'Eb Minor', chords: ['Ebm','Fm','Gb','Abm','Bb7','B','Db'] },
  { name: 'E Minor',  chords: ['Em','F#m','G','Am','B7','C','D'] },
  { name: 'F Minor',  chords: ['Fm','Gm','Ab','Bbm','C7','Db','Eb'] },
  { name: 'F# Minor', chords: ['F#m','G#m','A','Bm','C#7','D','E'] },
  { name: 'G Minor',  chords: ['Gm','Am','Bb','Cm','D7','Eb','F'] },
  { name: 'Ab Minor', chords: ['Abm','Bbm','B','Dbm','Eb7','E','Gb'] },
  { name: 'A Minor',  chords: ['Am','Bm','C','Dm','E7','F','G'] },
  { name: 'Bb Minor', chords: ['Bbm','Cm','Db','Ebm','F7','Gb','Ab'] },
  { name: 'B Minor',  chords: ['Bm','C#m','D','Em','F#7','G','A'] },
];

const chromaSum = new Float64Array(12);
let frameCount = 0;
const keyVotes = [];

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'initAudio') setupAudio(msg.streamId);
});

async function setupAudio(streamId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    audioCtx = new AudioContext();
    await audioCtx.resume();

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 8192;

    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(audioCtx.destination);

    startAnalysis();
    console.log('audio ready, rate:', audioCtx.sampleRate);
  } catch (err) {
    console.error('audio setup failed:', err);
  }
}

function startAnalysis() {
  const freqData = new Float32Array(analyser.frequencyBinCount);
  const sampleRate = audioCtx.sampleRate;
  const fftSize = analyser.fftSize;

  setInterval(() => {
    analyser.getFloatFrequencyData(freqData);

    // convert dB → linear magnitudes for HPCP
    const magnitudes = new Float32Array(freqData.length);
    for (let i = 0; i < freqData.length; i++) {
      magnitudes[i] = freqData[i] < -90 ? 0 : Math.pow(10, freqData[i] / 20);
    }

    const hpcp = computeHPCP(magnitudes, sampleRate, fftSize);
    const energy = hpcp.reduce((a, b) => a + b, 0);
    if (energy < 0.01) return;

    for (let i = 0; i < 12; i++) chromaSum[i] += hpcp[i] / energy;
    frameCount++;

    if (frameCount % 20 === 0) {
      const sorted = Array.from(chromaSum)
        .map((v, i) => ({ v, n: NOTE[i] }))
        .sort((a, b) => b.v - a.v);
      console.log(`frame ${frameCount} | top 4:`, sorted.slice(0, 4).map(x => `${x.n}:${x.v.toFixed(1)}`).join(' '));
    }

    if (frameCount >= 60 && frameCount % 30 === 0) {
      const idx = detectKey(chromaSum);
      keyVotes.push(idx);
      if (keyVotes.length > 15) keyVotes.shift();

      const counts = {};
      for (const k of keyVotes) counts[k] = (counts[k] || 0) + 1;
      const winner = parseInt(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
      const topVotes = counts[winner];
      const confidence = keyVotes.length < 5 ? 'low'
        : topVotes / keyVotes.length >= 0.6 ? 'high' : 'medium';

      const info = KEY_INFO[winner];
      chrome.runtime.sendMessage({ type: 'keyResult', name: info.name, chords: info.chords, confidence });
    }
  }, 150);
}

// HPCP with harmonic weighting — each frequency bin is treated as a potential
// harmonic of a lower fundamental. Energy is assigned back to the fundamental's
// pitch class, weighted by 1/h^2. This means harmonics reinforce their root
// note rather than polluting other pitch classes.
function computeHPCP(magnitudes, sampleRate, fftSize) {
  const hpcp = new Float32Array(12);
  const binHz = sampleRate / fftSize;

  for (let bin = 1; bin < magnitudes.length; bin++) {
    const freq = bin * binHz;
    if (freq < 80 || freq > 4000) continue;

    const mag = magnitudes[bin];
    if (mag < 0.001) continue;

    for (let h = 1; h <= 5; h++) {
      const fundamental = freq / h;
      if (fundamental < 80 || fundamental > 4000) continue;

      const midi = 12 * Math.log2(fundamental / 440) + 69;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      hpcp[pc] += mag / (h * h);
    }
  }

  return hpcp;
}

function detectKey(sum) {
  let bestScore = -Infinity;
  let bestIdx = 0;
  for (let root = 0; root < 12; root++) {
    const maj = pearson(sum, rotate(KS_MAJOR, root));
    const min = pearson(sum, rotate(KS_MINOR, root));
    if (maj > bestScore) { bestScore = maj; bestIdx = root; }
    if (min > bestScore) { bestScore = min; bestIdx = root + 12; }
  }
  return bestIdx;
}

function rotate(profile, steps) {
  return profile.map((_, i) => profile[(i - steps + 12) % 12]);
}

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const ra = a[i] - ma, rb = b[i] - mb;
    num += ra * rb; da += ra * ra; db += rb * rb;
  }
  return (da === 0 || db === 0) ? 0 : num / Math.sqrt(da * db);
}
