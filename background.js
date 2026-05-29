chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'startCapture') {
    startCapture(sendResponse);
    return true; // keeps the message channel open for the async response
  }
});

async function startCapture(sendResponse) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) {
    sendResponse({ error: 'no active tab' });
    return;
  }

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
          reasons: ['USER_MEDIA'],
          justification: 'process tab audio stream for pitch detection'
        });
      }

      // not sure why this needs a delay but it breaks without it
      await new Promise(r => setTimeout(r, 50));
      chrome.runtime.sendMessage({ type: 'initAudio', streamId });
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });
}
