let audioCtx = null;
let analyser = null;
let source = null;
let mode = 'hpcp';

// note names per scale (different enharmonic spelling for C#/Db etc.)
const NOTE_MAJOR = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const NOTE_MINOR = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

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

// --- Krumhansl-Schmuckler key detection ---

// Temperley (2007) key profiles — weight the 3rd scale degree more heavily than K-S,
// which gives a stronger major/minor distinction (B vs Bb for G major/minor).
const KS_MAJOR = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
const KS_MINOR = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0];

const hpcpAccum = new Float32Array(12);
let hpcpFrameCount = 0;

function keyFromHPCP(hpcp) {
  hpcpFrameCount++;
  if (hpcpFrameCount <= 10) return null;

  const energy = hpcp.reduce((s, v) => s + v, 0);
  if (energy < 0.05) return null;

  for (let i = 0; i < 12; i++) hpcpAccum[i] = hpcpAccum[i] * 0.999 + hpcp[i] / energy;

  const accumulated = hpcpFrameCount - 10;
  if (accumulated % 200 !== 0) return null;

  const total = hpcpAccum.reduce((s, v) => s + v, 0);
  if (total < 0.001) return null;

  let best = { root: 0, scale: 'major', score: -Infinity };
  let secondScore = -Infinity;

  for (let r = 0; r < 12; r++) {
    for (const [prof, scale] of [[KS_MAJOR, 'major'], [KS_MINOR, 'minor']]) {
      const profMean = prof.reduce((s, v) => s + v, 0) / 12;
      let score = 0;
      for (let i = 0; i < 12; i++) {
        score += (hpcpAccum[i] / total) * (prof[(i - r + 12) % 12] - profMean);
      }
      if (score > best.score) {
        secondScore = best.score;
        best = { root: r, scale, score };
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
  }

  const margin = best.score - secondScore;
  console.log(`[ks] best: ${NOTE_MAJOR[best.root]} ${best.scale} ${best.score.toFixed(3)} | margin: ${margin.toFixed(3)}`);

  // Require a clear winner — thin margins mean the algorithm is guessing
  if (best.score < 0.03 || margin < 0.01) return null;

  // Results before 400 frames (~60s) are preliminary; confidence uses score after that
  const confidence = accumulated < 400 ? 'low'
    : best.score > 0.15 ? 'high'
    : best.score > 0.08 ? 'medium'
    : 'low';

  return { ...best, confidence };
}

function emitKeyResult(key) {
  const noteName = key.scale === 'major' ? NOTE_MAJOR[key.root] : NOTE_MINOR[key.root];
  const scaleName = key.scale === 'major' ? 'Major' : 'Minor';
  const keyName = `${noteName} ${scaleName}`;
  const info = KEY_INFO.find(k => k.name === keyName);

  chrome.runtime.sendMessage({
    type: 'keyResult',
    name: keyName,
    root: key.root,
    scale: key.scale,
    chords: info ? info.chords : [],
    confidence: key.confidence
  });
}

// --- Essentia engine ---
let essentiaReady = false;
let essentiaProcessing = false;
const essentiaFrame = document.getElementById('essentiaFrame');

window.addEventListener('message', (e) => {
  if (e.data.type === 'essentiaReady') {
    essentiaReady = true;
  } else if (e.data.type === 'essentiaHPCP') {
    essentiaProcessing = false;
    const hpcp = new Float32Array(e.data.hpcp);
    const key = keyFromHPCP(hpcp);
    if (key) emitKeyResult(key);
  }
});

if (essentiaFrame) {
  essentiaFrame.addEventListener('load', async () => {
    try {
      const get = (path) => fetch(chrome.runtime.getURL(path)).then(r => r.arrayBuffer());
      const [coreJs, wasmJs, wasmBinary] = await Promise.all([
        get('lib/essentia-core.umd.min.js'),
        get('lib/essentia-wasm.web.js'),
        get('lib/essentia-wasm.web.wasm'),
      ]);
      essentiaFrame.contentWindow.postMessage(
        { type: 'initEssentia', coreJs, wasmJs, wasmBinary },
        '*',
        [coreJs, wasmJs, wasmBinary]
      );
    } catch (err) {
      console.error('Essentia prefetch failed:', err);
    }
  });
}

function resetState() {
  hpcpAccum.fill(0);
  hpcpFrameCount = 0;
  essentiaProcessing = false;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'initAudio') {
    mode = msg.mode || 'hpcp';
    setupAudio(msg.streamId);
  } else if (msg.type === 'setMode') {
    mode = msg.mode;
    resetState();
  }
});

async function setupAudio(streamId) {
  resetState();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });

    audioCtx = new AudioContext();
    await audioCtx.resume();

    const streamSR = stream.getAudioTracks()[0]?.getSettings()?.sampleRate;
    console.log(`stream SR: ${streamSR}, context SR: ${audioCtx.sampleRate}`);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 16384;

    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(audioCtx.destination);

    startAnalysis();
  } catch (err) {
    console.error('audio setup failed:', err);
  }
}

function startAnalysis() {
  const freqData = new Float32Array(analyser.frequencyBinCount);
  const timeData = new Float32Array(analyser.fftSize);
  const sampleRate = audioCtx.sampleRate;
  const fftSize = analyser.fftSize;

  setInterval(() => {
    if (mode === 'essentia') {
      if (!essentiaReady || essentiaProcessing || !essentiaFrame?.contentWindow) return;
      analyser.getFloatTimeDomainData(timeData);
      const buffer = timeData.buffer.slice(0);
      essentiaProcessing = true;
      essentiaFrame.contentWindow.postMessage(
        { type: 'analyzeFrame', buffer, frameSize: fftSize, sampleRate },
        '*',
        [buffer]
      );
      return;
    }

    // default HPCP engine
    analyser.getFloatFrequencyData(freqData);
    const magnitudes = new Float32Array(freqData.length);
    for (let i = 0; i < freqData.length; i++) {
      magnitudes[i] = freqData[i] < -90 ? 0 : Math.pow(10, freqData[i] / 20);
    }

    const hpcp = computeHPCP(magnitudes, sampleRate, fftSize);
    const key = keyFromHPCP(hpcp);
    if (key) emitKeyResult(key);
  }, 150);
}

function computeHPCP(magnitudes, sampleRate, fftSize) {
  const hpcp = new Float32Array(12);
  const binHz = sampleRate / fftSize;

  for (let bin = 1; bin < magnitudes.length; bin++) {
    const freq = bin * binHz;
    if (freq < 50 || freq > 2500) continue;
    const mag = magnitudes[bin];
    if (mag < 0.001) continue;

    // Bass frequencies carry the chord root and are more tonally informative.
    // Weight them up to ~3x relative to upper midrange.
    const bassWeight = 1 + 2 * Math.exp(-freq / 300);

    const midi = 12 * Math.log2(freq / 440) + 69;
    const lo = Math.floor(midi);
    const frac = midi - lo;
    const weighted = mag * bassWeight;
    hpcp[((lo % 12) + 12) % 12]      += weighted * (1 - frac);
    hpcp[(((lo + 1) % 12) + 12) % 12] += weighted * frac;
  }

  return hpcp;
}
