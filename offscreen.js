let audioCtx = null;
let analyser = null;
let source = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'initAudio') {
    setupAudio(msg.streamId);
  }
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

    // offscreen docs don't have a user gesture so the context starts suspended
    await audioCtx.resume();

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(audioCtx.destination); // route audio back to speakers so the tab isn't muted

    console.log('audio pipeline ready, state:', audioCtx.state, 'rate:', audioCtx.sampleRate);
    startDetection();
  } catch (err) {
    console.error('audio setup failed:', err);
  }
}

function startDetection() {
  const buffer = new Float32Array(analyser.fftSize);

  setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);

    const freq = detectPitch(buffer, audioCtx.sampleRate);
    if (freq !== null) {
      const note = freqToNote(freq);
      chrome.runtime.sendMessage({
        type: 'pitchResult',
        note,
        frequency: Math.round(freq)
      });
    }
  }, 100);
}

function detectPitch(buffer, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.01) return null;

  const n = buffer.length;
  const minLag = Math.floor(sampleRate / 1500);
  const maxLag = Math.ceil(sampleRate / 60);

  let maxCorr = -1;
  let bestLag = -1;

  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let corr = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += buffer[i] * buffer[i + lag];
    }
    if (corr > maxCorr) {
      maxCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag === -1 || maxCorr < 0.01) return null;

  // parabolic interpolation for a more precise frequency
  const prev = bestLag > minLag ? corrAtLag(buffer, n, bestLag - 1) : maxCorr;
  const next = bestLag < maxLag ? corrAtLag(buffer, n, bestLag + 1) : maxCorr;
  const refined = bestLag + (next - prev) / (2 * (2 * maxCorr - prev - next));

  return sampleRate / refined;
}

function corrAtLag(buffer, n, lag) {
  let sum = 0;
  for (let i = 0; i < n - lag; i++) sum += buffer[i] * buffer[i + lag];
  return sum;
}

function freqToNote(freq) {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = Math.round(12 * Math.log2(freq / 440) + 69);
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = ((midi % 12) + 12) % 12;
  return notes[noteIndex] + octave;
}
