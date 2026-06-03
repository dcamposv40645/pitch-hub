let audioCtx = null;
let analyser = null;
let source = null;
let currentStream = null;
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

// --- chord-based key detection ---

// diatonic chords for major keys: I ii iii IV V vi  (skipping diminished vii)
const MAJOR_DIATONIC = [[0,'major'],[2,'minor'],[4,'minor'],[5,'major'],[7,'major'],[9,'minor']];
// diatonic chords for minor keys: i III iv V VI VII  (harmonic/natural minor mix)
const MINOR_DIATONIC = [[0,'minor'],[3,'major'],[5,'minor'],[7,'major'],[8,'major'],[10,'major']];

const chordHistory = [];
const MAX_CHORD_HISTORY = 40; // ~6 seconds at 150ms per frame

// Given a 12-bin HPCP, return the best-matching major or minor triad.
// Returns null if no chord is prominent enough (probably silence or noise).
function detectChord(hpcp) {
  const energy = Array.from(hpcp).reduce((s, v) => s + v, 0);
  if (energy < 0.01) return null;
  const norm = Array.from(hpcp).map(v => v / energy);

  let best = { root: 0, quality: 'major', score: 0 };
  for (let r = 0; r < 12; r++) {
    // score = fraction of energy sitting on root + third + fifth
    const maj = norm[r] + norm[(r + 4) % 12] + norm[(r + 7) % 12];
    const min = norm[r] + norm[(r + 3) % 12] + norm[(r + 7) % 12];
    if (maj > best.score) best = { root: r, quality: 'major', score: maj };
    if (min > best.score) best = { root: r, quality: 'minor', score: min };
  }

  // uniform random baseline ≈ 0.25; require meaningfully above that
  return best.score > 0.38 ? best : null;
}

// Score all 24 keys against the chord history and return the winner.
function keyFromChords() {
  if (chordHistory.length < 5) return null;

  const totalWeight = chordHistory.reduce((s, c) => s + c.score, 0);
  let best = { root: 0, scale: 'major', score: 0 };

  for (let r = 0; r < 12; r++) {
    let majWeight = 0, minWeight = 0;
    for (const c of chordHistory) {
      if (MAJOR_DIATONIC.some(([iv, q]) => (r + iv) % 12 === c.root && q === c.quality)) {
        // tonic chord (I) gets double weight to break ties between adjacent keys
        majWeight += c.score * (c.root === r && c.quality === 'major' ? 2 : 1);
      }
      if (MINOR_DIATONIC.some(([iv, q]) => (r + iv) % 12 === c.root && q === c.quality)) {
        minWeight += c.score * (c.root === r && c.quality === 'minor' ? 2 : 1);
      }
    }
    const majScore = majWeight / totalWeight;
    const minScore = minWeight / totalWeight;
    if (majScore > best.score) best = { root: r, scale: 'major', score: majScore };
    if (minScore > best.score) best = { root: r, scale: 'minor', score: minScore };
  }

  return best.score >= 0.3 ? best : null;
}

function pushChordAndEmit(chord) {
  chordHistory.push(chord);
  if (chordHistory.length > MAX_CHORD_HISTORY) chordHistory.shift();

  const key = keyFromChords();
  if (!key) return;

  const noteName = key.scale === 'major' ? NOTE_MAJOR[key.root] : NOTE_MINOR[key.root];
  const scaleName = key.scale === 'major' ? 'Major' : 'Minor';
  const keyName = `${noteName} ${scaleName}`;
  const info = KEY_INFO.find(k => k.name === keyName);

  const confidence = key.score >= 0.7 ? 'high' : key.score >= 0.45 ? 'medium' : 'low';

  chrome.runtime.sendMessage({
    type: 'keyResult',
    name: keyName,
    chords: info ? info.chords : [],
    confidence
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
    const chord = detectChord(hpcp);
    if (chord) pushChordAndEmit(chord);
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
  chordHistory.length = 0;
  essentiaProcessing = false;
}

// fires once on load — background holds off on sending tasks until it hears this
chrome.runtime.sendMessage({ type: 'offscreenReady' });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'initAudio') {
    mode = msg.mode || 'hpcp';
    setupAudio(msg.streamId);
  } else if (msg.type === 'setMode') {
    mode = msg.mode;
    resetState();
  } else if (msg.type === 'recordSample') {
    recordSample(msg.streamId, msg.duration || 10000);
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

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 8192;

    currentStream = stream;
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
    const chord = detectChord(hpcp);
    if (chord) pushChordAndEmit(chord);
  }, 150);
}

async function recordSample(streamId, duration) {
  let stream = currentStream;
  let ownStream = false;

  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
        video: false
      });
      ownStream = true;
    } catch (err) {
      chrome.runtime.sendMessage({ type: 'audioSample', error: 'Could not access tab audio' });
      return;
    }
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];

  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    if (ownStream) stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: mimeType });
    console.log('[identify] recorded blob:', blob.size, 'bytes', blob.type);
    const reader = new FileReader();
    reader.onloadend = () => {
      chrome.runtime.sendMessage({ type: 'audioSample', dataUrl: reader.result });
    };
    reader.readAsDataURL(blob);
  };

  recorder.start();
  setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, duration);
}

// HPCP with harmonic weighting — each bin is treated as a potential harmonic of
// a lower fundamental; energy is folded back to the fundamental's pitch class
// weighted by 1/h² so harmonics reinforce their root rather than other classes.
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
