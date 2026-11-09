// Config: defaults, validation/migration, load/save of userData/config.json (CONTRACT.md section 2).
const fs = require('fs');
const path = require('path');

const VERSION = 2;
const POSE_IDS = ['open', 'fist', 'point', 'two', 'three', 'thumb', 'rock', 'call', 'L', 'pinky', 'pinch', 'none'];
const HANDS = ['any', 'Left', 'Right'];
const MEDIA_KEYS = ['playpause', 'next', 'prev', 'volup', 'voldown', 'mute'];
const MOUSE_BUTTONS = ['right', 'double', 'middle'];
const ACTION_TYPES = ['media', 'keys', 'launch', 'mouse', 'togglePause', 'moveWindow', 'scroll', 'none'];
const CONTINUOUS = new Set(['moveWindow', 'scroll']);

const DEFAULT_BINDINGS = [
  { id: 'move-window', enabled: true, name: 'Move window', pose: 'fist', hand: 'any', holdMs: 250, cooldownMs: 1000, action: { type: 'moveWindow' } },
  { id: 'play-pause', enabled: true, name: 'Play / pause', pose: 'two', hand: 'any', holdMs: 500, cooldownMs: 1000, action: { type: 'media', key: 'playpause' } },
  { id: 'scroll', enabled: true, name: 'Scroll', pose: 'three', hand: 'any', holdMs: 500, cooldownMs: 1000, action: { type: 'scroll', speed: 1 } },
  { id: 'next-track', enabled: true, name: 'Next track', pose: 'thumb', hand: 'any', holdMs: 500, cooldownMs: 1000, action: { type: 'media', key: 'next' } },
  { id: 'prev-track', enabled: true, name: 'Previous track', pose: 'pinky', hand: 'any', holdMs: 500, cooldownMs: 1000, action: { type: 'media', key: 'prev' } },
  { id: 'toggle-pause', enabled: true, name: 'Pause / resume', pose: 'open', hand: 'any', holdMs: 1600, cooldownMs: 1000, action: { type: 'togglePause' } },
  { id: 'show-desktop', enabled: false, name: 'Show desktop', pose: 'call', hand: 'any', holdMs: 500, cooldownMs: 1000, action: { type: 'keys', combo: 'Win+D' } },
];

// Per-pose detection thresholds (see tracking.js classifyPose). Must match DEFAULT_TUNING there.
const TUNED_POSES = ['open', 'fist', 'point', 'two', 'three', 'thumb', 'rock', 'call', 'L', 'pinky'];
const BASE_TUNING = { up: 1.15, down: 1.15, thumb: 0.55, frames: 3 };
const DEFAULT_TUNING = Object.fromEntries(TUNED_POSES.map((id) => [id, { ...BASE_TUNING }]));
DEFAULT_TUNING.open = { up: 1.25, down: 1.15, thumb: 0.75, frames: 3, spread: 0.95 };

const DEFAULTS = {
  version: VERSION,
  enabled: false,
  primaryHand: 'Right',
  comfortBox: { w: 0.7, h: 0.6 },
  cursorSmoothing: 0.5,
  clickMaxMs: 250,
  bindings: DEFAULT_BINDINGS,
  poseTuning: DEFAULT_TUNING,
};

function validateTuning(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const id of TUNED_POSES) {
    const t = src[id] && typeof src[id] === 'object' ? src[id] : {};
    const d = DEFAULT_TUNING[id];
    out[id] = {
      up: num(t.up, 1.0, 1.6, d.up),
      down: num(t.down, 0.8, 1.4, d.down),
      thumb: num(t.thumb, 0.3, 1.2, d.thumb),
      frames: Math.round(num(t.frames, 1, 15, d.frames)),
    };
    if ('spread' in d) out[id].spread = num(t.spread, 0.5, 1.5, d.spread);
  }
  return out;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const str = (v, def, max = 200) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : def);
const oneOf = (v, list, def) => (list.includes(v) ? v : def);

// Imported lazily to avoid a cycle; input.js owns the key-name table.
function comboValid(combo) {
  try { return require('./input').parseCombo(combo).ok; } catch { return typeof combo === 'string' && combo.length > 0; }
}

function validateAction(a) {
  if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.type)) return { type: 'none' };
  switch (a.type) {
    case 'media': return { type: 'media', key: oneOf(a.key, MEDIA_KEYS, 'playpause') };
    case 'keys': {
      const combo = typeof a.combo === 'string' ? a.combo.trim().slice(0, 60) : '';
      return { type: 'keys', combo: comboValid(combo) ? combo : '' };
    }
    case 'launch': return { type: 'launch', target: typeof a.target === 'string' ? a.target.trim().slice(0, 1000) : '' };
    case 'mouse': return { type: 'mouse', button: oneOf(a.button, MOUSE_BUTTONS, 'right') };
    case 'scroll': return { type: 'scroll', speed: num(a.speed, 0.1, 5, 1) };
    default: return { type: a.type };
  }
}

function validateBinding(b, i, usedIds) {
  if (!b || typeof b !== 'object') return null;
  let id = str(b.id, `binding-${i + 1}`, 64);
  while (usedIds.has(id)) id = `${id}-${i + 1}`;
  usedIds.add(id);
  return {
    id,
    enabled: typeof b.enabled === 'boolean' ? b.enabled : true,
    name: str(b.name, 'Gesture', 60),
    pose: oneOf(b.pose, POSE_IDS, 'none'),
    hand: oneOf(b.hand, HANDS, 'any'),
    holdMs: Math.round(num(b.holdMs, 0, 10000, 500)),
    cooldownMs: Math.round(num(b.cooldownMs, 0, 60000, 1000)),
    action: validateAction(b.action),
  };
}

// Any input -> a complete, valid config. Unknown/invalid fields fall back to defaults per field.
function validate(input) {
  const c = input && typeof input === 'object' ? input : {};
  const d = DEFAULTS;
  const box = c.comfortBox && typeof c.comfortBox === 'object' ? c.comfortBox : {};
  const usedIds = new Set();
  const bindings = Array.isArray(c.bindings)
    ? c.bindings.slice(0, 64).map((b, i) => validateBinding(b, i, usedIds)).filter(Boolean)
    : clone(d.bindings);
  return {
    version: VERSION,
    enabled: typeof c.enabled === 'boolean' ? c.enabled : d.enabled,
    primaryHand: oneOf(c.primaryHand, ['Right', 'Left'], d.primaryHand),
    comfortBox: { w: num(box.w, 0.2, 1, d.comfortBox.w), h: num(box.h, 0.2, 1, d.comfortBox.h) },
    cursorSmoothing: num(c.cursorSmoothing, 0, 1, d.cursorSmoothing),
    clickMaxMs: Math.round(num(c.clickMaxMs, 80, 1000, d.clickMaxMs)),
    bindings,
    poseTuning: validateTuning(c.poseTuning),
  };
}

// Older / missing versions: v1 never had a config file, so anything without version 2 is re-validated from defaults.
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return clone(DEFAULTS);
  if (raw.version !== VERSION) return validate({ ...clone(DEFAULTS), ...raw, bindings: Array.isArray(raw.bindings) ? raw.bindings : undefined });
  return validate(raw);
}

function load(file) {
  try {
    return migrate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[hand] config unreadable, using defaults:', e.message);
    return clone(DEFAULTS);
  }
}

function save(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, file);
}

// Built-in poses (mirrors tracking.js POSES, CONTRACT section 1) for hand.getPoses().
const F = (t, i, m, r, p) => ({ thumb: !!t, index: !!i, middle: !!m, ring: !!r, pinky: !!p });
const POSES = [
  { id: 'open', label: 'Open palm', fingers: F(1, 1, 1, 1, 1) },
  { id: 'fist', label: 'Fist', fingers: F(0, 0, 0, 0, 0) },
  { id: 'point', label: 'Point', fingers: F(0, 1, 0, 0, 0) },
  { id: 'two', label: 'Two (V)', fingers: F(0, 1, 1, 0, 0) },
  { id: 'three', label: 'Three', fingers: F(0, 1, 1, 1, 0) },
  { id: 'thumb', label: 'Thumbs up', fingers: F(1, 0, 0, 0, 0) },
  { id: 'rock', label: 'Rock', fingers: F(0, 1, 0, 0, 1) },
  { id: 'call', label: 'Call me', fingers: F(1, 0, 0, 0, 1) },
  { id: 'L', label: 'L', fingers: F(1, 1, 0, 0, 0) },
  { id: 'pinky', label: 'Pinky', fingers: F(0, 0, 0, 0, 1) },
];

module.exports = {
  VERSION, DEFAULTS, POSE_IDS, ACTION_TYPES, CONTINUOUS, POSES, validateAction,
  defaults: () => clone(DEFAULTS), validate, migrate, load, save,
  isContinuous: (action) => !!action && CONTINUOUS.has(action.type),
};
