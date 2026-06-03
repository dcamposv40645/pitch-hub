let captureState = {
  active: false,
  mode: 'hpcp',
  lastResult: null
};

let identifyPending = false;
let pendingRecordParams = null;

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
    captureState.lastResult = { name: msg.name, chords: msg.chords, confidence: msg.confidence };
  }

  if (msg.type === 'startIdentify') {
    if (identifyPending) {
      sendResponse({ error: 'already_running' });
      return;
    }
    identifyPending = true;
    startIdentify(sendResponse);
    return true;
  }

  if (msg.type === 'audioSample') {
    identifyPending = false;
    handleAudioSample(msg);
  }

  if (msg.type === 'offscreenReady') {
    if (pendingRecordParams) {
      console.log('[identify] offscreen ready, sending recordSample');
      chrome.runtime.sendMessage({ type: 'recordSample', ...pendingRecordParams });
      pendingRecordParams = null;
    }
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

async function startIdentify(sendResponse) {
  const creds = await chrome.storage.local.get(['acrHost', 'acrKey', 'acrSecret', 'spotifyId', 'spotifySecret']);

  if (!creds.acrKey || !creds.acrSecret || !creds.acrHost) {
    identifyPending = false;
    sendResponse({ error: 'no_credentials' });
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) { identifyPending = false; sendResponse({ error: 'No active tab' }); return; }

  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
    if (chrome.runtime.lastError) {
      identifyPending = false;
      sendResponse({ error: chrome.runtime.lastError.message });
      return;
    }
    try {
      const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      pendingRecordParams = { streamId, duration: 10000 };

      if (existing.length === 0) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['USER_MEDIA', 'IFRAME_SCRIPTING'],
          justification: 'record tab audio for song identification'
        });
        // offscreen signals ready before we send the task — sidesteps the sendMessage race on fresh docs
      } else {
        chrome.runtime.sendMessage({ type: 'recordSample', ...pendingRecordParams });
        pendingRecordParams = null;
      }
      sendResponse({ ok: true });
    } catch (err) {
      identifyPending = false;
      sendResponse({ error: err.message });
    }
  });
}

async function handleAudioSample({ dataUrl, error }) {
  if (error) {
    chrome.runtime.sendMessage({ type: 'identifyResult', error });
    return;
  }

  // read creds fresh — module state doesn't survive SW restarts
  const creds = await chrome.storage.local.get(['acrHost', 'acrKey', 'acrSecret', 'spotifyId', 'spotifySecret']);

  try {
    const [header, base64] = dataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });

    const result = await callACRCloud(blob, creds);

    const code = result?.status?.code;
    if (code === undefined) {
      chrome.runtime.sendMessage({ type: 'identifyResult', error: 'No response from ACRCloud' });
      return;
    }
    if (code === 1001) {
      chrome.runtime.sendMessage({ type: 'identifyResult', noMatch: true });
      return;
    }
    if (code !== 0) {
      chrome.runtime.sendMessage({ type: 'identifyResult', error: `ACRCloud error ${code}: ${result.status.msg}` });
      return;
    }

    const music = result?.metadata?.music;
    if (!music?.length) {
      chrome.runtime.sendMessage({ type: 'identifyResult', noMatch: true });
      return;
    }

    const track = music[0];
    const title = track.title;
    const artist = track.artists?.[0]?.name;
    const spotifyTrackId = track.external_metadata?.spotify?.track?.id;

    let keyResult = null;
    if (spotifyTrackId && creds.spotifyId && creds.spotifySecret) {
      try {
        const token = await getSpotifyToken(creds.spotifyId, creds.spotifySecret);
        const features = await getAudioFeatures(spotifyTrackId, token);
        if (features.key !== undefined && features.key !== -1) {
          keyResult = { key: features.key, mode: features.mode };
        }
      } catch (_) {}
    }

    chrome.runtime.sendMessage({ type: 'identifyResult', title, artist, keyResult });
  } catch (err) {
    console.error('[identify] error:', err);
    chrome.runtime.sendMessage({ type: 'identifyResult', error: err.message });
  }
}

async function callACRCloud(blob, creds) {
  const timestamp = Math.floor(Date.now() / 1000);
  const stringToSign = `POST\n/v1/identify\n${creds.acrKey}\naudio\n1\n${timestamp}`;
  const signature = await hmacSHA1(creds.acrSecret, stringToSign);
  console.log('[identify] signature preview:', signature.substring(0, 12) + '...');

  const form = new FormData();
  form.append('sample', blob, 'sample.webm');
  form.append('access_key', creds.acrKey);
  form.append('data_type', 'audio');
  form.append('signature_version', '1');
  form.append('signature', signature);
  form.append('sample_bytes', String(blob.size));
  form.append('timestamp', String(timestamp));

  const res = await fetch(`https://${creds.acrHost}/v1/identify`, { method: 'POST', body: form });
  return res.json();
}

async function hmacSHA1(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function getSpotifyToken(clientId, clientSecret) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return data.access_token;
}

async function getAudioFeatures(trackId, token) {
  const res = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.json();
}
