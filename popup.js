const startBtn = document.getElementById('startBtn');
const betaBtn = document.getElementById('betaBtn');
const keyRootEl = document.getElementById('keyRoot');
const keyQualityEl = document.getElementById('keyQuality');
const confidenceEl = document.getElementById('confidence');
const scaleNotesEl = document.getElementById('scaleNotes');
const identifyBtn = document.getElementById('identifyBtn');
const settingsBtn = document.getElementById('settingsBtn');
const identifyResultEl = document.getElementById('identifyResult');
const settingsPanel = document.getElementById('settingsPanel');
const saveCredBtn = document.getElementById('saveCredBtn');

// Spotify: key 0-11 = pitch class, mode 1=major 0=minor
const PITCH_MAJOR = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const PITCH_MINOR = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

const KEY_INFO = [
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

// --- identify ---

function setIdentifyResult(html) {
  identifyResultEl.innerHTML = html;
  identifyResultEl.style.display = html ? 'block' : 'none';
}

identifyBtn.addEventListener('click', () => {
  identifyBtn.textContent = 'Recording...';
  identifyBtn.disabled = true;
  setIdentifyResult('');

  console.log('[popup] sending startIdentify');
  chrome.runtime.sendMessage({ type: 'startIdentify' }, (res) => {
    console.log('[popup] startIdentify response:', res, chrome.runtime.lastError);
    if (chrome.runtime.lastError || res?.error) {
      identifyBtn.textContent = 'Identify Song';
      identifyBtn.disabled = false;
      if (res?.error === 'no_credentials') {
        settingsPanel.classList.add('open');
        setIdentifyResult('<span class="identify-info">Enter your API keys below to use this feature.</span>');
      }
      return;
    }
    identifyBtn.textContent = 'Analyzing...';
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'keyResult') {
    applyResult(msg);
    return;
  }

  if (msg.type !== 'identifyResult') return;

  identifyBtn.textContent = 'Identify Song';
  identifyBtn.disabled = false;

  if (msg.error) {
    setIdentifyResult(`<span class="identify-info">${msg.error}</span>`);
    return;
  }

  if (msg.noMatch) {
    setIdentifyResult('<span class="identify-info">Song not recognized</span>');
    return;
  }

  let keyHtml = '';
  if (msg.keyResult) {
    const notes = msg.keyResult.mode === 1 ? PITCH_MAJOR : PITCH_MINOR;
    const scale = msg.keyResult.mode === 1 ? 'Major' : 'Minor';
    const keyName = `${notes[msg.keyResult.key]} ${scale}`;
    const info = KEY_INFO.find(k => k.name === keyName);
    const pills = info ? info.chords.map(c => `<span class="note-pill">${c}</span>`).join('') : '';
    keyHtml = `<div class="identify-key">${keyName}</div>${pills ? `<div class="scale-notes" style="margin-top:6px">${pills}</div>` : ''}`;
  }

  const byLine = msg.artist ? `<div class="identify-artist">${msg.artist}</div>` : '';
  setIdentifyResult(`<div class="identify-title">${msg.title}</div>${byLine}${keyHtml}`);
});

// --- settings ---

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});

function saveCredentials() {
  chrome.storage.local.set({
    acrHost: document.getElementById('acrHost').value.trim(),
    acrKey: document.getElementById('acrKey').value.trim(),
    acrSecret: document.getElementById('acrSecret').value.trim(),
    spotifyId: document.getElementById('spotifyId').value.trim(),
    spotifySecret: document.getElementById('spotifySecret').value.trim(),
  });
}

// auto-save on every keystroke so nothing is lost when popup closes
['acrHost','acrKey','acrSecret','spotifyId','spotifySecret'].forEach(id => {
  document.getElementById(id).addEventListener('input', saveCredentials);
});

saveCredBtn.addEventListener('click', () => {
  saveCredentials();
  settingsPanel.classList.remove('open');
});

// pre-fill saved credentials
chrome.storage.local.get(['acrHost','acrKey','acrSecret','spotifyId','spotifySecret'], (data) => {
  if (data.acrHost) document.getElementById('acrHost').value = data.acrHost;
  if (data.acrKey) document.getElementById('acrKey').value = data.acrKey;
  if (data.acrSecret) document.getElementById('acrSecret').value = data.acrSecret;
  if (data.spotifyId) document.getElementById('spotifyId').value = data.spotifyId;
  if (data.spotifySecret) document.getElementById('spotifySecret').value = data.spotifySecret;
});

// --- start/stop ---

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
