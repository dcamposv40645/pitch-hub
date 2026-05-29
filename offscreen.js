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
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    // don't connect to destination — the tab is already playing audio,
    // connecting here would double it up
    console.log('audio pipeline ready, sample rate:', audioCtx.sampleRate);
  } catch (err) {
    console.error('audio setup failed:', err);
  }
}
