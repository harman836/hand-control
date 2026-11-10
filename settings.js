// settings.js — HandControl Settings window (codes against CONTRACT.md §1–§3).
// Talks to the main process only through window.hand. If that is missing (plain browser),
// an in-page mock is installed so the page is fully usable for development.

// ---------- poses (§1) ----------
const FALLBACK_POSES = [
  { id: 'open',  label: 'Open palm',  fingers: { thumb: true,  index: true,  middle: true,  ring: true,  pinky: true } },
  { id: 'fist',  label: 'Fist',       fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false } },
  { id: 'point', label: 'Point',      fingers: { thumb: false, index: true,  middle: false, ring: false, pinky: false } },
  { id: 'two',   label: 'Two (V)',    fingers: { thumb: false, index: true,  middle: true,  ring: false, pinky: false } },
  { id: 'three', label: 'Three',      fingers: { thumb: false, index: true,  middle: true,  ring: true,  pinky: false } },
  { id: 'thumb', label: 'Thumbs up',  fingers: { thumb: true,  index: false, middle: false, ring: false, pinky: false } },
  { id: 'rock',  label: 'Rock',       fingers: { thumb: false, index: true,  middle: false, ring: false, pinky: true } },
  { id: 'call',  label: 'Call me',    fingers: { thumb: true,  index: false, middle: false, ring: false, pinky: true } },
  { id: 'L',     label: 'L shape',    fingers: { thumb: true,  index: true,  middle: false, ring: false, pinky: false } },
  { id: 'pinky', label: 'Pinky',      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: true } },
];
const EXTRA_POSES = {
  pinch: { id: 'pinch', label: 'Pinch', fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false } },
  none:  { id: 'none',  label: 'No pose', fingers: null },
};
let POSES = FALLBACK_POSES;

async function loadPoses() {
  let list = null;
  try {
    const mod = await import('./tracking.js');
    if (Array.isArray(mod.POSES) && mod.POSES.length) list = mod.POSES;
  } catch (e) {
    console.info('[settings] tracking.js POSES unavailable, using built-in pose list.', e && e.message);
  }
  if (!list && window.hand && typeof window.hand.getPoses === 'function') {
    try { const p = await window.hand.getPoses(); if (Array.isArray(p) && p.length) list = p; } catch {}
  }
  if (!list) return;
  const fb = Object.fromEntries(FALLBACK_POSES.map((p) => [p.id, p]));
  POSES = list.filter((p) => p && p.id && p.id !== 'pinch' && p.id !== 'none').map((p) => ({
    id: p.id,
    label: p.label || (fb[p.id] && fb[p.id].label) || p.id,
    fingers: p.fingers || (fb[p.id] && fb[p.id].fingers) || {},
  }));
}
const poseById = (id) => POSES.find((p) => p.id === id) || EXTRA_POSES[id] || null;
const poseLabel = (id) => (poseById(id) || { label: id || '—' }).label;

// ---------- defaults (§2) ----------
const TUNE_BASE = { up: 1.15, down: 1.15, thumb: 0.55, frames: 3 };
const TUNE_OPEN = { up: 1.25, down: 1.15, thumb: 0.75, frames: 3, spread: 0.95 };
const TUNE_IDS = ['open', 'fist', 'point', 'two', 'three', 'thumb', 'rock', 'call', 'L', 'pinky'];
const defaultTune = (id) => ({ ...(id === 'open' ? TUNE_OPEN : TUNE_BASE) });
const defaultPoseTuning = () => Object.fromEntries(TUNE_IDS.map((id) => [id, defaultTune(id)]));
function defaultConfig() {
  const b = (id, pose, name, action, extra = {}) => ({ id, enabled: true, name, pose, hand: 'any', holdMs: 500, cooldownMs: 1000, action, ...extra });
  return {
    version: 2, enabled: false, primaryHand: 'Right', comfortBox: { w: 0.7, h: 0.6 }, cursorSmoothing: 0.5, clickMaxMs: 250,
    clickFinger: 'index', rightClickFinger: 'none', cursorAnchor: 'pinch', twoHands: false, pinchOn: 0.33, pinchOff: 0.45,
    poseTuning: defaultPoseTuning(),
    bindings: [
      b('fist-move', 'fist', 'Move window', { type: 'moveWindow' }, { holdMs: 250 }),
      b('two-play', 'two', 'Play / pause', { type: 'media', key: 'playpause' }),
      b('three-scroll', 'three', 'Scroll', { type: 'scroll', speed: 1 }),
      b('thumb-next', 'thumb', 'Next track', { type: 'media', key: 'next' }),
      b('pinky-prev', 'pinky', 'Previous track', { type: 'media', key: 'prev' }),
      b('open-pause', 'open', 'Pause control', { type: 'togglePause' }, { holdMs: 1600 }),
      b('call-desktop', 'call', 'Show desktop', { type: 'keys', combo: 'Win+D' }, { enabled: false }),
    ],
  };
}

// ---------- actions ----------
const ACTION_TYPES = [
  { id: 'media', label: 'Media' }, { id: 'keys', label: 'Keys' }, { id: 'launch', label: 'Launch' },
  { id: 'mouse', label: 'Mouse' }, { id: 'scroll', label: 'Scroll' }, { id: 'moveWindow', label: 'Move window' },
  { id: 'togglePause', label: 'Pause' }, { id: 'none', label: 'Nothing' },
];
const CONTINUOUS = new Set(['moveWindow', 'scroll']);
const MEDIA = [
  { id: 'playpause', label: 'Play/pause', path: 'M5 4l7 4-7 4zM11.5 4h1.6v8h-1.6zM14.2 4h1.6v8h-1.6z' },
  { id: 'prev', label: 'Previous', path: 'M3 4h1.6v8H3zM13 4v8L5.5 8z' },
  { id: 'next', label: 'Next', path: 'M11.4 4H13v8h-1.6zM3 4v8l7.5-4z' },
  { id: 'voldown', label: 'Vol down', path: 'M2 6h3l4-3v10l-4-3H2zM10.5 7.2h4v1.6h-4z' },
  { id: 'volup', label: 'Vol up', path: 'M2 6h3l4-3v10l-4-3H2zM11.7 5.2h1.6v2h2v1.6h-2v2h-1.6v-2h-2V7.2h2z' },
  { id: 'mute', label: 'Mute', path: 'M2 6h3l4-3v10l-4-3H2zM10.6 5.6l1.1-1.1 1.8 1.8 1.8-1.8 1.1 1.1-1.8 1.8 1.8 1.8-1.1 1.1-1.8-1.8-1.8 1.8-1.1-1.1 1.8-1.8z' },
];
const MOUSE = [{ id: 'right', label: 'Right click' }, { id: 'double', label: 'Double click' }, { id: 'middle', label: 'Middle click' }];

function defaultAction(type) {
  switch (type) {
    case 'media': return { type, key: 'playpause' };
    case 'keys': return { type, combo: 'Ctrl+C' };
    case 'launch': return { type, target: '' };
    case 'mouse': return { type, button: 'right' };
    case 'scroll': return { type, speed: 1 };
    default: return { type };
  }
}
function actionSummary(a) {
  if (!a) return 'Nothing';
  switch (a.type) {
    case 'media': return 'Media · ' + ((MEDIA.find((m) => m.id === a.key) || {}).label || a.key);
    case 'keys': return 'Keys · ' + (a.combo || '—');
    case 'launch': return a.target ? 'Launch · ' + shortTarget(a.target) : 'Launch · (not set)';
    case 'mouse': return (MOUSE.find((m) => m.id === a.button) || { label: 'Click' }).label;
    case 'scroll': return 'Scroll · ' + (+a.speed || 1).toFixed(1) + '×';
    case 'moveWindow': return 'Move window (while held)';
    case 'togglePause': return 'Toggle pause';
    default: return 'Nothing';
  }
}
function shortTarget(t) {
  const s = String(t);
  if (/^https?:\/\//i.test(s)) return s.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const parts = s.split(/[\\/]/); return parts[parts.length - 1] || s;
}

// ---------- key combos ----------
const MODS = ['Ctrl', 'Alt', 'Shift', 'Win'];
const NAMED_KEYS = ['Tab', 'Enter', 'Esc', 'Space', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Backspace', 'PrintScreen'];
const CODE_MAP = { Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Esc', Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Delete: 'Delete', Backspace: 'Backspace', PrintScreen: 'PrintScreen' };
function codeToKey(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^(?:Digit|Numpad)(\d)$/.exec(code))) return m[1];
  if ((m = /^F(\d{1,2})$/.exec(code)) && +m[1] >= 1 && +m[1] <= 24) return 'F' + m[1];
  return CODE_MAP[code] || null;
}
function normalizeKey(k) {
  const s = k.trim();
  if (/^[a-z0-9]$/i.test(s)) return s.toUpperCase();
  if (/^f([1-9]|1\d|2[0-4])$/i.test(s)) return s.toUpperCase();
  const alias = { escape: 'Esc', return: 'Enter', del: 'Delete', pgup: 'PageUp', pgdn: 'PageDown', prtsc: 'PrintScreen', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right' };
  if (alias[s.toLowerCase()]) return alias[s.toLowerCase()];
  return NAMED_KEYS.find((n) => n.toLowerCase() === s.toLowerCase()) || null;
}
function normalizeMod(m) {
  const s = m.trim().toLowerCase();
  if (s === 'ctrl' || s === 'control') return 'Ctrl';
  if (s === 'alt') return 'Alt';
  if (s === 'shift') return 'Shift';
  if (s === 'win' || s === 'meta' || s === 'super' || s === 'cmd') return 'Win';
  return null;
}
/** Parse free text into the contract's combo format, or null if invalid. */
function parseCombo(text) {
  const parts = String(text || '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const key = normalizeKey(parts[parts.length - 1]);
  if (!key) return null;
  const mods = new Set();
  for (const p of parts.slice(0, -1)) { const m = normalizeMod(p); if (!m) return null; mods.add(m); }
  return [...MODS.filter((m) => mods.has(m)), key].join('+');
}

// ---------- hand glyph SVG ----------
const FINGERS = [
  { k: 'index',  cx: 16.6, w: 5,   top: 6.5, rot: -11 },
  { k: 'middle', cx: 22.2, w: 5,   top: 4,   rot: -3.5 },
  { k: 'ring',   cx: 27.7, w: 4.8, top: 6,   rot: 4 },
  { k: 'pinky',  cx: 32.8, w: 4.3, top: 11,  rot: 12 },
];
/** Stylised hand from finger booleans. opts.spread fans the fingers; opts.pinch draws thumb+index touching. */
function handSVG(fingers, opts = {}) {
  const f = fingers || {};
  const stroke = 'var(--hand-stroke)', sw = 1.5;
  const capsule = (x, y, w, h, fill, rot = 0, ox = 0, oy = 0) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${rot ? ` transform="rotate(${rot} ${ox} ${oy})"` : ''}/>`;
  const base = 24;
  let back = '', front = '';
  if (!fingers) {
    // unknown pose: relaxed outline
    return `<svg viewBox="0 0 48 48" aria-hidden="true" opacity="0.45"><rect x="13" y="20" width="22" height="20" rx="8" fill="var(--hand-fill)" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="3 3"/></svg>`;
  }
  for (const d of FINGERS) {
    const up = opts.pinch && d.k === 'index' ? true : !!f[d.k];
    if (up) {
      let rot = opts.spread ? d.rot : d.rot * 0.25;
      let h = base + 4 - d.top;
      if (opts.pinch && d.k === 'index') { rot = -34; h = 15; }
      back += capsule(d.cx - d.w / 2, base + 4 - h, d.w, h, 'var(--hand-up)', rot, d.cx, base + 3);
    } else {
      front += capsule(d.cx - d.w / 2, 17.5, d.w, 9, 'var(--hand-fill)');
    }
  }
  const tx = 14.2, ty = 33.5;
  if (f.thumb || opts.pinch) {
    const onlyThumb = !opts.pinch && !f.index && !f.middle && !f.ring && !f.pinky;
    const rot = opts.pinch ? -20 : onlyThumb ? -22 : opts.spread ? -52 : -44;
    const len = opts.pinch ? 17 : onlyThumb ? 25 : 16;
    back += capsule(tx - 2.9, ty - len, 5.8, len, 'var(--hand-up)', rot, tx, ty - 1);
  } else {
    front += capsule(tx - 2.7, ty - 9, 5.4, 10, 'var(--hand-fill)', 62, tx, ty - 1);
  }
  const palm = `<path d="M13.4 22.5 Q13.4 20 16 20 H32.6 Q35.2 20 35.2 22.5 V34 Q35.2 41 28.5 42.5 H20.5 Q13.4 41 13.4 34 Z" fill="var(--hand-fill)" stroke="${stroke}" stroke-width="${sw}"/>`;
  const pinchDot = opts.pinch ? `<circle cx="7.6" cy="15.6" r="2.6" fill="var(--accent)" stroke="#fff" stroke-width="1"/>` : '';
  return `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linejoin="round">${back}${palm}${front}${pinchDot}</svg>`;
}
function poseSVG(id) {
  if (id === 'pinch') return handSVG(EXTRA_POSES.pinch.fingers, { pinch: true });
  const p = poseById(id);
  return handSVG(p ? p.fingers : null, { spread: id === 'open' });
}

// ---------- dev mock ----------
/** Plausible 21-point MediaPipe-style hand (screen DIP) for the mock telemetry. */
function fakeLandmarks(cx, cy, S, fingers, o = {}) {
  const f = fingers || {};
  const P = [[0, 0]];
  const thumb = o.pinch ? [[-0.3, -0.2], [-0.55, -0.42], [-0.68, -0.66], [-0.62, -0.9]]
    : f.thumb ? [[-0.3, -0.2], [-0.55, -0.38], [-0.75, -0.55], [-0.92, -0.72]]
    : [[-0.3, -0.2], [-0.45, -0.42], [-0.4, -0.62], [-0.22, -0.7]];
  P.push(...thumb);
  const FD = [['index', -0.32, -0.92, -0.12, [0.45, 0.28, 0.24]], ['middle', -0.08, -1.0, -0.03, [0.5, 0.32, 0.26]],
    ['ring', 0.15, -0.94, 0.06, [0.46, 0.3, 0.24]], ['pinky', 0.35, -0.8, 0.16, [0.36, 0.24, 0.2]]];
  for (const [k, mx, my, a0, lens] of FD) {
    const a = a0 * (o.spread ? 1.6 : 1);
    P.push([mx, my]);
    if (o.pinch && k === 'index') { P.push([-0.45, -1.25], [-0.6, -1.15], [-0.64, -0.96]); continue; }
    if (f[k]) {
      let x = mx, y = my;
      for (const L of lens) { x += L * Math.sin(a); y -= L * Math.cos(a); P.push([x, y]); }
    } else {
      P.push([mx + 0.03, my - 0.28], [mx + 0.05, my - 0.12], [mx + 0.03, my - 0.02]);
    }
  }
  const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), m = o.mirror ? -1 : 1;
  return P.map(([x, y]) => {
    x *= m; y += 0.55;
    return [Math.round(cx + (x * c - y * s) * S), Math.round(cy + (x * s + y * c) * S)];
  });
}
function installMock() {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let cfg = defaultConfig();
  const cfgCbs = [], telCbs = [];
  let enabled = false, paused = false, lastAction = null;
  const emitCfg = () => cfgCbs.forEach((cb) => cb(clone(cfg)));
  window.hand = {
    __mock: true,
    getConfig: async () => clone(cfg),
    setConfig: async (c) => { cfg = clone(c); emitCfg(); },
    resetConfig: async () => { cfg = defaultConfig(); cfg.enabled = enabled; emitCfg(); return clone(cfg); },
    onConfig: (cb) => { cfgCbs.push(cb); },
    testAction: async (a) => {
      await new Promise((r) => setTimeout(r, 160));
      if (a && a.type === 'launch' && !a.target) return { ok: false, error: 'No launch target set' };
      lastAction = { name: 'Test · ' + actionSummary(a), at: Date.now() };
      return { ok: true };
    },
    onTelemetry: (cb) => { telCbs.push(cb); },
    setEnabled: async (b) => { enabled = !!b; cfg.enabled = enabled; },
    setPaused: async (b) => { paused = !!b; },
    getPoses: async () => clone(FALLBACK_POSES),
  };
  const seq = ['point', 'two', 'pinch', 'three', 'none', 'thumb', 'fist', 'L', 'pinky', 'open', 'call', 'rock', 'none'];
  const SEG = 2800;
  const t0 = performance.now();
  let segIdx = -1, fired = false;
  setInterval(() => {
    const now = performance.now(), t = (now - t0) / 1000;
    const i = Math.floor((now - t0) / SEG) % seq.length;
    if (i !== segIdx) { segIdx = i; fired = false; }
    const pose = seq[i];
    const elapsed = (now - t0) % SEG;
    const sw = screen.width || 1920, sh = screen.height || 1080;
    const hands = [];
    const jit = (amp, ph) => amp * Math.sin(t * 2.3 + ph) + amp * 0.6 * (Math.random() - 0.5);
    const fakeMetrics = (fingers, spreadOut) => {
      const f = fingers || {};
      const m = {};
      ['index', 'middle', 'ring', 'pinky'].forEach((k, j) => { m[k] = +((f[k] ? 1.32 : 0.94) + jit(0.09, j)).toFixed(3); });
      m.thumb = +((f.thumb ? 0.86 : 0.38) + jit(0.1, 5)).toFixed(3);
      m.spread = +((spreadOut ? 1.1 : 0.62) + jit(0.12, 7)).toFixed(3);
      return m;
    };
    if (pose !== 'none') {
      const p = poseById(pose);
      const rx = sw * (0.56 + 0.16 * Math.sin(t * 0.7)), ry = sh * (0.52 + 0.14 * Math.sin(t * 1.1 + 1));
      hands.push({
        id: 'Right', x: rx, y: ry,
        pose, fingers: p ? { ...p.fingers } : {}, pinch: pose === 'pinch', pinchStrength: pose === 'pinch' ? 0.9 : 0.1,
        metrics: fakeMetrics(p && p.fingers, pose === 'open'),
        lm: fakeLandmarks(rx, ry, sh * 0.2, p && p.fingers, { pinch: pose === 'pinch', spread: pose === 'open', rot: 0.18 * Math.sin(t * 0.9), mirror: false }),
      });
      if (pose === 'open' || pose === 'L') {
        const lx = sw * (0.26 + 0.06 * Math.sin(t)), ly = sh * 0.6;
        hands.push({ id: 'Left', x: lx, y: ly, pose: 'fist', fingers: { ...poseById('fist').fingers }, pinch: false, pinchStrength: 0, metrics: fakeMetrics(poseById('fist').fingers, false),
          lm: fakeLandmarks(lx, ly, sh * 0.18, poseById('fist').fingers, { rot: -0.1 + 0.08 * Math.sin(t * 1.3), mirror: true }) });
      }
    }
    const b = cfg.bindings.find((x) => x.enabled && x.pose === pose && (x.hand === 'any' || x.hand === 'Right'));
    let holdProgress = 0, activeBinding = null;
    if (b) {
      holdProgress = Math.min(1, elapsed / Math.max(1, b.holdMs));
      activeBinding = b.id;
      if (holdProgress >= 1 && !fired) {
        fired = true;
        if (enabled && !paused || b.action.type === 'togglePause') {
          lastAction = { name: b.name, at: Date.now() };
          if (b.action.type === 'togglePause' && enabled) paused = !paused;
        }
      }
    }
    const tel = {
      status: 'Camera on · model ready', enabled, paused, hands, activeBinding, holdProgress,
      lastAction, mouseBackend: 'SendInput (mock)',
    };
    telCbs.forEach((cb) => cb(tel));
  }, 66);
  console.info('[settings] window.hand not found — running with in-page mock.');
}

// ---------- state ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(ms % 1000 ? (ms % 100 ? 2 : 1) : 0) + ' s' : Math.round(ms) + ' ms');
const uid = () => 'b-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let cfg = null;
let editingId = null;
let saveTimer = null, lastSentJSON = '';
let telem = null;
let lastToggleAt = 0;
let lastFiredAt = 0;
let recording = false;
let resetArmed = false, deleteArmed = false;
let tuneSel = 'open', tuneResetArmed = false;

function call(name, ...args) {
  const fn = window.hand && window.hand[name];
  if (typeof fn !== 'function') return Promise.resolve(undefined);
  try { return Promise.resolve(fn.apply(window.hand, args)); } catch (e) { return Promise.reject(e); }
}

function sanitizeConfig(c) {
  const d = defaultConfig();
  const out = { ...d, ...(c || {}) };
  out.comfortBox = { ...d.comfortBox, ...((c && c.comfortBox) || {}) };
  out.bindings = Array.isArray(c && c.bindings) ? c.bindings.map((b) => ({
    id: b.id || uid(), enabled: b.enabled !== false, name: b.name || 'Gesture', pose: b.pose || 'fist',
    hand: ['any', 'Left', 'Right'].includes(b.hand) ? b.hand : 'any',
    holdMs: Number.isFinite(+b.holdMs) ? +b.holdMs : 500, cooldownMs: Number.isFinite(+b.cooldownMs) ? +b.cooldownMs : 1000,
    action: b.action && b.action.type ? { ...b.action } : { type: 'none' },
  })) : d.bindings;
  const pt = (c && c.poseTuning && typeof c.poseTuning === 'object') ? c.poseTuning : {};
  out.poseTuning = {};
  for (const [id, v] of Object.entries(pt)) if (v && typeof v === 'object') out.poseTuning[id] = { ...v };
  for (const id of TUNE_IDS) if (!out.poseTuning[id]) out.poseTuning[id] = defaultTune(id);
  return out;
}

// ---------- saving ----------
const saveEl = () => $('#saveState');
let saveFadeTimer = null;
function setSaveState(kind, text) {
  const el = saveEl();
  clearTimeout(saveFadeTimer);
  el.className = 'save-state ' + kind;
  el.textContent = text;
  if (kind === 'saved') saveFadeTimer = setTimeout(() => el.classList.add('fade'), 1800);
}
function scheduleSave() {
  clearTimeout(saveTimer);
  setSaveState('saving', 'Saving…');
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const snapshot = JSON.parse(JSON.stringify(cfg));
    lastSentJSON = JSON.stringify(snapshot);
    try { await call('setConfig', snapshot); setSaveState('saved', 'Saved'); }
    catch (e) { console.error('[settings] save failed', e); setSaveState('error', 'Couldn’t save — ' + (e && e.message || 'error')); }
  }, 450);
}
function onExternalConfig(next) {
  if (!next) return;
  const j = JSON.stringify(next);
  if (j === lastSentJSON) return;           // our own echo
  if (saveTimer) return;                    // local edits pending; they win
  cfg = sanitizeConfig(next);
  if (editingId && !cfg.bindings.some((b) => b.id === editingId)) closeEditor();
  renderAll();
}

// ---------- conflicts ----------
function computeConflicts() {
  const res = new Map();
  const en = cfg.bindings.filter((b) => b.enabled);
  for (let i = 0; i < en.length; i++) for (let j = i + 1; j < en.length; j++) {
    const a = en[i], b = en[j];
    if (a.pose === b.pose && (a.hand === 'any' || b.hand === 'any' || a.hand === b.hand)) {
      (res.get(a.id) || res.set(a.id, []).get(a.id)).push(b);
      (res.get(b.id) || res.set(b.id, []).get(b.id)).push(a);
    }
  }
  return res;
}

// ---------- rendering: list ----------
function renderList() {
  const list = $('#list');
  const conflicts = computeConflicts();
  if (!cfg.bindings.length) {
    list.innerHTML = `<div class="empty">No gestures yet. <b>Add gesture</b> to map a hand pose to an action.</div>`;
    return;
  }
  list.innerHTML = cfg.bindings.map((b) => {
    const c = conflicts.get(b.id);
    const handTag = b.hand === 'any' ? 'Either' : b.hand;
    return `<div class="row${b.enabled ? '' : ' off'}${b.id === editingId ? ' selected' : ''}" role="listitem button" tabindex="0" data-id="${esc(b.id)}" aria-label="Edit ${esc(b.name)}">
      <button class="switch" role="switch" aria-checked="${b.enabled}" data-toggle="${esc(b.id)}" aria-label="Enable ${esc(b.name)}"><i></i></button>
      <div class="pose-icon" title="${esc(poseLabel(b.pose))}">${poseSVG(b.pose)}</div>
      <div class="row-main">
        <div class="row-name">${esc(b.name)}</div>
        <div class="row-sub">${esc(poseLabel(b.pose))}<span class="sep">→</span>${esc(actionSummary(b.action))}</div>
      </div>
      <div class="row-meta">
        ${c ? `<span class="tagpill warn" title="Same pose as ${esc(c.map((x) => x.name).join(', '))}">Conflict</span>` : ''}
        <span class="tagpill">${handTag}</span>
      </div>
    </div>`;
  }).join('');
  markLiveRow();
}
function markLiveRow() {
  const id = telem && telem.activeBinding;
  document.querySelectorAll('.row').forEach((r) => r.classList.toggle('live-active', !!id && r.dataset.id === id));
}

// ---------- rendering: pointer ----------
function rangeHTML(f, label, min, max, step, val, fmt) {
  return `<div class="field"><label for="f-${f}">${label}<output id="o-${f}">${fmt(val)}</output></label>
    <input type="range" id="f-${f}" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${val}" style="--p:${((val - min) / (max - min)) * 100}%"></div>`;
}
const pct = (v) => Math.round(v * 100) + '%';
// Thumb touches this fingertip.
const PINCH_FINGERS = [['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Pinky']];
function segHTML(key, label, opts, val) {
  return `<div class="field"><span class="flabel">${label}</span>
    <div class="seg" role="group" aria-label="${label}">
      ${opts.map(([v, l]) => `<button data-ptr="${key}" data-val="${v}" aria-pressed="${val === v}">${l}</button>`).join('')}
    </div></div>`;
}
const PTR_FMT = { boxW: pct, boxH: pct, smooth: (v) => (v <= 0.05 ? 'Off' : pct(v)), clickMax: (v) => v + ' ms', pinchOn: (v) => v.toFixed(2), pinchOff: (v) => v.toFixed(2) };
const FNAME = { index: 'index', middle: 'middle', ring: 'ring', pinky: 'pinky' };
const PINCH_SCALE = 0.9; // meter spans thumb-to-fingertip distance 0..0.9 hand sizes
function pointerHint() {
  const rc = cfg.rightClickFinger && cfg.rightClickFinger !== 'none' ? ` · thumb + ${FNAME[cfg.rightClickFinger]} right-clicks` : '';
  return `Thumb + ${FNAME[cfg.clickFinger] || 'index'}: quick pinch clicks, hold to drag${rc}`;
}
function pinchMeterHTML(key, label, finger) {
  const on = cfg.pinchOn, off = cfg.pinchOff, p = (v) => Math.min(100, (v / PINCH_SCALE) * 100);
  return `<div class="meter na pinch-meter" data-pm="${key}" data-finger="${finger}">
      <div class="meter-label"><b>${label}</b><span class="meter-req">thumb + ${FNAME[finger]}</span><span class="pm-state">—</span><output>—</output></div>
      <div class="meter-track"><i class="meter-band" style="left:${p(on)}%;width:${p(off) - p(on)}%"></i><i class="meter-fill"></i>
        <i class="meter-thr" data-thr="on" style="left:${p(on)}%"></i><i class="meter-thr soft" data-thr="off" style="left:${p(off)}%"></i></div>
    </div>`;
}
function updatePinchMeter() {
  const box = document.getElementById('pinchMeter'); if (!box) return;
  const hands = telem && Array.isArray(telem.hands) ? telem.hands : [];
  const h = hands.find((x) => x.id === cfg.primaryHand) || (hands.length === 1 ? hands[0] : null);
  const src = document.getElementById('pinchSrc');
  if (src) src.textContent = h ? `${h.id || ''} hand` : hands.length ? `Show your ${cfg.primaryHand.toLowerCase()} hand` : 'No hand in view';
  box.querySelectorAll('.pinch-meter').forEach((row) => {
    const d = h && h.pinchDist ? +h.pinchDist[row.dataset.finger] : NaN;
    const ok = Number.isFinite(d);
    const active = ok && (row.dataset.pm === 'click' ? !!h.pinch : !!h.rightPinch);
    row.classList.toggle('na', !ok); row.classList.toggle('pass', active);
    row.querySelector('.meter-fill').style.width = (ok ? Math.min(100, (d / PINCH_SCALE) * 100) : 0) + '%';
    row.querySelector('output').textContent = ok ? d.toFixed(2) : '—';
    row.querySelector('.pm-state').textContent = !ok ? '' : h.fistBlock ? 'Fist' : active ? (row.dataset.pm === 'click' ? 'Pinched' : 'Right-click') : 'Open';
  });
}
function renderPointer() {
  const el = $('#pointer');
  el.innerHTML = `
    <div class="fields">
      <div class="field"><span class="flabel">Pointer hand</span>
        <div class="seg" role="group" aria-label="Pointer hand">
          ${['Right', 'Left'].map((h) => `<button data-primary="${h}" aria-pressed="${cfg.primaryHand === h}">${h} hand</button>`).join('')}
        </div>
      </div>
      ${segHTML('clickFinger', 'Click / drag pinch', PINCH_FINGERS, cfg.clickFinger)}
      ${segHTML('rightClickFinger', 'Right-click pinch', [['none', 'Off'], ...PINCH_FINGERS.filter(([v]) => v !== cfg.clickFinger)], cfg.rightClickFinger)}
      <div class="field pinch-box" id="pinchMeter">
        <div class="meter-head"><span class="flabel">Pinch detection</span><span class="meter-src" id="pinchSrc">—</span></div>
        <div class="meter-rows">
          ${pinchMeterHTML('click', 'Click', cfg.clickFinger)}
          ${cfg.rightClickFinger && cfg.rightClickFinger !== 'none' ? pinchMeterHTML('right', 'Right-click', cfg.rightClickFinger) : ''}
        </div>
        <p class="pinch-help">Bar = gap between thumb and fingertip. A pinch starts left of the <b>white</b> line and lets go right of the <b>grey</b> one.</p>
      </div>
      ${rangeHTML('pinchOn', 'Pinch starts below', 0.1, 0.6, 0.01, cfg.pinchOn, PTR_FMT.pinchOn)}
      ${rangeHTML('pinchOff', 'Pinch releases above', 0.15, 0.8, 0.01, cfg.pinchOff, PTR_FMT.pinchOff)}
      ${rangeHTML('clickMax', 'Max click duration', 100, 600, 10, cfg.clickMaxMs, PTR_FMT.clickMax)}
      ${segHTML('twoHands', 'Hands tracked', [['false', 'One (faster)'], ['true', 'Both']], String(!!cfg.twoHands))}
      ${segHTML('cursorAnchor', 'Cursor follows', [['pinch', 'Pinch point'], ['index', 'Index tip'], ['palm', 'Palm']], cfg.cursorAnchor)}
      ${rangeHTML('boxW', 'Comfort box width', 0.3, 1, 0.05, cfg.comfortBox.w, PTR_FMT.boxW)}
      ${rangeHTML('boxH', 'Comfort box height', 0.3, 1, 0.05, cfg.comfortBox.h, PTR_FMT.boxH)}
      ${rangeHTML('smooth', 'Cursor smoothing', 0, 1, 0.05, cfg.cursorSmoothing, PTR_FMT.smooth)}
    </div>
    <div class="box-preview">
      <div class="box-frame"><div class="box-rect" id="boxRect"></div></div>
      <div class="box-caption">Area of the camera view that maps to your whole screen. Smaller = less arm movement.</div>
    </div>`;
  updateBoxPreview();
  const hint = document.getElementById('ptrHint'); if (hint) hint.textContent = pointerHint();
  updatePinchMeter();
}
function updateBoxPreview() {
  const r = $('#boxRect'); if (!r) return;
  r.style.width = cfg.comfortBox.w * 100 + '%';
  r.style.height = cfg.comfortBox.h * 100 + '%';
}
function onPointerInput(e) {
  const inp = e.target.closest('input[type=range]'); if (!inp) return;
  const v = +inp.value, f = inp.dataset.f;
  if (f === 'boxW') cfg.comfortBox.w = v;
  else if (f === 'boxH') cfg.comfortBox.h = v;
  else if (f === 'smooth') cfg.cursorSmoothing = v;
  else if (f === 'clickMax') cfg.clickMaxMs = v;
  else if (f === 'pinchOn' || f === 'pinchOff') {
    cfg[f] = v;
    // Keep release above start (the gap stops a borderline pinch flickering on and off).
    const other = f === 'pinchOn' ? 'pinchOff' : 'pinchOn';
    if (cfg.pinchOff < cfg.pinchOn + 0.03) {
      cfg[other] = f === 'pinchOn' ? Math.min(0.8, +(v + 0.03).toFixed(2)) : Math.max(0.1, +(v - 0.03).toFixed(2));
      const o = document.getElementById('f-' + other);
      if (o) { o.value = cfg[other]; setRangeFill(o); $('#o-' + other).textContent = PTR_FMT[other](cfg[other]); }
    }
    const pc = (x) => Math.min(100, (x / PINCH_SCALE) * 100);
    document.querySelectorAll('#pinchMeter .meter-track').forEach((tr) => {
      tr.querySelector('[data-thr=on]').style.left = pc(cfg.pinchOn) + '%';
      tr.querySelector('[data-thr=off]').style.left = pc(cfg.pinchOff) + '%';
      const band = tr.querySelector('.meter-band'); band.style.left = pc(cfg.pinchOn) + '%'; band.style.width = (pc(cfg.pinchOff) - pc(cfg.pinchOn)) + '%';
    });
  }
  else return;
  setRangeFill(inp);
  $('#o-' + f).textContent = PTR_FMT[f](v);
  updateBoxPreview();
  scheduleSave();
}
function setRangeFill(inp) {
  const min = +inp.min, max = +inp.max;
  inp.style.setProperty('--p', ((+inp.value - min) / (max - min)) * 100 + '%');
}

// ---------- rendering: editor ----------
const curBinding = () => cfg.bindings.find((b) => b.id === editingId) || null;

function renderEditor() {
  const b = curBinding();
  const body = $('#sheetBody');
  if (!b) { body.innerHTML = ''; return; }
  const a = b.action || { type: 'none' };
  const conflicts = computeConflicts().get(b.id);
  const usedPoses = new Set(cfg.bindings.filter((x) => x.enabled && x.id !== b.id).map((x) => x.pose));
  const continuous = CONTINUOUS.has(a.type);
  body.innerHTML = `
    <div class="ed-head">
      <button class="btn ghost icon-btn" data-ed="close" aria-label="Back to gestures"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5"/></svg></button>
      <div class="pose-icon">${poseSVG(b.pose)}</div>
      <h3 id="edTitle">${esc(b.name || 'Gesture')}</h3>
      <button class="switch" role="switch" aria-checked="${b.enabled}" data-ed="enabled" aria-label="Enabled"></button>
    </div>
    <div class="scroll ed-scroll" id="edScroll">
    ${conflicts ? `<div class="warnbox" role="alert"><span aria-hidden="true">⚠</span><span><b>Overlaps with ${esc(conflicts.map((x) => '“' + x.name + '”').join(', '))}.</b> Both use ${esc(poseLabel(b.pose))} for the same hand — only one will fire. Change the pose or hand, or disable one.</span></div>` : ''}
    <div class="field"><label for="ed-name">Name</label>
      <input class="field-input" id="ed-name" data-ed="name" value="${esc(b.name)}" maxlength="48" autocomplete="off"></div>
    <div class="field"><span class="flabel">Pose <span class="note">${esc(poseLabel(b.pose))}</span></span>
      <div class="pose-grid" role="group" aria-label="Pose">
        ${POSES.map((p) => `<button class="pose-btn${usedPoses.has(p.id) ? ' used' : ''}" data-pose="${esc(p.id)}" aria-pressed="${p.id === b.pose}" title="${esc(p.label)}${usedPoses.has(p.id) ? ' (used by another gesture)' : ''}">${poseSVG(p.id)}<span>${esc(p.label)}</span></button>`).join('')}
      </div>
    </div>
    <div class="field"><span class="flabel">Hand</span>
      <div class="seg" role="group" aria-label="Hand">
        ${[['any', 'Either'], ['Left', 'Left'], ['Right', 'Right']].map(([v, l]) => `<button data-hand="${v}" aria-pressed="${b.hand === v}">${l}</button>`).join('')}
      </div>
    </div>
    ${edRange('holdMs', 'Hold before firing', 0, 3000, 50, b.holdMs, fmtMs)}
    ${continuous
      ? `<div class="field"><span class="flabel">Cooldown</span><span class="note">Not used — this action stays active while the pose is held.</span></div>`
      : edRange('cooldownMs', 'Cooldown', 0, 5000, 100, b.cooldownMs, fmtMs)}
    <div class="field"><span class="flabel">Action</span>
      <div class="seg wrap" role="group" aria-label="Action type">
        ${ACTION_TYPES.map((t) => `<button data-atype="${t.id}" aria-pressed="${a.type === t.id}">${t.label}</button>`).join('')}
      </div>
    </div>
    ${actionFields(a)}
    </div>
    <div class="ed-foot">
      <div class="test-result" id="testResult" aria-live="polite"></div>
      <button class="btn primary" data-ed="test"${a.type === 'none' ? ' disabled' : ''}>Test action</button>
      <button class="btn" data-ed="dup">Duplicate</button>
      <span class="spacer"></span>
      ${deleteArmed
        ? `<button class="btn ghost sm" data-ed="delCancel">Keep</button><button class="btn danger armed sm" data-ed="delConfirm">Delete gesture</button>`
        : `<button class="btn ghost danger" data-ed="del">Delete</button>`}
    </div>`;
  $('#sheet [data-ed="enabled"]').innerHTML = '<i></i>';
  updateFades();
}
function edRange(f, label, min, max, step, val, fmt) {
  return `<div class="field"><label for="ed-${f}">${label}<output id="edo-${f}">${fmt(val)}</output></label>
    <input type="range" id="ed-${f}" data-edr="${f}" min="${min}" max="${max}" step="${step}" value="${val}" style="--p:${((val - min) / (max - min)) * 100}%"></div>`;
}
function comboHTML(combo) {
  if (!combo) return '<span class="placeholder">Click, then press keys</span>';
  return combo.split('+').map((k) => `<span class="kbd">${esc(k)}</span>`).join('<span class="plus">+</span>');
}
function actionFields(a) {
  switch (a.type) {
    case 'media':
      return `<div class="field"><span class="flabel">Media key</span><div class="media-grid" role="group" aria-label="Media key">
        ${MEDIA.map((m) => `<button class="btn" data-media="${m.id}" aria-pressed="${a.key === m.id}"><svg viewBox="0 0 17 16" aria-hidden="true"><path d="${m.path}" fill="currentColor"/></svg>${m.label}</button>`).join('')}
      </div></div>`;
    case 'keys':
      return `<div class="field"><span class="flabel">Shortcut</span>
        <button class="rec" id="rec" data-ed="rec" aria-label="Record shortcut">${comboHTML(a.combo)}</button>
        <input class="field-input" id="comboText" data-ed="comboText" value="${esc(a.combo || '')}" placeholder="or type it, e.g. Ctrl+Shift+T" autocomplete="off" spellcheck="false">
        <span class="note">Windows may intercept some system shortcuts (like Win+D) before the recorder sees them — type those in the field instead.</span></div>`;
    case 'launch':
      return `<div class="field"><label for="ed-target">App, file or URL</label>
        <input class="field-input" id="ed-target" data-ed="target" value="${esc(a.target || '')}" placeholder="C:\\Program Files\\App\\app.exe or https://…" autocomplete="off" spellcheck="false"></div>`;
    case 'mouse':
      return `<div class="field"><span class="flabel">Button</span><div class="seg" role="group" aria-label="Mouse button">
        ${MOUSE.map((m) => `<button data-mouse="${m.id}" aria-pressed="${a.button === m.id}">${m.label}</button>`).join('')}
      </div><span class="note">Clicks at the current cursor position.</span></div>`;
    case 'scroll':
      return edRange('speed', 'Scroll speed', 0.2, 4, 0.1, +a.speed || 1, (v) => (+v).toFixed(1) + '×') +
        `<span class="note" style="margin-top:-10px;font-size:12px;color:var(--ink-3)">Hold the pose and move your hand up or down to scroll.</span>`;
    case 'moveWindow':
      return `<div class="field"><span class="note">Grabs the window under the cursor when the pose engages and moves it with your hand until you release.</span></div>`;
    case 'togglePause':
      return `<div class="field"><span class="note">Pauses or resumes gesture control. Works even while paused, so you can always resume.</span></div>`;
    default:
      return `<div class="field"><span class="note">This gesture does nothing — useful to reserve a pose.</span></div>`;
  }
}

function openEditor(id) {
  if (openPanelName !== 'gestures') openPanel('gestures');
  editingId = id; deleteArmed = false; stopRecording(false);
  renderEditor(); renderList();
  $('#sheet').setAttribute('aria-hidden', 'false');
  $('.view-list').setAttribute('aria-hidden', 'true');
  $('#gestureViews').classList.add('editing');
  setTimeout(() => { const n = $('#ed-name'); n && n.focus({ preventScroll: true }); }, 60);
}
function closeEditor(focusRow = true) {
  const prev = editingId;
  editingId = null; deleteArmed = false; stopRecording(false);
  $('#sheet').setAttribute('aria-hidden', 'true');
  $('.view-list').setAttribute('aria-hidden', 'false');
  $('#gestureViews').classList.remove('editing');
  renderList();
  updateFades();
  const row = focusRow && prev && document.querySelector(`.row[data-id="${CSS.escape(prev)}"]`);
  row && row.focus({ preventScroll: true });
}
function refreshAfterEdit(rerenderEditor = true) {
  if (rerenderEditor) {
    const sc = $('#edScroll') ? $('#edScroll').scrollTop : 0;
    renderEditor();
    if ($('#edScroll')) $('#edScroll').scrollTop = sc;
    updateFades();
  }
  renderList();
  scheduleSave();
}

function onSheetClick(e) {
  const b = curBinding(); if (!b) return;
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.pose) { b.pose = t.dataset.pose; return refreshAfterEdit(); }
  if (t.dataset.hand) { b.hand = t.dataset.hand; return refreshAfterEdit(); }
  if (t.dataset.atype) {
    if (b.action.type !== t.dataset.atype) { stopRecording(false); b.action = defaultAction(t.dataset.atype); }
    return refreshAfterEdit();
  }
  if (t.dataset.media) { b.action.key = t.dataset.media; return refreshAfterEdit(); }
  if (t.dataset.mouse) { b.action.button = t.dataset.mouse; return refreshAfterEdit(); }
  switch (t.dataset.ed) {
    case 'close': return closeEditor();
    case 'enabled': b.enabled = !b.enabled; return refreshAfterEdit();
    case 'rec': return recording ? stopRecording(true) : startRecording();
    case 'test': return runTest(b.action);
    case 'dup': {
      const copy = JSON.parse(JSON.stringify(b));
      copy.id = uid(); copy.name = (b.name || 'Gesture') + ' copy'; copy.enabled = false;
      cfg.bindings.splice(cfg.bindings.indexOf(b) + 1, 0, copy);
      scheduleSave();
      return openEditor(copy.id);
    }
    case 'del': deleteArmed = true; renderEditor(); return $('#sheet [data-ed="delConfirm"]').focus();
    case 'delCancel': deleteArmed = false; return renderEditor();
    case 'delConfirm':
      cfg.bindings = cfg.bindings.filter((x) => x.id !== b.id);
      scheduleSave();
      return closeEditor();
  }
}
function onSheetInput(e) {
  const b = curBinding(); if (!b) return;
  const t = e.target;
  if (t.dataset.edr) {
    const v = +t.value, f = t.dataset.edr;
    if (f === 'speed') { b.action.speed = v; $('#edo-speed').textContent = v.toFixed(1) + '×'; }
    else { b[f] = v; $('#edo-' + f).textContent = fmtMs(v); }
    setRangeFill(t);
    return refreshAfterEdit(false);
  }
  if (t.dataset.ed === 'name') { b.name = t.value; $('#edTitle').textContent = t.value || 'Gesture'; return refreshAfterEdit(false); }
  if (t.dataset.ed === 'target') { b.action.target = t.value.trim(); return refreshAfterEdit(false); }
  if (t.dataset.ed === 'comboText') {
    const c = parseCombo(t.value);
    t.classList.toggle('invalid', !!t.value && !c);
    if (c) { b.action.combo = c; $('#rec').innerHTML = comboHTML(c); refreshAfterEdit(false); }
  }
}
function onSheetChange(e) {
  const t = e.target;
  if (t.dataset.ed === 'comboText') {
    const b = curBinding(); const c = parseCombo(t.value);
    if (c) { t.value = c; t.classList.remove('invalid'); }
    else if (b) { t.value = b.action.combo || ''; t.classList.remove('invalid'); }
  }
}

async function runTest(action) {
  const out = $('#testResult'); if (!out) return;
  out.className = 'test-result'; out.textContent = 'Running…';
  try {
    const r = await call('testAction', JSON.parse(JSON.stringify(action)));
    if (!out.isConnected) return;
    if (r && r.ok === false) { out.className = 'test-result err'; out.textContent = 'Failed: ' + (r.error || 'unknown error'); }
    else { out.className = 'test-result ok'; out.textContent = 'Sent ' + actionSummary(action); }
  } catch (e) {
    out.className = 'test-result err'; out.textContent = 'Failed: ' + (e && e.message || e);
  }
}

// ---------- key recorder ----------
function startRecording() {
  recording = true;
  const r = $('#rec'); if (!r) return;
  r.classList.add('recording');
  r.innerHTML = '<span class="placeholder">Press a shortcut…</span>';
  window.addEventListener('keydown', onRecKey, true);
  window.addEventListener('keyup', onRecKeyUp, true);
}
function stopRecording(restore = true) {
  if (!recording) return;
  recording = false;
  window.removeEventListener('keydown', onRecKey, true);
  window.removeEventListener('keyup', onRecKeyUp, true);
  const r = $('#rec'); const b = curBinding();
  if (r) { r.classList.remove('recording'); if (restore && b) r.innerHTML = comboHTML(b.action.combo); }
}
function modsOf(e) {
  const m = [];
  if (e.ctrlKey) m.push('Ctrl'); if (e.altKey) m.push('Alt'); if (e.shiftKey) m.push('Shift'); if (e.metaKey) m.push('Win');
  return m;
}
function onRecKey(e) {
  e.preventDefault(); e.stopPropagation();
  const key = codeToKey(e.code);
  const mods = modsOf(e);
  const r = $('#rec');
  if (!key) {
    if (r) r.innerHTML = mods.length ? comboHTML(mods.join('+')) + '<span class="plus">+</span><span class="placeholder">…</span>' : '<span class="placeholder">Press a shortcut…</span>';
    return;
  }
  commitCombo([...mods, key].join('+'));
}
function onRecKeyUp(e) {
  // PrintScreen typically only reports keyup on Windows
  if (e.code === 'PrintScreen') { e.preventDefault(); commitCombo([...modsOf(e), 'PrintScreen'].join('+')); }
}
function commitCombo(combo) {
  const b = curBinding(); if (!b) return stopRecording(false);
  b.action.combo = combo;
  stopRecording(true);
  const txt = $('#comboText'); if (txt) { txt.value = combo; txt.classList.remove('invalid'); }
  renderList(); scheduleSave();
}

// ---------- header / telemetry ----------
function setSwitch(el, on) { el.setAttribute('aria-checked', String(!!on)); }
function renderPower(on) {
  setSwitch($('#powerSwitch'), on);
  $('#powerState').textContent = on ? 'On' : 'Off';
}
const fingerList = (f) => f ? ['thumb', 'index', 'middle', 'ring', 'pinky'].filter((k) => f[k]) : [];

// ---------- live camera feed (content layer) + skeleton ----------
// The camera fills the whole window (mirrored, cover-fit). Preview only: low resolution and frame rate,
// and released whenever the window is hidden/minimized.
function setCamState(state, title, text) {
  const b = document.body;
  b.classList.toggle('cam-on', state === 'on');
  b.classList.toggle('cam-wait', state === 'wait');
  b.classList.toggle('cam-off', state === 'off');
  if (title != null) $('#camMsgTitle').textContent = title;
  if (text != null) $('#camMsgText').textContent = text;
}
(function initStageCam() {
  const video = $('#stageCam');
  if (!video) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCamState('off', 'Camera preview unavailable', 'This window can’t open the camera. Gestures keep working.');
    return;
  }
  let stream = null, opening = false;
  const start = () => {
    if (stream || opening || document.hidden) return;
    opening = true;
    setCamState('wait', 'Starting camera…', 'The preview appears here. Gestures keep working either way.');
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 480, max: 480 }, height: { ideal: 270, max: 270 }, frameRate: { ideal: 20, max: 24 }, facingMode: 'user' }, audio: false })
      .then((s) => {
        opening = false;
        if (document.hidden) { s.getTracks().forEach((tr) => tr.stop()); return; }
        stream = s; video.srcObject = s; video.play().catch(() => {});
        setCamState('on');
        // the device can be lost or taken by another app: drop the dead stream and retry on next focus
        s.getVideoTracks().forEach((tr) => tr.addEventListener('ended', () => {
          if (stream !== s) return;
          stream = null; video.srcObject = null;
          setCamState('off', 'Camera disconnected', 'The preview stopped. It retries when you return to this window.');
        }));
      })
      .catch((err) => {
        opening = false;
        const n = err && err.name;
        console.warn('Live view camera unavailable:', n);
        const why = n === 'NotAllowedError' ? ['Camera access is blocked', 'Allow camera access to see the live preview. Gestures keep working.']
          : n === 'NotFoundError' || n === 'OverconstrainedError' ? ['No camera found', 'Connect a camera to see the live preview.']
          : n === 'NotReadableError' ? ['Camera is busy', 'Another app is using the camera, so the preview is off.']
          : ['Camera preview unavailable', 'The preview couldn’t start. Gestures keep working.'];
        setCamState('off', why[0], why[1]);
      });
  };
  const stopCam = () => {
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
    stream = null; video.srcObject = null;
    if (document.body.classList.contains('cam-on')) setCamState('wait');
  };
  video.addEventListener('loadedmetadata', () => drawSkeletons(lastHands));
  document.addEventListener('visibilitychange', () => (document.hidden ? stopCam() : start()));
  window.addEventListener('focus', start);
  window.addEventListener('beforeunload', stopCam);
  start();
})();

// Pause decorative animation unless the window is focused.
(function idleWatch() {
  const set = () => document.documentElement.classList.toggle('idle', document.hidden || !document.hasFocus());
  window.addEventListener('focus', set); window.addEventListener('blur', set);
  document.addEventListener('visibilitychange', set);
  set();
})();

const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
let lastHands = [];
/** Landmarks are in primary-screen DIP, cover-fitted to the screen and mirrored; re-map them to this
 *  window's own cover-fit of the same frame. */
function lmMapper() {
  const v = $('#stageCam');
  const vw = (v && v.videoWidth) || 16, vh = (v && v.videoHeight) || 9;
  const SW = Math.max(screen.width || 1920, 1), SH = Math.max(screen.height || 1080, 1);
  const W = window.innerWidth, H = window.innerHeight;
  const s1 = Math.max(SW / vw, SH / vh), ox1 = (SW - vw * s1) / 2, oy1 = (SH - vh * s1) / 2;
  const s2 = Math.max(W / vw, H / vh), ox2 = (W - vw * s2) / 2, oy2 = (H - vh * s2) / 2;
  return ([x, y]) => [((x - ox1) / (vw * s1)) * vw * s2 + ox2, ((y - oy1) / (vh * s1)) * vh * s2 + oy2];
}
function drawSkeletons(hands) {
  const cv = $('#stageSkel');
  if (!cv) return;
  const W = window.innerWidth, H = window.innerHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!hands || !hands.length) return;
  const map = lmMapper();
  for (const h of hands) {
    if (!Array.isArray(h.lm) || h.lm.length < 21) continue;
    const pts = h.lm.map(map);
    const span = Math.hypot(pts[0][0] - pts[9][0], pts[0][1] - pts[9][1]);
    const k = clamp(span / 110, 0.7, 1.6); // scale strokes with hand size on screen
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // soft dark under-stroke for legibility over bright scenes
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 6 * k;
    ctx.beginPath();
    for (const [a, b] of BONES) { ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.lineWidth = 2.6 * k;
    ctx.stroke();
    for (let i = 0; i < 21; i++) {
      const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], (tip ? 4.6 : 3) * k, 0, Math.PI * 2);
      ctx.fillStyle = tip ? 'rgba(140,190,255,1)' : '#fff'; ctx.fill();
      if (tip) { ctx.lineWidth = 1.6 * k; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke(); }
    }
    if (h.pinch) {
      const mx = (pts[4][0] + pts[8][0]) / 2, my = (pts[4][1] + pts[8][1]) / 2;
      ctx.beginPath(); ctx.arc(mx, my, 9 * k, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(76,148,255,0.35)'; ctx.fill();
      ctx.beginPath(); ctx.arc(mx, my, 4.5 * k, 0, Math.PI * 2);
      ctx.fillStyle = '#4c94ff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
}
window.addEventListener('resize', () => drawSkeletons(lastHands));

function renderTelemetry(t) {
  telem = t;
  if (openPanelName === 'pointer') updatePinchMeter();
  // status chips
  const chip = $('#statusChip');
  const s = String(t.status || 'Unknown');
  chip.classList.toggle('ok', /ready|running|tracking|on\b|ok/i.test(s) && !/error|fail|denied|no camera|off/i.test(s));
  chip.classList.toggle('bad', /error|fail|denied|no camera|blocked/i.test(s));
  chip.querySelector('span').textContent = s;
  chip.title = 'Camera / model: ' + s;
  $('#backendChip span').textContent = 'Mouse: ' + (t.mouseBackend || '—');

  if (Date.now() - lastToggleAt > 900) {
    renderPower(!!t.enabled);
    setSwitch($('#pauseSwitch'), !!t.paused);
  }

  // skeletons over the camera (no per-hand markers — pose info lives in the HUD)
  const hands = Array.isArray(t.hands) ? t.hands : [];
  document.body.classList.toggle('has-hands', hands.length > 0);
  lastHands = hands;
  drawSkeletons(hands);

  // HUD readout
  const active = t.activeBinding ? cfg && cfg.bindings.find((b) => b.id === t.activeBinding) : null;
  const focusHand = (active && hands.find((h) => h.pose === active.pose)) || hands.find((h) => h.id === (cfg && cfg.primaryHand)) || hands[0];
  const pose = focusHand ? (focusHand.pinch ? 'pinch' : focusHand.pose || 'none') : null;
  const handTxt = focusHand && focusHand.id ? focusHand.id + ' · ' : '';
  $('#poseName').textContent = !hands.length ? 'No hands in view'
    : handTxt + (pose === 'none' ? fingerList(focusHand.fingers).length + ' fingers up' : poseLabel(pose));
  const bn = $('#bindingName');
  if (!hands.length) bn.textContent = 'Hold a hand up to the camera';
  else if (active) bn.innerHTML = `→ <b>${esc(active.name)}</b>`;
  else if (pose === 'pinch') bn.textContent = 'Pointer · pinch to click or drag';
  else if (pose === 'none') bn.textContent = 'No gesture recognised';
  else bn.textContent = 'No gesture bound to this pose';
  const p = clamp(+t.holdProgress || 0, 0, 1);
  $('#ringFg').style.strokeDasharray = `${(active ? p : 0) * 100} 100`;
  $('.ring-wrap').classList.toggle('done', !!active && p >= 1);

  // last action
  const la = t.lastAction;
  if (la && la.at && la.at !== lastFiredAt) {
    const first = lastFiredAt === 0 && Date.now() - la.at > 3000;
    lastFiredAt = la.at;
    if (!first) {
      const f = $('#fired');
      f.textContent = '✓ ' + la.name;
      f.classList.remove('show', 'gone'); void f.offsetWidth; f.classList.add('show');
      clearTimeout(f._t); f._t = setTimeout(() => f.classList.add('gone'), 3200);
    }
  }
  if (la && la.at) {
    const ago = Math.max(0, Math.round((Date.now() - la.at) / 1000));
    $('#lastLine').textContent = `Last: ${la.name} · ${ago < 2 ? 'just now' : ago < 60 ? ago + 's ago' : Math.round(ago / 60) + 'm ago'}`;
  }
  if (t.paused && t.enabled) $('#lastLine').textContent = 'Paused — gestures won’t fire (except Pause)';

  markLiveRow();
  updateTuneMeter();
}

// ---------- pop-out panels ----------
let openPanelName = null, panelAnim = null;
const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// spring-like easing (slight overshoot), with a cubic-bezier fallback for engines without linear()
const SPRING = (() => {
  const e = 'linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017 20.4%, 1.043 24%, 1.035 28.4%, 1.007 37.9%, 0.996 47.3%, 1)';
  return CSS.supports('transition-timing-function', e) ? e : 'cubic-bezier(0.3, 1.3, 0.5, 1)';
})();
const panelEl = (name) => document.getElementById('panel-' + name);
const dockBtn = (name) => document.querySelector(`.dock-btn[data-open="${name}"]`);

/** Morph a panel out of (or back into) its dock button: clip-path from the button's rect + content blur/fade. */
function morph(panel, btn, opening) {
  if (panelAnim) { panelAnim.forEach((a) => a.cancel()); panelAnim = null; }
  const body = panel.querySelector('.panel-body');
  if (REDUCED() || !btn || !panel.animate) {
    const a = panel.animate ? panel.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' }) : null;
    return a ? a.finished.catch(() => {}) : Promise.resolve();
  }
  const pr = panel.getBoundingClientRect(), br = btn.getBoundingClientRect();
  const R = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 30;
  const from = `inset(${br.top - pr.top}px ${pr.right - br.right}px ${pr.bottom - br.bottom}px ${br.left - pr.left}px round ${br.height / 2}px)`;
  const E = 80; // final clip extends past the panel so its own shadow isn't cut
  const to = `inset(${-E}px round ${R + E}px)`;
  const frames = [{ clipPath: from, opacity: 0.6 }, { clipPath: to, opacity: 1 }];
  const content = [{ opacity: 0, filter: 'blur(8px)', transform: 'scale(0.96)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }];
  const dur = opening ? 520 : 300;
  const opt = { duration: dur, easing: opening ? SPRING : 'cubic-bezier(0.4, 0, 0.7, 0.2)', fill: 'forwards' };
  const a1 = panel.animate(opening ? frames : frames.slice().reverse(), opt);
  const a2 = body.animate(opening ? content : content.slice().reverse(),
    { duration: opening ? 300 : 180, delay: opening ? 90 : 0, easing: 'ease-out', fill: 'both' });
  panelAnim = [a1, a2];
  return a1.finished.then(() => { if (opening) { a1.cancel(); a2.cancel(); } panelAnim = null; }).catch(() => {});
}
function openPanel(name) {
  if (openPanelName === name) return;
  if (openPanelName) closePanel(true);
  const panel = panelEl(name), btn = dockBtn(name);
  if (!panel) return;
  openPanelName = name;
  panel.hidden = false;
  document.body.classList.add('panel-open');
  btn && btn.setAttribute('aria-expanded', 'true');
  if (name === 'tuning') { renderTuning(); }
  updateFades();
  morph(panel, btn, true);
  panel.tabIndex = -1;
  panel.focus({ preventScroll: true });
}
function closePanel(instant = false) {
  const name = openPanelName; if (!name) return;
  const panel = panelEl(name), btn = dockBtn(name);
  openPanelName = null;
  if (name === 'gestures' && editingId) closeEditor(false);
  if (name === 'gestures' && resetArmed) { resetArmed = false; renderBindActions(); }
  if (name === 'tuning' && tuneResetArmed) { tuneResetArmed = false; renderTuneActions(); }
  btn && btn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('panel-open');
  if (instant) { if (panelAnim) panelAnim.forEach((a) => a.cancel()); panelAnim = null; panel.hidden = true; return; }
  morph(panel, btn, false).then(() => {
    if (openPanelName !== name) { panel.hidden = true; panel.getAnimations().forEach((a) => a.cancel()); panel.querySelector('.panel-body').getAnimations().forEach((a) => a.cancel()); }
  });
  if (panel.contains(document.activeElement) && btn) btn.focus({ preventScroll: true });
}

// soft fades at the scroll edges of panel contents
function updateFade(el) {
  el.classList.toggle('fade-top', el.scrollTop > 2);
  el.classList.toggle('fade-bottom', el.scrollTop + el.clientHeight < el.scrollHeight - 2);
}
function updateFades() { requestAnimationFrame(() => document.querySelectorAll('.panel:not([hidden]) .scroll').forEach(updateFade)); }
document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('scroll')) updateFade(e.target); }, true);
window.addEventListener('resize', updateFades);

// ---------- Liquid Glass edge lensing (small elements only) ----------
// Each lensed element gets its own feDisplacementMap whose map is drawn from a rounded-rect SDF:
// pixels within a band of the edge are displaced along the edge normal, bending the backdrop like a lens rim.
function initLens() {
  const ua = navigator.userAgent;
  if (!/Chrome\//.test(ua) || window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
  const defs = $('#lensDefs'); if (!defs) return;
  const NS = 'http://www.w3.org/2000/svg';
  const build = (el) => {
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (w < 4 || h < 4) return;
    const key = w + 'x' + h; if (el.dataset.lensKey === key) return;
    el.dataset.lensKey = key;
    const id = 'lens-' + el.dataset.lens;
    const sc = 0.5, cw = Math.max(2, Math.round(w * sc)), ch = Math.max(2, Math.round(h * sc));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(cw, ch);
    const r = Math.min(h / 2, parseFloat(getComputedStyle(el).borderTopLeftRadius) || h / 2);
    const band = Math.min(14, h / 2.5);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const x = (i + 0.5) / sc - w / 2, y = (j + 0.5) / sc - h / 2;
      // signed distance to rounded rect, and its gradient
      const qx = Math.abs(x) - (w / 2 - r), qy = Math.abs(y) - (h / 2 - r);
      const ax = Math.max(qx, 0), ay = Math.max(qy, 0), len = Math.hypot(ax, ay);
      const d = len + Math.min(Math.max(qx, qy), 0) - r;
      let nx, ny;
      if (len > 0) { nx = ax / len; ny = ay / len; } else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
      nx *= Math.sign(x) || 1; ny *= Math.sign(y) || 1;
      const t = clamp(1 + d / band, 0, 1), m = t * t; // 0 inside, ramps to 1 at the rim
      const o = (j * cw + i) * 4;
      img.data[o] = 128 + nx * m * 127; img.data[o + 1] = 128 + ny * m * 127; img.data[o + 2] = 128; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    let f = document.getElementById(id);
    if (!f) {
      f = document.createElementNS(NS, 'filter');
      f.setAttribute('id', id); f.setAttribute('color-interpolation-filters', 'sRGB');
      f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
      f.setAttribute('filterUnits', 'userSpaceOnUse'); f.setAttribute('primitiveUnits', 'userSpaceOnUse');
      f.innerHTML = `<feImage result="map" preserveAspectRatio="none"/><feDisplacementMap in="SourceGraphic" in2="map" scale="18" xChannelSelector="R" yChannelSelector="G"/>`;
      defs.appendChild(f);
    }
    f.setAttribute('width', w); f.setAttribute('height', h);
    const fi = f.querySelector('feImage');
    fi.setAttribute('x', 0); fi.setAttribute('y', 0); fi.setAttribute('width', w); fi.setAttribute('height', h);
    fi.setAttribute('href', cv.toDataURL());
    el.style.setProperty('--lens', `url(#${id})`);
  };
  const els = [...document.querySelectorAll('.lensed[data-lens]')];
  const ro = new ResizeObserver((entries) => entries.forEach((e) => build(e.target)));
  els.forEach((el) => { build(el); ro.observe(el); });
  document.documentElement.classList.add('lens-ok');
}

// ---------- pose tuning ----------
const TUNE_FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const FINGER_LABEL = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Pinky', spread: 'Spread' };
// display range of each meter bar (same units as the metrics)
const METER_RANGE = { finger: [0.6, 1.8], thumb: [0, 1.4], spread: [0, 2] };
const TUNE_FIELDS = {
  up:     { min: 1.0, max: 1.6, step: 0.01, strictHigh: true },
  down:   { min: 0.8, max: 1.4, step: 0.01, strictHigh: false },
  thumb:  { min: 0.3, max: 1.2, step: 0.01, strictHigh: true },
  spread: { min: 0.5, max: 1.5, step: 0.01, strictHigh: true },
};
const tuneOf = (id) => ({ ...defaultTune(id), ...((cfg && cfg.poseTuning && cfg.poseTuning[id]) || {}) });
const isTuneDefault = (id) => { const t = tuneOf(id), d = defaultTune(id); return Object.keys(d).every((k) => Math.abs(+t[k] - d[k]) < 1e-9); };
const tunePoses = () => POSES.filter((p) => p.fingers);
const framesMs = (n) => '~' + Math.round(n * 1000 / 30) + ' ms';

/** What a pose needs from each finger: [{k, need:'up'|'down'|'out'|'in'|'wide', thr, range}] */
function tuneRequirements(id) {
  const p = poseById(id); if (!p || !p.fingers) return [];
  const t = tuneOf(id);
  const req = TUNE_FINGERS.map((k) => k === 'thumb'
    ? { k, need: p.fingers.thumb ? 'out' : 'in', thr: +t.thumb, range: METER_RANGE.thumb }
    : { k, need: p.fingers[k] ? 'up' : 'down', thr: p.fingers[k] ? +t.up : +t.down, range: METER_RANGE.finger });
  if (id === 'open') req.push({ k: 'spread', need: 'wide', thr: +t.spread, range: METER_RANGE.spread });
  return req;
}
const NEED_TEXT = { up: 'raised', down: 'folded', out: 'out', in: 'tucked', wide: 'spread' };
const needSym = (r) => (r.need === 'down' ? '<' : r.need === 'in' ? '≤' : '>');
const reqText = (r) => `${NEED_TEXT[r.need]} · ${needSym(r)} ${r.thr.toFixed(2)}`;
const passes = (r, v) => (r.need === 'down' ? v < r.thr : r.need === 'in' ? v <= r.thr : v > r.thr);
const meterPct = (r, v) => clamp((v - r.range[0]) / (r.range[1] - r.range[0]), 0, 1) * 100;

function tuneSlider(f, label, val, note) {
  const d = TUNE_FIELDS[f];
  const lo = d.strictHigh ? 'looser' : 'stricter', hi = d.strictHigh ? 'stricter' : 'looser';
  return `<div class="field tune-field"><label for="tn-${f}">${label}<output id="tno-${f}">${(+val).toFixed(2)}</output></label>
    <input type="range" id="tn-${f}" data-tune="${f}" min="${d.min}" max="${d.max}" step="${d.step}" value="${val}" style="--p:${((val - d.min) / (d.max - d.min)) * 100}%">
    <span class="tune-scale"><span>← ${lo}</span>${note ? `<span class="tune-note">${note}</span>` : ''}<span>${hi} →</span></span></div>`;
}

function renderTuneActions() {
  const el = $('#tuneActions'); if (!el) return;
  el.innerHTML = tuneResetArmed
    ? `<span class="confirm-text">Reset tuning for every pose?</span>
       <button class="btn ghost sm" data-tn="resetAllCancel">Cancel</button>
       <button class="btn danger armed sm" data-tn="resetAllConfirm">Reset all</button>`
    : `<button class="btn ghost sm" data-tn="resetAll"${TUNE_IDS.every(isTuneDefault) ? ' disabled' : ''}>Reset all poses</button>`;
}

function renderTuning() {
  const el = $('#tuning'); if (!el || !cfg) return;
  const poses = tunePoses();
  if (!poses.some((p) => p.id === tuneSel)) tuneSel = (poses[0] || { id: 'open' }).id;
  const p = poseById(tuneSel); if (!p) { el.innerHTML = ''; return; }
  const t = tuneOf(tuneSel);
  const raised = ['index', 'middle', 'ring', 'pinky'].filter((k) => p.fingers[k]).length;
  const sliders = [];
  if (raised) sliders.push(tuneSlider('up', 'Raised fingers must be straighter', +t.up));
  if (raised < 4) sliders.push(tuneSlider('down', 'Folded fingers must be curled tighter', +t.down));
  sliders.push(p.fingers.thumb
    ? tuneSlider('thumb', 'Thumb must stick out further', +t.thumb)
    : tuneSlider('thumb', 'Thumb may stick out up to', +t.thumb, 'lower = tuck tighter'));
  if (tuneSel === 'open') sliders.push(tuneSlider('spread', 'Fingers spread wider', +t.spread));
  sliders.push(`<div class="field tune-field"><label for="tn-frames"><span>Hold steady for <span id="tnf-n">${+t.frames}</span> frames</span><output id="tno-frames">${framesMs(+t.frames)}</output></label>
    <input type="range" id="tn-frames" data-tune="frames" min="1" max="15" step="1" value="${+t.frames}" style="--p:${((t.frames - 1) / 14) * 100}%">
    <span class="tune-scale"><span>← quicker</span><span>steadier →</span></span></div>`);
  el.innerHTML = `
    <div class="pose-grid tune-poses" role="group" aria-label="Pose to tune">
      ${poses.map((q) => `<button class="pose-btn${isTuneDefault(q.id) ? '' : ' tuned'}" data-tpose="${esc(q.id)}" aria-pressed="${q.id === tuneSel}" title="${esc(q.label)}${isTuneDefault(q.id) ? '' : ' (custom tuning)'}">${poseSVG(q.id)}<span>${esc(q.label)}</span></button>`).join('')}
    </div>
    <div class="tune-body">
      <div class="tune-controls">
        <div class="tune-head">
          <h3>${esc(p.label)}</h3>
          <button class="btn ghost sm" data-tn="resetPose"${isTuneDefault(tuneSel) ? ' disabled' : ''}>Reset</button>
        </div>
        ${sliders.join('')}
      </div>
      <div class="tune-meter">
        <div class="meter-head"><span class="flabel">Your hand now</span><span class="meter-src" id="meterSrc">—</span></div>
        <div class="meter-rows" id="meterRows"></div>
        <div class="match" id="tuneMatch" aria-live="polite">Show your hand to the camera</div>
      </div>
    </div>`;
  renderMeterRows();
  renderTuneActions();
}

function renderMeterRows() {
  const rows = $('#meterRows'); if (!rows) return;
  lastMatchText = '';
  rows.innerHTML = tuneRequirements(tuneSel).map((r) => `
    <div class="meter na" data-k="${r.k}">
      <div class="meter-label"><b>${FINGER_LABEL[r.k]}</b><span class="meter-req">${reqText(r)}</span><output>—</output></div>
      <div class="meter-track"><i class="meter-fill"></i><i class="meter-thr" style="left:${meterPct(r, r.thr)}%"></i></div>
    </div>`).join('');
  updateTuneMeter();
}

function tuneHand() {
  const hands = telem && Array.isArray(telem.hands) ? telem.hands : [];
  return hands.find((h) => h.id === (cfg && cfg.primaryHand) && h.metrics) || hands.find((h) => h.metrics) || hands[0] || null;
}
let lastMatchText = '';
function updateTuneMeter() {
  const rows = $('#meterRows'); if (!rows) return;
  const h = tuneHand();
  const m = h && h.metrics && typeof h.metrics === 'object' ? h.metrics : null;
  $('#meterSrc').textContent = h
    ? (h.id ? h.id + ' hand' : 'Hand') + (h.pose && h.pose !== 'none' ? ' · seen as ' + poseLabel(h.pinch ? 'pinch' : h.pose) : '')
    : 'No hand in view';
  let all = true, any = false;
  for (const r of tuneRequirements(tuneSel)) {
    const row = rows.querySelector(`.meter[data-k="${r.k}"]`); if (!row) continue;
    const v = m ? +m[r.k] : NaN;
    const ok = m != null && m[r.k] != null && Number.isFinite(v);
    const pass = ok && passes(r, v);
    if (ok) any = true;
    if (!pass) all = false;
    row.classList.toggle('pass', pass);
    row.classList.toggle('fail', ok && !pass);
    row.classList.toggle('na', !ok);
    row.querySelector('.meter-fill').style.width = (ok ? meterPct(r, v) : 0) + '%';
    row.querySelector('output').textContent = ok ? v.toFixed(2) : '—';
  }
  const match = $('#tuneMatch');
  const text = !h ? 'Show your hand to the camera'
    : !any ? 'No finger measurements from the tracker yet'
    : all ? '✓ Matches ' + poseLabel(tuneSel) : 'Not matching ' + poseLabel(tuneSel);
  if (text !== lastMatchText || !match.textContent) {
    lastMatchText = text;
    match.className = 'match' + (any ? (all ? ' ok' : ' no') : '');
    match.textContent = text;
  }
}

function refreshTuneChrome() {
  const btn = document.querySelector(`[data-tpose="${CSS.escape(tuneSel)}"]`);
  if (btn) btn.classList.toggle('tuned', !isTuneDefault(tuneSel));
  const rp = document.querySelector('[data-tn="resetPose"]'); if (rp) rp.disabled = isTuneDefault(tuneSel);
  if (!tuneResetArmed) renderTuneActions();
}
function onTuneInput(e) {
  const inp = e.target.closest('input[data-tune]'); if (!inp) return;
  const f = inp.dataset.tune, v = f === 'frames' ? Math.round(+inp.value) : +(+inp.value).toFixed(2);
  cfg.poseTuning = cfg.poseTuning || {};
  cfg.poseTuning[tuneSel] = { ...tuneOf(tuneSel), [f]: v };
  setRangeFill(inp);
  if (f === 'frames') { $('#tnf-n').textContent = v; $('#tno-frames').textContent = framesMs(v); }
  else $('#tno-' + f).textContent = v.toFixed(2);
  // move threshold markers / requirement text without rebuilding the sliders
  for (const r of tuneRequirements(tuneSel)) {
    const row = document.querySelector(`#meterRows .meter[data-k="${r.k}"]`); if (!row) continue;
    row.querySelector('.meter-thr').style.left = meterPct(r, r.thr) + '%';
    row.querySelector('.meter-req').textContent = reqText(r);
  }
  updateTuneMeter();
  refreshTuneChrome();
  scheduleSave();
}
function onTuneClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.tpose) { tuneSel = t.dataset.tpose; return renderTuning(); }
  switch (t.dataset.tn) {
    case 'resetPose': cfg.poseTuning[tuneSel] = defaultTune(tuneSel); renderTuning(); return scheduleSave();
    case 'resetAll': tuneResetArmed = true; renderTuneActions(); return $('[data-tn="resetAllCancel"]').focus();
    case 'resetAllCancel': tuneResetArmed = false; return renderTuneActions();
    case 'resetAllConfirm': tuneResetArmed = false; cfg.poseTuning = defaultPoseTuning(); renderTuning(); return scheduleSave();
  }
}

// ---------- reset ----------
function renderBindActions() {
  const el = $('#bindActions');
  el.innerHTML = resetArmed
    ? `<span class="confirm-text">Replace all gestures with defaults?</span>
       <button class="btn ghost sm" id="resetCancel">Cancel</button>
       <button class="btn danger armed sm" id="resetConfirm">Reset</button>`
    : `<button class="btn ghost sm" id="resetBtn">Reset to defaults</button>
       <button class="btn primary sm" id="addBtn"><span aria-hidden="true">+</span> Add gesture</button>`;
}
async function onBindActions(e) {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'resetBtn') { resetArmed = true; renderBindActions(); $('#resetCancel').focus(); return; }
  if (t.id === 'resetCancel') { resetArmed = false; renderBindActions(); return; }
  if (t.id === 'resetConfirm') {
    resetArmed = false; renderBindActions();
    clearTimeout(saveTimer); saveTimer = null;
    setSaveState('saving', 'Resetting…');
    try {
      const next = await call('resetConfig');
      cfg = sanitizeConfig(next || defaultConfig());
      lastSentJSON = JSON.stringify(next);
      if (editingId) closeEditor();
      renderAll();
      setSaveState('saved', 'Defaults restored');
    } catch (err) { setSaveState('error', 'Reset failed'); console.error(err); }
    return;
  }
  if (t.id === 'addBtn') {
    const used = new Set(cfg.bindings.filter((b) => b.enabled).map((b) => b.pose));
    const pose = (POSES.find((p) => !used.has(p.id)) || POSES[0]).id;
    const b = { id: uid(), enabled: true, name: 'New gesture', pose, hand: 'any', holdMs: 500, cooldownMs: 1000, action: { type: 'media', key: 'playpause' } };
    cfg.bindings.push(b);
    scheduleSave();
    openEditor(b.id);
    const row = document.querySelector(`.row[data-id="${CSS.escape(b.id)}"]`);
    row && row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function renderAll() {
  renderList();
  renderPointer();
  renderTuning();
  if (editingId) renderEditor();
}

// ---------- wiring ----------
function wire() {
  $('#list').addEventListener('click', (e) => {
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      e.stopPropagation();
      const b = cfg.bindings.find((x) => x.id === tg.dataset.toggle);
      if (b) { b.enabled = !b.enabled; renderList(); if (editingId) renderEditor(); scheduleSave(); }
      return;
    }
    const row = e.target.closest('.row');
    if (row) openEditor(row.dataset.id);
  });
  $('#list').addEventListener('keydown', (e) => {
    const row = e.target.closest('.row');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openEditor(row.dataset.id); }
  });
  $('#bindActions').addEventListener('click', onBindActions);
  $('#pointer').addEventListener('input', onPointerInput);
  $('#tuning').addEventListener('input', onTuneInput);
  $('#tuning').addEventListener('click', onTuneClick);
  $('#tuneActions').addEventListener('click', onTuneClick);
  $('#pointer').addEventListener('click', (e) => {
    const sp = e.target.closest('[data-ptr]');
    if (sp) {
      cfg[sp.dataset.ptr] = sp.dataset.ptr === 'twoHands' ? sp.dataset.val === 'true' : sp.dataset.val;
      if (cfg.rightClickFinger === cfg.clickFinger) cfg.rightClickFinger = 'none';
      renderPointer(); // right-click options depend on the click finger
      scheduleSave();
      return;
    }
    const t = e.target.closest('[data-primary]'); if (!t) return;
    cfg.primaryHand = t.dataset.primary;
    document.querySelectorAll('[data-primary]').forEach((x) => x.setAttribute('aria-pressed', String(x === t)));
    scheduleSave();
  });
  const sheet = $('#sheet');
  sheet.addEventListener('click', onSheetClick);
  sheet.addEventListener('input', onSheetInput);
  sheet.addEventListener('change', onSheetChange);
  document.addEventListener('pointerdown', (e) => { if (recording && !e.target.closest('#rec')) stopRecording(true); }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || recording) return;
    if (editingId) closeEditor();
    else if (openPanelName) closePanel();
  });
  // dock: one panel at a time; clicking the open one again closes it
  $('#dock').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]'); if (!b) return;
    if (openPanelName === b.dataset.open) closePanel(); else openPanel(b.dataset.open);
  });
  // clicking the camera (content layer) closes any open panel
  document.addEventListener('pointerdown', (e) => {
    if (!openPanelName || recording) return;
    if (e.target.closest('.panel, .dock, .topbar, .hud, .fired')) return;
    closePanel();
  });

  $('#powerSwitch').addEventListener('click', () => {
    const on = $('#powerSwitch').getAttribute('aria-checked') !== 'true';
    lastToggleAt = Date.now(); renderPower(on);
    if (cfg) cfg.enabled = on;
    call('setEnabled', on).catch((err) => console.error(err));
  });
  $('#pauseSwitch').addEventListener('click', (e) => {
    e.preventDefault();
    const el = $('#pauseSwitch');
    const on = el.getAttribute('aria-checked') !== 'true';
    lastToggleAt = Date.now(); setSwitch(el, on);
    call('setPaused', on).catch((err) => console.error(err));
  });
}

async function init() {
  if (!window.hand) installMock();
  $('#brandMark').innerHTML = handSVG(FALLBACK_POSES[0].fingers, { spread: true });
  wire();
  initLens();
  await loadPoses();
  try { cfg = sanitizeConfig(await call('getConfig')); }
  catch (e) { console.error('[settings] getConfig failed', e); cfg = defaultConfig(); }
  lastSentJSON = JSON.stringify(cfg);
  renderPower(!!cfg.enabled);
  renderAll();
  try { window.hand.onConfig && window.hand.onConfig(onExternalConfig); } catch (e) { console.error(e); }
  try { window.hand.onTelemetry && window.hand.onTelemetry((t) => { if (t && cfg) renderTelemetry(t); }); } catch (e) { console.error(e); }
}
init();
