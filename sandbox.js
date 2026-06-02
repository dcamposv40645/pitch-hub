// runs in a sandboxed page so Essentia's eval usage is allowed here
let essentia = null;

EssentiaWASM().then(module => {
  essentia = new Essentia(module);
  parent.postMessage({ type: 'essentiaReady' }, '*');
  console.log('Essentia ready in sandbox, version:', essentia.version);
});

window.addEventListener('message', (e) => {
  if (e.data.type !== 'computeHPCP' || !essentia) return;

  try {
    const { buffer, frameSize, sampleRate } = e.data;
    const frame = essentia.arrayToVector(buffer);
    const windowed = essentia.Windowing(frame, true, 0, 'hann', frameSize, true);
    const spectrum = essentia.Spectrum(windowed.frame, frameSize);
    const peaks = essentia.SpectralPeaks(
      spectrum.spectrum,
      0.0001,      // magnitudeThreshold
      3500,        // maxFrequency
      60,          // maxPeaks
      100,         // minFrequency
      'magnitude', // orderBy
      sampleRate
    );
    const hpcpOut = essentia.HPCP(
      peaks.frequencies,
      peaks.magnitudes,
      12, 440, 0, true, 500, 3500, 100, false, 'unitMax', 'squaredCosine', 1.0, sampleRate, false
    );
    const hpcp = Array.from(essentia.vectorToArray(hpcpOut.hpcp));
    parent.postMessage({ type: 'hpcpResult', hpcp }, '*');
  } catch (err) {
    console.error('HPCP error:', err);
  }
});
