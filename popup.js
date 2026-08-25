const startBtn       = document.getElementById('startBtn');
const betaBtn        = document.getElementById('betaBtn');
const settingsBtn    = document.getElementById('settingsBtn');
const settingsPanel  = document.getElementById('settingsPanel');
const optEnglish     = document.getElementById('optEnglish');
const optSolfege     = document.getElementById('optSolfege');
const toggleRelative = document.getElementById('toggleRelative');
const toggleCamelot  = document.getElementById('toggleCamelot');
const keyRootEl      = document.getElementById('keyRoot');
const keyQualityEl   = document.getElementById('keyQuality');
const confidenceEl   = document.getElementById('confidence');
const keyMetaEl      = document.getElementById('keyMeta');
const scaleNotesEl   = document.getElementById('scaleNotes');

let capturing  = false;
let betaMode   = false;
let lastResult = null;

// --- Settings ---
let settings = { noteStyle: 'english', showRelative: false, showCamelot: false };

function saveSettings() {
  chrome.storage.local.set({ pitchhub_settings: settings });
}

function syncSettingsUI() {
  optEnglish.classList.toggle('active', settings.noteStyle === 'english');
  optSolfege.classList.toggle('active', settings.noteStyle === 'solfege');
  toggleRelative.checked = settings.showRelative;
  toggleCamelot.checked  = settings.showCamelot;
}

// --- Note name tables ---
const NOTE_MAJOR    = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const NOTE_MINOR    = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const SOLFEGE_MAJOR = ['Do','Re♭','Re','Mi♭','Mi','Fa','Fa#','Sol','La♭','La','Si♭','Si'];
const SOLFEGE_MINOR = ['Do','Do#','Re','Mi♭','Mi','Fa','Fa#','Sol','La♭','La','Si♭','Si'];

const ENGLISH_TO_SOLFEGE = {
  'C':'Do','C#':'Do#','Db':'Re♭','D':'Re','D#':'Re#','Eb':'Mi♭',
  'E':'Mi','F':'Fa','F#':'Fa#','Gb':'Sol♭','G':'Sol','G#':'Sol#',
  'Ab':'La♭','A':'La','A#':'La#','Bb':'Si♭','B':'Si'
};

// Camelot wheel (index = pitch class, 0=C)
const CAMELOT_MAJOR = ['8B','3B','10B','5B','12B','7B','2B','9B','4B','11B','6B','1B'];
const CAMELOT_MINOR = ['5A','12A','7A','2A','9A','4A','11A','6A','1A','8A','3A','10A'];

function getNoteName(root, scale) {
  if (settings.noteStyle === 'solfege') {
    return scale === 'major' ? SOLFEGE_MAJOR[root] : SOLFEGE_MINOR[root];
  }
  return scale === 'major' ? NOTE_MAJOR[root] : NOTE_MINOR[root];
}

function translateChord(chord) {
  if (settings.noteStyle !== 'solfege') return chord;
  return chord.replace(/^([A-G][#b]?)/, m => ENGLISH_TO_SOLFEGE[m] || m);
}

function getRelativeKey(root, scale) {
  if (scale === 'major') {
    return `${getNoteName((root + 9) % 12, 'minor')} Minor`;
  }
  return `${getNoteName((root + 3) % 12, 'major')} Major`;
}

// --- Rendering ---
function renderResult(result) {
  if (!result) return;

  keyRootEl.textContent    = getNoteName(result.root, result.scale);
  keyQualityEl.textContent = result.scale === 'major' ? 'Major' : 'Minor';

  confidenceEl.className   = `confidence ${result.confidence}`;
  confidenceEl.textContent = result.confidence === 'low'    ? 'early guess — still listening'
                           : result.confidence === 'medium' ? 'getting confident...'
                           : 'confident';

  const metaParts = [];
  if (settings.showRelative) {
    metaParts.push(`<span class="key-tag">Relative: ${getRelativeKey(result.root, result.scale)}</span>`);
  }
  if (settings.showCamelot) {
    const camelot = result.scale === 'major' ? CAMELOT_MAJOR[result.root] : CAMELOT_MINOR[result.root];
    metaParts.push(`<span class="key-tag">Camelot: ${camelot}</span>`);
  }
  keyMetaEl.innerHTML = metaParts.join('');

  scaleNotesEl.innerHTML = (result.chords || [])
    .map(c => `<span class="note-pill">${translateChord(c)}</span>`)
    .join('');
}

function applyResult(msg) {
  let root  = msg.root;
  let scale = msg.scale;

  if (root === undefined && msg.name) {
    const parts = msg.name.split(' ');
    const idx = NOTE_MAJOR.indexOf(parts[0]) !== -1
      ? NOTE_MAJOR.indexOf(parts[0])
      : NOTE_MINOR.indexOf(parts[0]);
    root  = idx >= 0 ? idx : 0;
    scale = parts[1]?.toLowerCase() === 'minor' ? 'minor' : 'major';
  }

  lastResult = { root, scale, chords: msg.chords, confidence: msg.confidence };
  renderResult(lastResult);
}

// --- UI state helpers ---
function setListening(mode) {
  capturing = true;
  betaMode  = mode === 'essentia';
  startBtn.textContent = 'Stop';
  startBtn.disabled    = false;
  startBtn.classList.add('listening');
  betaBtn.textContent = betaMode ? 'Using Essentia Beta' : 'Try Essentia Beta';
  betaBtn.classList.toggle('active', betaMode);
  if (!betaMode) {
    keyQualityEl.textContent = 'analyzing...';
    confidenceEl.textContent = 'result in ~30s';
    confidenceEl.className   = 'confidence';
  }
}

function resetUI() {
  capturing  = false;
  lastResult = null;
  startBtn.textContent = 'Start Detection';
  startBtn.disabled    = false;
  startBtn.classList.remove('listening');
  keyRootEl.textContent    = '--';
  keyQualityEl.textContent = '';
  confidenceEl.textContent = '';
  confidenceEl.className   = 'confidence';
  keyMetaEl.innerHTML      = '';
  scaleNotesEl.innerHTML   = '';
}

// --- Settings panel events ---
settingsBtn.addEventListener('click', () => {
  const open = settingsPanel.classList.toggle('open');
  settingsBtn.classList.toggle('active', open);
});

optEnglish.addEventListener('click', () => {
  settings.noteStyle = 'english';
  syncSettingsUI();
  saveSettings();
  renderResult(lastResult);
});

optSolfege.addEventListener('click', () => {
  settings.noteStyle = 'solfege';
  syncSettingsUI();
  saveSettings();
  renderResult(lastResult);
});

toggleRelative.addEventListener('change', () => {
  settings.showRelative = toggleRelative.checked;
  saveSettings();
  renderResult(lastResult);
});

toggleCamelot.addEventListener('change', () => {
  settings.showCamelot = toggleCamelot.checked;
  saveSettings();
  renderResult(lastResult);
});

// --- Extension messaging ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'keyResult') applyResult(msg);
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
    chrome.runtime.sendMessage({ type: 'stopCapture' }, () => resetUI());
    return;
  }

  startBtn.textContent = 'Starting...';
  startBtn.disabled    = true;

  chrome.runtime.sendMessage({ type: 'startCapture', mode: betaMode ? 'essentia' : 'hpcp' }, (res) => {
    if (chrome.runtime.lastError || res?.error) {
      console.error('capture failed:', res?.error || chrome.runtime.lastError?.message);
      resetUI();
      return;
    }
    setListening(betaMode ? 'essentia' : 'hpcp');
  });
});

// --- Boot: load settings first, then query active capture state ---
chrome.storage.local.get('pitchhub_settings', (data) => {
  if (data.pitchhub_settings) Object.assign(settings, data.pitchhub_settings);
  syncSettingsUI();

  chrome.runtime.sendMessage({ type: 'getState' }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state?.active) {
      setListening(state.mode);
      if (state.lastResult) applyResult(state.lastResult);
    }
  });
});
