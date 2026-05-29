const startBtn = document.getElementById('startBtn');
const noteEl = document.getElementById('note');
const freqEl = document.getElementById('frequency');

let capturing = false;
let streamId = null;

startBtn.addEventListener('click', () => {
  if (capturing) return;

  startBtn.textContent = 'Starting...';
  startBtn.disabled = true;

  chrome.runtime.sendMessage({ type: 'startCapture' }, (res) => {
    if (chrome.runtime.lastError || res?.error) {
      console.error('capture failed:', res?.error || chrome.runtime.lastError);
      startBtn.textContent = 'Start Detection';
      startBtn.disabled = false;
      return;
    }

    streamId = res.streamId;
    capturing = true;

    // stream ID is ready — audio pipeline comes next
    console.log('got stream id:', streamId);
    startBtn.textContent = 'Listening...';
    freqEl.textContent = 'audio captured';
  });
});
