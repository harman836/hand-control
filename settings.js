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
function defaultConfig() {
  const b = (id, pose, name, action, extra = {}) => ({ id, enabled: true, name, pose, hand: 'any', holdMs: 500, cooldownMs: 1000, action, ...extra });
  return {
    version: 2, enabled: false, primaryHand: 'Right', comfortBox: { w: 0.7, h: 0.6 }, cursorSmoothing: 0.5, clickMaxMs: 250,
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
    if (pose !== 'none') {
      const p = poseById(pose);
      hands.push({
        id: 'Right', x: sw * (0.55 + 0.25 * Math.sin(t * 0.7)), y: sh * (0.5 + 0.28 * Math.sin(t * 1.1 + 1)),
        pose, fingers: p ? { ...p.fingers } : {}, pinch: pose === 'pinch', pinchStrength: pose === 'pinch' ? 0.9 : 0.1,
      });
      if (pose === 'open' || pose === 'L') {
        hands.push({ id: 'Left', x: sw * (0.25 + 0.08 * Math.sin(t)), y: sh * 0.6, pose: 'fist', fingers: { ...poseById('fist').fingers }, pinch: false, pinchStrength: 0 });
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
    const handTag = b.hand === 'any' ? 'Either hand' : b.hand + ' hand';
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
const PTR_FMT = { boxW: pct, boxH: pct, smooth: (v) => (v <= 0.05 ? 'Off' : pct(v)), clickMax: (v) => v + ' ms' };
function renderPointer() {
  const el = $('#pointer');
  el.innerHTML = `
    <div class="fields">
      <div class="field"><span class="flabel">Pointer hand</span>
        <div class="seg" role="group" aria-label="Pointer hand">
          ${['Right', 'Left'].map((h) => `<button data-primary="${h}" aria-pressed="${cfg.primaryHand === h}">${h} hand</button>`).join('')}
        </div>
      </div>
      ${rangeHTML('boxW', 'Comfort box width', 0.3, 1, 0.05, cfg.comfortBox.w, PTR_FMT.boxW)}
      ${rangeHTML('boxH', 'Comfort box height', 0.3, 1, 0.05, cfg.comfortBox.h, PTR_FMT.boxH)}
      ${rangeHTML('smooth', 'Cursor smoothing', 0, 1, 0.05, cfg.cursorSmoothing, PTR_FMT.smooth)}
      ${rangeHTML('clickMax', 'Max click duration', 100, 600, 10, cfg.clickMaxMs, PTR_FMT.clickMax)}
    </div>
    <div class="box-preview">
      <div class="box-frame"><div class="box-rect" id="boxRect"></div></div>
      <div class="box-caption">Area of the camera view that maps to your whole screen. Smaller = less arm movement.</div>
    </div>`;
  updateBoxPreview();
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
    <div class="sheet-head">
      <div class="pose-icon">${poseSVG(b.pose)}</div>
      <h3 id="edTitle">${esc(b.name || 'Gesture')}</h3>
      <button class="switch" role="switch" aria-checked="${b.enabled}" data-ed="enabled" aria-label="Enabled"></button>
      <button class="btn ghost icon-btn" data-ed="close" aria-label="Close editor">×</button>
    </div>
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
    <div class="sheet-foot">
      <div class="test-result" id="testResult" aria-live="polite"></div>
      <button class="btn primary" data-ed="test"${a.type === 'none' ? ' disabled' : ''}>Test action</button>
      <button class="btn" data-ed="dup">Duplicate</button>
      <span class="spacer"></span>
      ${deleteArmed
        ? `<button class="btn ghost sm" data-ed="delCancel">Keep</button><button class="btn danger armed sm" data-ed="delConfirm">Delete gesture</button>`
        : `<button class="btn ghost danger" data-ed="del">Delete</button>`}
    </div>`;
  $('#sheet [data-ed="enabled"]').innerHTML = '<i></i>';
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
  editingId = id; deleteArmed = false; stopRecording(false);
  renderEditor(); renderList();
  const sheet = $('#sheet');
  sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('open');
  setTimeout(() => { const n = $('#ed-name'); n && n.focus({ preventScroll: true }); }, 60);
}
function closeEditor() {
  const prev = editingId;
  editingId = null; deleteArmed = false; stopRecording(false);
  const sheet = $('#sheet');
  sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('open');
  renderList();
  const row = prev && document.querySelector(`.row[data-id="${CSS.escape(prev)}"]`);
  row && row.focus({ preventScroll: true });
}
function refreshAfterEdit(rerenderEditor = true) {
  if (rerenderEditor) {
    const sc = $('#sheetBody').scrollTop;
    renderEditor();
    $('#sheetBody').scrollTop = sc;
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

// ---------- live camera feed + skeleton ----------
// The overlay's landmarks are in screen DIP, cover-fitted to the screen's aspect. Giving the stage the
// same aspect and cover-fitting this video the same way makes them line up after dividing by screen size.
(function initStageCam() {
  const stage = $('#stage'), video = $('#stageCam');
  if (!stage || !video) return;
  stage.style.aspectRatio = `${screen.width || 16} / ${screen.height || 9}`;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false })
    .then((stream) => {
      video.srcObject = stream;
      video.play().catch(() => {});
      stage.classList.add('cam-on');
      window.addEventListener('beforeunload', () => stream.getTracks().forEach((tr) => tr.stop()));
    })
    .catch((err) => console.warn('Live view camera unavailable:', err && err.name));
})();

const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawSkeletons(hands, sw, sh) {
  const cv = $('#stageSkel');
  if (!cv) return;
  const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const h of hands) {
    if (!Array.isArray(h.lm) || h.lm.length < 21) continue;
    const pts = h.lm.map(([x, y]) => [x / sw * W, y / sh * H]);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 4;
    ctx.beginPath();
    for (const [a, b] of BONES) { ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); }
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let i = 0; i < 21; i++) {
      const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.fillStyle = tip ? 'rgba(120,170,255,0.95)' : 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], tip ? 4 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
}

const markers = new Map();
function renderTelemetry(t) {
  telem = t;
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

  // hands on stage
  const stage = $('#stage');
  const hands = Array.isArray(t.hands) ? t.hands : [];
  stage.classList.toggle('has-hands', hands.length > 0);
  const sw = Math.max(screen.width || 1920, 1), sh = Math.max(screen.height || 1080, 1);
  const W = stage.clientWidth, H = stage.clientHeight;
  const seen = new Set();
  hands.forEach((h, i) => {
    const key = h.id ?? ('h' + i);
    seen.add(key);
    let m = markers.get(key);
    if (!m) {
      m = document.createElement('div');
      m.className = 'hand-marker';
      m.innerHTML = '<div class="hand-bubble"><span class="g"></span><i class="pinch-dot"></i></div><span class="tag"></span>';
      stage.appendChild(m); markers.set(key, m);
    }
    const x = clamp((+h.x || 0) / sw, 0, 1) * W, y = clamp((+h.y || 0) / sh, 0, 1) * H;
    m.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const isLeft = /left/i.test(String(h.id));
    m.classList.toggle('left', isLeft);
    m.classList.toggle('pinch', !!h.pinch);
    const pose = h.pose || 'none';
    const sig = pose + '|' + fingerList(h.fingers).join(',') + '|' + !!h.pinch;
    if (m.dataset.sig !== sig) {
      m.dataset.sig = sig;
      const known = poseById(pose);
      m.querySelector('.g').innerHTML = pose === 'pinch' || h.pinch ? poseSVG('pinch')
        : known && known.fingers ? poseSVG(pose) : handSVG(h.fingers || null);
      m.querySelector('.tag').textContent = (h.id ? h.id + ' · ' : '') + (pose === 'none' ? fingerList(h.fingers).length + ' up' : poseLabel(pose));
    }
  });
  for (const [k, m] of markers) if (!seen.has(k)) { m.remove(); markers.delete(k); }
  drawSkeletons(hands, sw, sh);

  // readout
  const active = t.activeBinding ? cfg && cfg.bindings.find((b) => b.id === t.activeBinding) : null;
  const focusHand = (active && hands.find((h) => h.pose === active.pose)) || hands.find((h) => h.id === (cfg && cfg.primaryHand)) || hands[0];
  const pose = focusHand ? (focusHand.pinch ? 'pinch' : focusHand.pose || 'none') : null;
  const ringIcon = $('#ringIcon');
  if (ringIcon.dataset.pose !== String(pose)) {
    ringIcon.dataset.pose = String(pose);
    ringIcon.innerHTML = pose ? (poseById(pose) && poseById(pose).fingers ? poseSVG(pose) : handSVG(focusHand.fingers || null)) : handSVG(null);
  }
  $('#poseName').textContent = !hands.length ? 'No hands' : pose === 'none' ? 'No pose' : poseLabel(pose);
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
  $('#pointer').addEventListener('click', (e) => {
    const t = e.target.closest('[data-primary]'); if (!t) return;
    cfg.primaryHand = t.dataset.primary;
    document.querySelectorAll('[data-primary]').forEach((x) => x.setAttribute('aria-pressed', String(x === t)));
    scheduleSave();
  });
  const sheet = $('#sheet');
  sheet.addEventListener('click', onSheetClick);
  sheet.addEventListener('input', onSheetInput);
  sheet.addEventListener('change', onSheetChange);
  $('#scrim').addEventListener('click', closeEditor);
  document.addEventListener('pointerdown', (e) => { if (recording && !e.target.closest('#rec')) stopRecording(true); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !recording && editingId) closeEditor(); });

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
