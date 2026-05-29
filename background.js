// this took forever to figure out — tabCapture needs to be called from a user gesture
// which originates in the popup, but the actual getMediaStreamId call works fine here
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'startCapture') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        sendResponse({ error: 'no active tab found' });
        return;
      }

      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ streamId, tabId: tab.id });
      });
    });

    return true; // keeps the message channel open for the async response
  }

  if (msg.type === 'stopCapture') {
    sendResponse({ ok: true });
  }
});
