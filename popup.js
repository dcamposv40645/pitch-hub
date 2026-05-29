const startBtn = document.getElementById('startBtn');
const keyRootEl = document.getElementById('keyRoot');
const keyQualityEl = document.getElementById('keyQuality');
const confidenceEl = document.getElementById('confidence');
const scaleNotesEl = document.getElementById('scaleNotes');

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
    startBtn.textContent = 'Analyzing...';
    keyQualityEl.textContent = 'listening...';
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'keyResult') return;

  // split "F Major" → root="F", quality="Major"
  const parts = msg.name.split(' ');
  keyRootEl.textContent = parts[0];
  keyQualityEl.textContent = parts[1];

  confidenceEl.className = `confidence ${msg.confidence}`;
  confidenceEl.textContent = msg.confidence === 'low' ? 'early guess — still listening'
    : msg.confidence === 'medium' ? 'getting confident...'
    : 'confident';

  scaleNotesEl.innerHTML = msg.chords
    .map(c => `<span class="note-pill">${c}</span>`)
    .join('');

  startBtn.textContent = 'Listening...';
});
