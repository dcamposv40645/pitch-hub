let essentia = null;

window.addEventListener('message', async (e) => {
  if (e.data.type === 'initEssentia') {
    await initEssentia(e.data);
  } else if (e.data.type === 'analyzeFrame' && essentia) {
    analyzeFrame(e.data);
  }
});

async function initEssentia({ coreJs, wasmJs, wasmBinary }) {
  try {
    await loadFromBuffer(coreJs);

    // provide the binary upfront so Emscripten never tries to fetch it
    window.Module = { wasmBinary };
    await loadFromBuffer(wasmJs);

    const module = await EssentiaWASM(window.Module);
    essentia = new Essentia(module);
    parent.postMessage({ type: 'essentiaReady' }, '*');
  } catch (err) {
    console.error('Essentia init failed:', err);
  }
}

function loadFromBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => { URL.revokeObjectURL(url); resolve(); };
    script.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    document.head.appendChild(script);
  });
}

function analyzeFrame({ buffer, frameSize, sampleRate }) {
  try {
    const frame = essentia.arrayToVector(new Float32Array(buffer));
    const windowed = essentia.Windowing(frame, true, 0, 'hann', frameSize, true);
    const spectrum = essentia.Spectrum(windowed.frame, frameSize);
    const peaks = essentia.SpectralPeaks(
      spectrum.spectrum, 0.0001, 3500, 60, 100, 'magnitude', sampleRate
    );
    const hpcpOut = essentia.HPCP(
      peaks.frequencies, peaks.magnitudes,
      12, 440, 0, true, 500, 3500, 100, false, 'unitMax', 'squaredCosine', 1.0, sampleRate, false
    );
    const keyOut = essentia.Key(hpcpOut.hpcp);
    parent.postMessage({
      type: 'essentiaKey',
      key: keyOut.key,
      scale: keyOut.scale,
      strength: keyOut.strength
    }, '*');
  } catch (err) {
    console.error('Essentia analysis error:', err);
  }
}
