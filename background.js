let captureState = {
  active: false,
  mode: 'hpcp',
  lastResult: null
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'startCapture') {
    startCapture(msg.mode || 'hpcp', sendResponse);
    return true;
  }

  if (msg.type === 'stopCapture') {
    captureState.active = false;
    captureState.lastResult = null;
    chrome.offscreen.closeDocument()
      .catch(() => {})
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'getState') {
    chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then(ctxs => {
      if (ctxs.length === 0) captureState.active = false;
      sendResponse({ ...captureState });
    });
    return true;
  }

  if (msg.type === 'keyResult') {
    captureState.lastResult = { name: msg.name, root: msg.root, scale: msg.scale, chords: msg.chords, confidence: msg.confidence };
  }
});

async function startCapture(mode, sendResponse) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) { sendResponse({ error: 'no active tab' }); return; }

  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message });
      return;
    }
    try {
      const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (existing.length === 0) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['USER_MEDIA', 'IFRAME_SCRIPTING'],
          justification: 'process tab audio stream for pitch detection'
        });
      }
      await new Promise(r => setTimeout(r, 50));
      captureState.active = true;
      captureState.mode = mode;
      chrome.runtime.sendMessage({ type: 'initAudio', streamId, mode });
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });
}
