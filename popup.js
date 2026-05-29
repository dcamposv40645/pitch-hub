const startBtn = document.getElementById('startBtn');
const noteEl = document.getElementById('note');
const freqEl = document.getElementById('frequency');

let capturing = false;

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

    capturing = true;
    startBtn.textContent = 'Listening...';
    freqEl.textContent = 'audio pipeline ready';
  });
});
