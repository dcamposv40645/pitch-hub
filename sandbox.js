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
    const decoder = new TextDecoder();

    // blob: src is blocked by CSP, but 'unsafe-inline' is allowed —
    // inject the JS text directly instead of loading from a URL
    inlineScript(decoder.decode(coreJs));  // defines Essentia
    inlineScript(decoder.decode(wasmJs));  // defines EssentiaWASM

    // create a blob URL for the .wasm binary so Emscripten can fetch it
    // (fetch from blob: works even in null-origin; only script src is blocked)
    const wasmBlob = new Blob([wasmBinary], { type: 'application/wasm' });
    const wasmUrl = URL.createObjectURL(wasmBlob);

    const module = await EssentiaWASM({
      wasmBinary,
      locateFile: (path) => path.endsWith('.wasm') ? wasmUrl : path
    });

    URL.revokeObjectURL(wasmUrl);
    essentia = new Essentia(module);
    parent.postMessage({ type: 'essentiaReady' }, '*');
  } catch (err) {
    console.error('Essentia init failed:', err);
  }
}

function inlineScript(code) {
  const s = document.createElement('script');
  s.textContent = code;
  document.head.appendChild(s);
}

function analyzeFrame({ buffer, frameSize, sampleRate }) {
  try {
    const frame = essentia.arrayToVector(new Float32Array(buffer));

    // Windowing(frame, normalized, size, type, zeroPadding, zeroPhase)
    const windowed = essentia.Windowing(frame, true, frameSize, 'hann', 0, true);

    // Spectrum(frame, size)
    const spectrum = essentia.Spectrum(windowed.frame, frameSize);

    // SpectralPeaks(spectrum, magnitudeThreshold, maxFrequency, maxPeaks, minFrequency, orderBy, sampleRate)
    const peaks = essentia.SpectralPeaks(
      spectrum.spectrum,
      0.0001,      // magnitudeThreshold
      3500,        // maxFrequency
      60,          // maxPeaks
      100,         // minFrequency
      'magnitude', // orderBy
      sampleRate   // sampleRate
    );

    // HPCP(frequencies, magnitudes, bandPreset, bandSplitFrequency, harmonics,
    //      maxFrequency, maxShifted, minFrequency, nonLinear, normalized,
    //      referenceFrequency, sampleRate, size, weightType, windowSize)
    const hpcpOut = essentia.HPCP(
      peaks.frequencies,
      peaks.magnitudes,
      true,            // bandPreset
      500,             // bandSplitFrequency
      3,               // harmonics
      3500,            // maxFrequency
      false,           // maxShifted
      100,             // minFrequency
      false,           // nonLinear
      'unitMax',       // normalized
      440,             // referenceFrequency
      sampleRate,      // sampleRate
      12,              // size
      'squaredCosine', // weightType
      1.0              // windowSize
    );

    // return raw HPCP so offscreen.js can run chord-based key detection
    const hpcpArray = essentia.vectorToArray(hpcpOut.hpcp);
    const hpcpBuffer = hpcpArray.buffer.slice(0);
    parent.postMessage({ type: 'essentiaHPCP', hpcp: hpcpBuffer }, '*', [hpcpBuffer]);
  } catch (err) {
    console.error('Essentia analysis error:', err);
  }
}
