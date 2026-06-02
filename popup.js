const startBtn = document.getElementById('startBtn');
const betaBtn = document.getElementById('betaBtn');
const keyRootEl = document.getElementById('keyRoot');
const keyQualityEl = document.getElementById('keyQuality');
const confidenceEl = document.getElementById('confidence');
const scaleNotesEl = document.getElementById('scaleNotes');

let capturing = false;
let betaMode = false;

function applyResult(msg) {
  const parts = msg.name.split(' ');
  keyRootEl.textContent = parts[0];
  keyQualityEl.textContent = parts[1];

  confidenceEl.className = `confidence ${msg.confidence}`;
  confidenceEl.textContent = msg.confidence === 'low' ? 'early guess — still listening'
    : msg.confidence === 'medium' ? 'getting confident...'
    : 'confident';

  scaleNotesEl.innerHTML = (msg.chords || [])
    .map(c => `<span class="note-pill">${c}</span>`)
    .join('');
}

function setListening(mode) {
  capturing = true;
  betaMode = mode === 'essentia';
  startBtn.textContent = 'Stop';
  startBtn.disabled = false;
  startBtn.classList.add('listening');
  betaBtn.textContent = betaMode ? 'Using Essentia Beta' : 'Try Essentia Beta';
  betaBtn.classList.toggle('active', betaMode);
  if (!betaMode) keyQualityEl.textContent = 'listening...';
}

function resetUI() {
  capturing = false;
  startBtn.textContent = 'Start Detection';
  startBtn.disabled = false;
  startBtn.classList.remove('listening');
  keyRootEl.textContent = '--';
  keyQualityEl.textContent = '';
  confidenceEl.textContent = '';
  confidenceEl.className = 'confidence';
  scaleNotesEl.innerHTML = '';
}

// restore state if capture was already running before popup was closed
chrome.runtime.sendMessage({ type: 'getState' }, (state) => {
  if (chrome.runtime.lastError) return;
  if (state?.active) {
    setListening(state.mode);
    if (state.lastResult) applyResult(state.lastResult);
  }
});

betaBtn.addEventListener('click', () => {
  betaMode = !betaMode;
  betaBtn.textContent = betaMode ? 'Using Essentia Beta' : 'Try Essentia Beta';
  betaBtn.classList.toggle('active', betaMode);
  if (capturing) {
    chrome.runtime.sendMessage({ type: 'setMode', mode: betaMode ? 'essentia' : 'hpcp' });
  }
});

startBtn.addEventListener('click', () => {
  if (capturing) {
    startBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'stopCapture' }, () => {
      resetUI();
    });
    return;
  }

  startBtn.textContent = 'Starting...';
  startBtn.disabled = true;

  chrome.runtime.sendMessage({ type: 'startCapture', mode: betaMode ? 'essentia' : 'hpcp' }, (res) => {
    if (chrome.runtime.lastError || res?.error) {
      console.error('capture failed:', res?.error || chrome.runtime.lastError?.message);
      resetUI();
      return;
    }
    setListening(betaMode ? 'essentia' : 'hpcp');
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'keyResult') return;
  applyResult(msg);
});
