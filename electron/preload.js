// Preload shared by the overlay and Settings windows: a narrow IPC bridge exposed as window.hand
// (contextIsolation on, no Node in the page). See CONTRACT.md section 3.
const { contextBridge, ipcRenderer } = require('electron');

const INTENTS = new Set(['move', 'down', 'up', 'click', 'scroll', 'togglePause', 'release', 'action', 'grab']);

// Subscribe helper; returns an unsubscribe function.
const on = (channel) => (cb) => {
  if (typeof cb !== 'function') return () => {};
  const h = (_e, data) => { try { cb(data); } catch (err) { console.error(err); } };
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('hand', {
  // Settings + overlay
  getConfig: () => ipcRenderer.invoke('hand:getConfig'),
  setConfig: (cfg) => ipcRenderer.invoke('hand:setConfig', cfg),
  resetConfig: () => ipcRenderer.invoke('hand:resetConfig'),
  onConfig: on('hand:config'),
  testAction: (action) => ipcRenderer.invoke('hand:testAction', action),
  onTelemetry: on('hand:telemetry'),
  setEnabled: (v) => ipcRenderer.invoke('hand:setEnabled', !!v),
  setPaused: (v) => ipcRenderer.invoke('hand:setPaused', !!v),
  getPoses: () => ipcRenderer.invoke('hand:getPoses'),
  getState: () => ipcRenderer.invoke('hand:getState'), // { enabled, paused, mouseOk, mouseBackend, settingsOpen, glass, ... }
  onState: on('hand:state'),

  // Overlay only (main ignores these from other windows)
  send(msg) {
    if (msg && INTENTS.has(msg.type)) ipcRenderer.send('hand:intent', msg);
  },
  telemetry(t) { ipcRenderer.send('hand:telemetry', t); },
});
