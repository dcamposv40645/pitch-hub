let audioCtx = null;
let source = null;
let meydaAnalyzer = null;

// KS profiles with boosted tonic and reduced dominant weight —
// helps when songs spend a lot of time on the V chord (e.g. G in C major)
const KS_MAJOR = [7.5, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 3.5, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [7.5, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 3.5, 3.98, 2.69, 3.34, 3.17];
const NOTE = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

const KEY_INFO = [
  // major keys — chords: I  ii  iii  IV  V7  vi  vii
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
  // minor keys — chords: i  ii  III  iv  V7(harmonic)  VI  VII
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
const keyVotes = []; // sliding window of recent key detections

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

    source = audioCtx.createMediaStreamSource(stream);
    source.connect(audioCtx.destination);

    meydaAnalyzer = Meyda.createMeydaAnalyzer({
      audioContext: audioCtx,
      source,
      bufferSize: 4096,
      featureExtractors: ['chroma'],
      callback: (features) => {
        if (!features?.chroma) return;

        const chroma = features.chroma;
        const total = chroma.reduce((a, b) => a + b, 0);
        if (total < 0.01) return;

        // normalize this frame before accumulating
        for (let i = 0; i < 12; i++) chromaSum[i] += chroma[i] / total;
        frameCount++;

        if (frameCount % 20 === 0) {
          const sorted = Array.from(chromaSum)
            .map((v, i) => ({ v, n: NOTE[i] }))
            .sort((a, b) => b.v - a.v);
          console.log(`frame ${frameCount} | top 4: ` + sorted.slice(0, 4).map(x => `${x.n}:${x.v.toFixed(1)}`).join(' '));
        }

        if (frameCount >= 60 && frameCount % 30 === 0) {
          const idx = detectKey(chromaSum);
          keyVotes.push(idx);
          if (keyVotes.length > 15) keyVotes.shift();

          const counts = {};
          for (const k of keyVotes) counts[k] = (counts[k] || 0) + 1;
          const winner = parseInt(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
          const topVotes = counts[winner];
          const total = keyVotes.length;

          // low = early guess, medium = getting there, high = confident
          const confidence = total < 5 ? 'low' : topVotes / total >= 0.6 ? 'high' : 'medium';

          const info = KEY_INFO[winner];
          chrome.runtime.sendMessage({ type: 'keyResult', name: info.name, chords: info.chords, confidence });
        }
      }
    });

    meydaAnalyzer.start();
    console.log('Meyda running, rate:', audioCtx.sampleRate);
  } catch (err) {
    console.error('audio setup failed:', err);
  }
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
