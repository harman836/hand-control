// Electron main process: tray app that runs a transparent click-through overlay (hand tracker +
// gesture engine) and turns its intents into real input; plus a Settings window for bindings.
const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, session, protocol, ipcMain, nativeImage, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('./config');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(__dirname, 'icon.png');
const DEBUG = !!process.env.HAND_DEBUG;

// ---------- Input backends (mouse: nut-js -> user32; keyboard/windows: user32 via koffi) ----------
const { loadInput } = require('./input');
const { mouse, mouseError, win32, win32Error } = loadInput();
if (!mouse) console.error('[hand] no mouse backend:', mouseError);
if (!win32) console.error('[hand] user32 unavailable (keys, media, window moving disabled):', win32Error);

// ---------- Custom app:// scheme (secure origin for getUserMedia, ES modules, CSP header) ----------
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
  "worker-src 'self' blob: https://cdn.jsdelivr.net",
  "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com data: blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.task': 'application/octet-stream',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp',
};

function registerAppProtocol() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'settings.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.promises.readFile(file); // asar-aware
      return new Response(body, {
        headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-security-policy': CSP },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- State ----------
let tray = null, overlayWin = null, settingsWin = null;
let cfg = config.defaults();
let CONFIG_FILE = null;
let enabled = false;   // desktop control on/off (always off at launch)
let paused = true;     // paused within control (always paused when turned on)
let buttonDown = false;
let grab = null;       // { hwnd, x0, y0, c0 } while a moveWindow binding is engaged
let lastAction = null; // { name, at }
let quitting = false;

const live = (w) => w && !w.isDestroyed();
const backendName = () => (mouse ? mouse.name : 'none');

// ---------- Mouse action queue (serialised; moves coalesced to the latest one) ----------
const ops = [];
let pendingMove = null, busy = false;

function flushMove() {
  if (pendingMove) { const p = pendingMove; pendingMove = null; ops.push(() => mouse.move(p.x, p.y)); }
}
function enqueue(fn) { flushMove(); ops.push(fn); pump(); }
async function pump() {
  if (busy || !mouse) return;
  busy = true;
  try {
    while (ops.length || pendingMove) {
      if (!ops.length) flushMove();
      const fn = ops.shift();
      try { await fn(); } catch (e) { console.error('[hand] input op failed:', e && e.message); }
    }
  } finally { busy = false; }
}

// ---------- Coordinates ----------
// Normalised (0..1 of primary display) -> physical screen px (accounts for Windows display scaling).
function toPhysical(u, v) {
  const b = screen.getPrimaryDisplay().bounds; // DIP
  const dip = { x: b.x + Math.min(Math.max(u, 0), 1) * (b.width - 1), y: b.y + Math.min(Math.max(v, 0), 1) * (b.height - 1) };
  const p = process.platform === 'win32' ? screen.dipToScreenPoint(dip) : dip;
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
// Physical size of the primary display (for converting normalised hand deltas).
function physicalSize() {
  const d = screen.getPrimaryDisplay();
  const s = process.platform === 'win32' ? d.scaleFactor : 1;
  return { w: d.bounds.width * s, h: d.bounds.height * s };
}

// ---------- Releasing held state (safety) ----------
function releaseButton() {
  if (!buttonDown || !mouse) return;
  buttonDown = false;
  enqueue(() => mouse.up());
}
function endGrab() { grab = null; }
function releaseAll() { pendingMove = null; releaseButton(); endGrab(); }

// ---------- Window moving ----------
function ownHwnds() {
  const out = [];
  for (const w of [overlayWin, settingsWin]) {
    if (!live(w)) continue;
    const b = w.getNativeWindowHandle();
    out.push(b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0));
  }
  return out;
}

function startGrab() {
  if (!win32) return;
  endGrab();
  const c = win32.cursor();
  const w = win32.topWindowAt(c, ownHwnds());
  if (!w || !w.rect) { grab = { hwnd: 0 }; return; } // nothing grabbable: engaged but inert
  let r = w.rect;
  if (w.maximized) {
    // Restore, then keep the grab point at the same proportional spot of the (smaller) window.
    const fx = (c.x - r.left) / Math.max(1, r.right - r.left);
    const fy = Math.min(0.5, (c.y - r.top) / Math.max(1, r.bottom - r.top));
    const nr = win32.restore(w.hwnd) || r;
    const nw = nr.right - nr.left, nh = nr.bottom - nr.top;
    r = { left: Math.round(c.x - fx * nw), top: Math.round(c.y - fy * nh) };
    win32.moveWindowTo(w.hwnd, r.left, r.top);
  }
  win32.bringToFront(w.hwnd);
  grab = { hwnd: w.hwnd, x0: r.left, y0: r.top, c0: c };
  if (DEBUG) console.log(`[hand] grabbed window ${w.hwnd} "${w.title}" (${w.cls})`);
}

function moveGrab(du, dv) {
  if (!grab || !grab.hwnd || !win32 || !Number.isFinite(du) || !Number.isFinite(dv)) return;
  const s = physicalSize();
  const dx = Math.round(du * s.w), dy = Math.round(dv * s.h);
  win32.moveWindowTo(grab.hwnd, grab.x0 + dx, grab.y0 + dy);
  win32.setCursor(grab.c0.x + dx, grab.c0.y + dy); // cursor travels with the window
}

// ---------- Actions ----------
function launch(target) {
  if (!target) throw new Error('no launch target set');
  // A URI scheme is 2+ chars before ':' (so 'C:\\...' is a path). file:/javascript: go through openPath / are refused.
  const m = /^([a-z][a-z0-9+.-]+):/i.exec(target);
  if (m && !/^(javascript|vbscript|data|file)$/i.test(m[1])) return shell.openExternal(target);
  const p = m && /^file$/i.test(m[1]) ? new URL(target).pathname.replace(/^\/([a-z]:)/i, '$1') : target;
  return shell.openPath(p).then((err) => { if (err) throw new Error(err); });
}

async function runAction(action, name, { test = false } = {}) {
  const a = config.validateAction(action);
  const need = () => { if (!win32) throw new Error(`keyboard/window input unavailable: ${win32Error}`); };
  switch (a.type) {
    case 'none': break;
    case 'media': need(); win32.media(a.key); break;
    case 'keys': need(); if (!a.combo) throw new Error('invalid or empty key combo'); win32.keys(a.combo); break;
    case 'mouse': need(); win32.button(a.button); break;
    case 'launch': await launch(a.target); break;
    case 'togglePause': setPaused(!paused); break;
    case 'scroll':
      if (!test) throw new Error('scroll is continuous');
      need(); win32.wheel(Math.max(1, Math.round(3 * a.speed))); break;
    case 'moveWindow': throw new Error('moveWindow is continuous: try it with the gesture');
    default: throw new Error(`unknown action ${a.type}`);
  }
  lastAction = { name: name || a.type, at: Date.now() };
  if (DEBUG) console.log(`[hand] action "${lastAction.name}" (${a.type})${test ? ' [test]' : ''}`);
}

// ---------- IPC ----------
const fromOverlay = (e) => live(overlayWin) && e.sender === overlayWin.webContents;
const fromApp = (e) => { try { return new URL(e.senderFrame.url).protocol === 'app:'; } catch { return false; } };

ipcMain.on('hand:intent', (e, msg) => {
  if (!fromOverlay(e) || !msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'release': releaseAll(); return;
    case 'togglePause':
      if (enabled) { setPaused(!paused); lastAction = { name: typeof msg.name === 'string' ? msg.name.slice(0, 60) : 'Pause / resume', at: Date.now() }; }
      return;
  }
  if (!enabled || paused) return;
  switch (msg.type) {
    case 'move':
      if (mouse && !grab && Number.isFinite(msg.u) && Number.isFinite(msg.v)) { pendingMove = toPhysical(msg.u, msg.v); pump(); }
      break;
    case 'down':
      if (mouse && !buttonDown) { buttonDown = true; enqueue(() => mouse.down()); }
      break;
    case 'up': releaseButton(); break;
    case 'click': if (mouse && !buttonDown) enqueue(() => mouse.click()); break;
    case 'scroll': {
      const n = Math.max(-10, Math.min(10, Math.trunc(msg.ticks) || 0));
      if (n && mouse) enqueue(() => mouse.scroll(n));
      break;
    }
    case 'action': {
      const b = cfg.bindings.find((x) => x.id === msg.id && x.enabled);
      if (!b || config.isContinuous(b.action)) return;
      if (b.action.type === 'togglePause') { setPaused(!paused); lastAction = { name: b.name, at: Date.now() }; return; }
      runAction(b.action, b.name).catch((err) => console.warn(`[hand] action "${b.name}" failed:`, err.message));
      break;
    }
    case 'grab':
      if (msg.phase === 'start') { pendingMove = null; releaseButton(); startGrab(); lastAction = { name: msg.name || 'Move window', at: Date.now() }; }
      else if (msg.phase === 'move') moveGrab(msg.du, msg.dv);
      else endGrab();
      break;
  }
});

ipcMain.on('hand:telemetry', (e, t) => {
  if (!fromOverlay(e) || !live(settingsWin) || !t || typeof t !== 'object') return;
  settingsWin.webContents.send('hand:telemetry', { ...t, enabled, paused, lastAction, mouseBackend: backendName() });
});

ipcMain.handle('hand:getConfig', (e) => (fromApp(e) ? cfg : null));
ipcMain.handle('hand:setConfig', (e, next) => {
  if (!fromApp(e)) return;
  cfg = config.validate(next);
  try { config.save(CONFIG_FILE, cfg); } catch (err) { console.error('[hand] could not save config:', err.message); }
  broadcastConfig();
});
ipcMain.handle('hand:resetConfig', (e) => {
  if (!fromApp(e)) return null;
  cfg = config.defaults();
  try { config.save(CONFIG_FILE, cfg); } catch (err) { console.error('[hand] could not save config:', err.message); }
  broadcastConfig();
  return cfg;
});
ipcMain.handle('hand:testAction', async (e, action) => {
  if (!fromApp(e)) return { ok: false, error: 'forbidden' };
  try { await runAction(action, `Test: ${(action && action.type) || 'action'}`, { test: true }); return { ok: true }; }
  catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});
ipcMain.handle('hand:setEnabled', (e, v) => { if (fromApp(e)) setEnabled(!!v); });
ipcMain.handle('hand:setPaused', (e, v) => { if (fromApp(e)) setPaused(!!v); });
ipcMain.handle('hand:getPoses', () => config.POSES);
ipcMain.handle('hand:getState', (e) => (fromApp(e) ? stateMsg() : null));

function stateMsg() {
  return {
    enabled, paused, mouseOk: !!mouse, mouseError, mouseBackend: backendName(),
    win32Ok: !!win32, settingsOpen: live(settingsWin), glass: glassSupported(),
  };
}

function broadcast(channel, payload) {
  for (const w of [overlayWin, settingsWin]) if (live(w)) w.webContents.send(channel, payload);
}
function broadcastConfig() { broadcast('hand:config', cfg); }
function sendState() { broadcast('hand:state', stateMsg()); updateTray(); }

function setPaused(p) {
  if (p === paused) return sendState();
  paused = p;
  if (paused) releaseAll();
  console.log('[hand] control', !enabled ? 'off' : paused ? 'paused' : 'ACTIVE');
  sendState();
}

function setEnabled(on) {
  if (on === enabled) return sendState();
  enabled = on;
  paused = true; // turning control on always starts paused; turning off pauses too
  releaseAll();
  console.log('[hand] desktop control', enabled ? 'on (paused)' : 'off');
  sendState();
}

// ---------- Windows ----------
function logConsole(win, tag) {
  win.webContents.on('console-message', (e) => {
    const level = e.level ?? 'info';
    if (level === 'warning' || level === 'error' || level === 2 || level === 3 || DEBUG) {
      console.log(`[${tag}:${level}] ${e.message}`);
    }
  });
}

// Windows 11 22H2+ (build 22621) supports backgroundMaterial.
function glassSupported() {
  if (process.platform !== 'win32') return false;
  const build = Number(os.release().split('.')[2] || 0);
  return build >= 22621;
}

function openSettings() {
  if (live(settingsWin)) { if (settingsWin.isMinimized()) settingsWin.restore(); settingsWin.show(); settingsWin.focus(); return; }
  const glass = glassSupported();
  const opts = {
    width: 1000, height: 720, minWidth: 760, minHeight: 520, icon: ICON, title: 'Hand Control Settings',
    autoHideMenuBar: true, show: false,
    backgroundColor: glass ? '#00000000' : '#eef1f8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  };
  if (glass) opts.backgroundMaterial = 'acrylic';
  try { settingsWin = new BrowserWindow(opts); }
  catch (e) { // older Electron / OS: plain opaque window
    console.warn('[hand] acrylic window failed, using opaque:', e.message);
    delete opts.backgroundMaterial; opts.backgroundColor = '#eef1f8';
    settingsWin = new BrowserWindow(opts);
  }
  logConsole(settingsWin, 'settings');
  settingsWin.loadURL(`app://local/settings.html${glass ? '?glass=1' : ''}`);
  settingsWin.once('ready-to-show', () => live(settingsWin) && settingsWin.show());
  settingsWin.webContents.on('did-finish-load', sendState);
  settingsWin.webContents.on('render-process-gone', (_e, d) => console.error(`[settings] renderer gone: ${d.reason}`));
  settingsWin.on('closed', () => { settingsWin = null; sendState(); });
  sendState();
}

function createOverlay() {
  if (live(overlayWin)) return;
  const { bounds } = screen.getPrimaryDisplay();
  overlayWin = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false, icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, // keep rAF / tracking running while unfocused
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setBounds(bounds);
  logConsole(overlayWin, 'overlay');
  overlayWin.loadURL('app://local/overlay.html');
  overlayWin.once('ready-to-show', () => live(overlayWin) && overlayWin.showInactive());
  overlayWin.webContents.on('did-finish-load', () => { sendState(); broadcastConfig(); });
  overlayWin.webContents.on('render-process-gone', (_e, d) => {
    console.error(`[overlay] renderer gone: ${d.reason}`);
    releaseAll();
    if (!quitting) setTimeout(() => live(overlayWin) && overlayWin.reload(), 1000);
  });
  overlayWin.on('closed', () => { overlayWin = null; releaseAll(); if (!quitting) setTimeout(createOverlay, 500); });
}

function fitOverlay() {
  if (live(overlayWin)) overlayWin.setBounds(screen.getPrimaryDisplay().bounds);
}

// ---------- Tray ----------
function updateTray() {
  if (!tray) return;
  tray.setToolTip(`Hand Control: ${!enabled ? 'off' : paused ? 'paused' : 'ACTIVE'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Settings', click: openSettings },
    { type: 'separator' },
    { label: 'Desktop control\tCtrl+Alt+H', type: 'checkbox', checked: enabled, click: () => setEnabled(!enabled) },
    { label: 'Pause\tCtrl+Alt+P', type: 'checkbox', checked: paused, enabled, click: () => setPaused(!paused) },
    { type: 'separator' },
    { label: mouse ? `Mouse backend: ${mouse.name}` : 'Mouse control: unavailable', enabled: false },
    { type: 'separator' },
    { label: 'Quit\tCtrl+Alt+Q', click: () => app.quit() },
  ]));
}

// ---------- App lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openSettings);

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'system';
    registerAppProtocol();

    CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
    cfg = config.load(CONFIG_FILE);
    try { if (!fs.existsSync(CONFIG_FILE)) config.save(CONFIG_FILE, cfg); } catch (e) { console.warn('[hand] config save failed:', e.message); }

    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      cb(permission === 'media' && (!details.mediaTypes || details.mediaTypes.every((t) => t === 'video')));
    });
    ses.setPermissionCheckHandler((wc, permission) => permission === 'media');

    const img = nativeImage.createFromPath(ICON);
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
    tray.on('double-click', openSettings);
    updateTray();

    const reg = (acc, fn) => { if (!globalShortcut.register(acc, fn)) console.warn(`[hand] could not register ${acc} (in use by another app?)`); };
    reg('CommandOrControl+Alt+H', () => setEnabled(!enabled));
    reg('CommandOrControl+Alt+P', () => { if (enabled) setPaused(!paused); });
    reg('CommandOrControl+Alt+Q', () => app.quit());

    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', fitOverlay);
    screen.on('display-removed', fitOverlay);

    console.log(`[hand] ready. mouse: ${mouse ? mouse.name : 'NONE - ' + mouseError}; keys/windows: ${win32 ? 'user32' : 'NONE - ' + win32Error}; config: ${CONFIG_FILE}`);
    createOverlay(); // tracker always runs; input only flows when enabled and not paused
    if (process.argv.includes('--control')) setEnabled(true); // dev: start with control on (paused)
    if (!process.argv.includes('--tray')) openSettings();
  });

  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    grab = null;
    if (buttonDown && mouse) { try { mouse.up(); } catch { /* ignore */ } }
  });
}
