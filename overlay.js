// overlay.js - runs the hand tracker in the transparent click-through overlay (always, so Settings
// has live data) and turns gestures into intents for the main process (window.hand from preload).
//  - Core pointer: pinch point moves the cursor through the comfort box; quick pinch = click; held pinch = drag.
//  - Bindings (config): pose (+hand) held holdMs -> trigger action once / engage continuous action.
// No input is sent unless control is enabled and not paused (togglePause works while paused).
import { createHandTracker } from './tracking.js';

const api = window.hand;
const video = document.getElementById('cam');
const canvas = document.getElementById('ink');
const ctx = canvas.getContext('2d');
const chip = document.getElementById('chip');
const label = document.getElementById('label');
const hint = document.getElementById('hint');

// ---------- Tuning (user-facing values come from config) ----------
const DRAG_MOVE = 0.02;        // normalised move during pinch that starts a drag early
const PRE_FREEZE = 0.5;        // pinchStrength above this (not yet pinched) freezes the cursor...
const PRE_FREEZE_MAX_MS = 300; // ...for at most this long
const SCROLL_PX = 28;          // vertical palm movement (px) per wheel notch at speed 1
const MOVE_EPS = 0.0004;       // ignore sub-pixel jitter
const DROPOUT_MS = 150;        // a binding's pose may vanish this long without releasing
const TELEMETRY_MS = 33;       // ~30 Hz to Settings (only while it is open)
const POINTER_POSES = new Set(['pinch', 'point', 'none']);
const CONTINUOUS = new Set(['moveWindow', 'scroll']);

// ---------- State ----------
const st = { enabled: false, paused: true, mouseOk: true, mouseError: null, settingsOpen: false, track: 'camera', trackDetail: '' };
let cfg = {
  primaryHand: 'Right', comfortBox: { w: 0.7, h: 0.6 }, cursorSmoothing: 0.5, clickMaxMs: 250, bindings: [],
};
let wasPinch = false, pinchStart = 0, pinchPos = null, dragging = false, pinchIgnored = false;
let preFreezeStart = 0;
let lastSent = null, cursor = null, smooth = null, hadHand = false;
let cur = null;              // active binding candidate: { b, handId, since, lastSeen, engaged, fired, anchor, sent }
const lastFired = new Map(); // binding id -> time
let lastHands = [];
let flash = null;            // { name, at } briefly shown on the chip after a trigger fires

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const send = (msg) => { if (api) api.send(msg); };
const ready = () => st.track === 'ready';
const active = () => st.enabled && !st.paused && st.mouseOk && ready();
const isContinuous = (b) => !!b && CONTINUOUS.has(b.action && b.action.type);

// Pose with graceful fallback if tracking.js doesn't provide `pose` yet.
function poseOf(h) {
  if (typeof h.pose === 'string') return h.pose;
  if (h.pinch) return 'pinch';
  return ['fist', 'open', 'point'].includes(h.gesture) ? h.gesture : 'none';
}
// Palm centre (middle-finger MCP) is steadier than the pinch point for whole-hand motion.
const palm = (h) => (h.landmarks && h.landmarks[9] ? { x: h.landmarks[9].x, y: h.landmarks[9].y } : { x: h.x, y: h.y });

function box() {
  const w = cfg.comfortBox && cfg.comfortBox.w || 0.7, h = cfg.comfortBox && cfg.comfortBox.h || 0.6;
  return { x0: (1 - w) / 2, y0: (1 - h) / 2, w, h };
}

// ---------- Canvas ----------
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

function holdProgress() {
  if (!cur) return 0;
  if (cur.engaged || cur.fired) return 1;
  const ms = cur.b.holdMs || 0;
  return ms <= 0 ? 1 : clamp01((performance.now() - cur.since) / ms);
}

function draw() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  if (!cursor || !st.enabled) return;
  const x = cursor.u * innerWidth, y = cursor.v * innerHeight;
  const on = active();
  const engagedType = cur && cur.engaged ? cur.b.action.type : null;
  const color = !on ? '#a3acbb' : dragging ? '#fb923c' : engagedType === 'moveWindow' ? '#c4b5fd' : engagedType === 'scroll' ? '#93c5fd' : '#5eead4';
  const small = wasPinch || dragging;
  const r = small ? 11 : 16;

  // Glassy ring: soft translucent disc + light rim + coloured stroke.
  ctx.globalAlpha = on ? 1 : 0.65;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = on ? 10 : 0;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  if (small) { ctx.fillStyle = color; ctx.globalAlpha = 0.35; ctx.fill(); }

  // Hold progress for the pending binding.
  const p = cur && !cur.engaged && !cur.fired ? holdProgress() : 0;
  if (p > 0) {
    ctx.globalAlpha = 0.25; ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.95; ctx.strokeStyle = cur.b.action.type === 'togglePause' ? '#fbbf24' : '#5eead4';
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
    ctx.lineCap = 'butt';
  }
  ctx.globalAlpha = 1;
}

// ---------- Status chip ----------
function renderChip() {
  chip.className = '';
  if (!st.enabled) { chip.classList.add('hidden'); return; }
  let text, sub = '';
  const now = performance.now();
  if (!st.mouseOk) { chip.classList.add('error'); text = 'Mouse control unavailable'; sub = String(st.mouseError || '').slice(0, 120); }
  else if (st.track === 'camera') { text = 'Starting camera...'; }
  else if (st.track === 'loading') { text = 'Loading hand model...'; sub = 'needs internet'; }
  else if (st.track === 'denied') { chip.classList.add('error'); text = 'Camera blocked'; sub = 'check Windows camera privacy settings'; }
  else if (st.track === 'error') { chip.classList.add('error'); text = 'Tracking error'; sub = String(st.trackDetail || '').slice(0, 120); }
  else if (st.paused) {
    chip.classList.add('paused');
    text = cur && cur.b.action.type === 'togglePause' ? `${cur.b.name}...` : 'Paused';
    const pb = cfg.bindings.find((b) => b.enabled && b.action.type === 'togglePause');
    sub = `${pb ? `hold ${pb.pose} to resume, or ` : ''}Ctrl+Alt+P | Ctrl+Alt+H off`;
  } else if (cur) {
    chip.classList.add('busy');
    text = cur.engaged ? cur.b.name : cur.fired ? `${cur.b.name} ✓` : `${cur.b.name}...`;
  } else if (flash && now - flash.at < 900) {
    chip.classList.add('busy'); text = `${flash.name} ✓`;
  } else {
    chip.classList.add('active');
    text = dragging ? 'Dragging' : hadHand ? 'Active' : 'Active - no hand';
    sub = 'pinch click/drag | Ctrl+Alt+P pause';
  }
  label.textContent = text;
  hint.textContent = sub;
}

// ---------- Bindings ----------
function findMatch(hands, b) {
  if (!b || !b.enabled || !b.action || b.action.type === 'none' || b.pose === 'none') return null;
  return hands.find((h) => (b.hand === 'any' || h.id === b.hand) && poseOf(h) === b.pose) || null;
}

function endBinding() {
  if (!cur) return;
  if (cur.engaged && cur.b.action.type === 'moveWindow') send({ type: 'grab', phase: 'end' });
  cur = null;
}

// Allowed to fire / engage right now?
function allowed(b) {
  if (!st.enabled || !ready()) return false;
  if (b.action.type === 'togglePause') return true;
  return active();
}

function updateBindings(hands, now) {
  // Keep the current binding while its pose holds (with a short dropout grace).
  let hand = null;
  if (cur) {
    const fresh = cfg.bindings.find((b) => b.id === cur.b.id);
    if (!fresh || !fresh.enabled) endBinding();
    else {
      cur.b = fresh;
      hand = findMatch(hands, fresh);
      if (hand) { cur.lastSeen = now; cur.handId = hand.id; }
      else if (now - cur.lastSeen > DROPOUT_MS) endBinding();
    }
  }
  if (!cur) {
    for (const b of cfg.bindings) {
      const h = findMatch(hands, b);
      if (h) { cur = { b, handId: h.id, since: now, lastSeen: now, engaged: false, fired: false, anchor: null, sent: { du: 0, dv: 0 }, scrollAcc: 0 }; hand = h; break; }
    }
  }
  if (!cur) return;

  const b = cur.b;
  const held = now - cur.since >= (b.holdMs || 0);
  if (!isContinuous(b)) {
    if (held && !cur.fired && allowed(b) && now - (lastFired.get(b.id) || -1e9) >= (b.cooldownMs || 0)) {
      cur.fired = true;
      lastFired.set(b.id, now);
      flash = { name: b.name, at: now };
      if (b.action.type === 'togglePause') send({ type: 'togglePause', name: b.name });
      else send({ type: 'action', id: b.id });
    }
    return;
  }

  // Continuous actions.
  if (cur.engaged && !active()) { endBinding(); return; }
  if (!cur.engaged) {
    if (!held || !allowed(b) || !hand) return;
    cur.engaged = true;
    cur.anchor = palm(hand);
    if (b.action.type === 'moveWindow') send({ type: 'grab', phase: 'start', name: b.name });
    return;
  }
  if (!hand) return; // dropout frame: hold still
  const p = palm(hand), bx = box();
  if (b.action.type === 'moveWindow') {
    const du = (p.x - cur.anchor.x) / innerWidth / bx.w, dv = (p.y - cur.anchor.y) / innerHeight / bx.h;
    if (Math.abs(du - cur.sent.du) > MOVE_EPS || Math.abs(dv - cur.sent.dv) > MOVE_EPS) {
      cur.sent = { du, dv };
      send({ type: 'grab', phase: 'move', du, dv });
      if (cursor) cursor = { u: clamp01(cursor.u + du - (cur.prevDu || 0)), v: clamp01(cursor.v + dv - (cur.prevDv || 0)) };
      cur.prevDu = du; cur.prevDv = dv;
    }
  } else if (b.action.type === 'scroll') {
    const step = SCROLL_PX / Math.max(0.1, b.action.speed || 1);
    const ticks = Math.trunc((p.y - cur.anchor.y) / step);
    if (ticks !== 0) { cur.anchor.y += ticks * step; send({ type: 'scroll', ticks }); }
  }
}

// ---------- Pointer ----------
function releasePointer() {
  if (dragging) send({ type: 'up' });
  dragging = false; wasPinch = false; pinchPos = null; preFreezeStart = 0; pinchIgnored = false;
}

function handLost() {
  endBinding();
  send({ type: 'release' }); // main releases any held button / window grab even when paused
  releasePointer();
  hadHand = false; cursor = null; smooth = null;
  draw();
  renderChip();
}

function onUpdate(hands) {
  lastHands = hands;
  const now = performance.now();
  if (!hands.length) { if (hadHand) handLost(); return; } // no work when no hands

  updateBindings(hands, now);

  const hand = hands.find((h) => h.id === cfg.primaryHand) || (hands.length === 1 ? hands[0] : null);
  if (!hand) { if (hadHand) { releasePointer(); hadHand = false; cursor = null; draw(); renderChip(); } return; }
  const firstFrame = !hadHand;
  hadHand = true;

  const bx = box();
  const ru = clamp01((hand.x / innerWidth - bx.x0) / bx.w);
  const rv = clamp01((hand.y / innerHeight - bx.y0) / bx.h);
  // Extra smoothing on top of the tracker's One Euro filter (0 = none).
  const a = 1 - 0.8 * clamp01(Number(cfg.cursorSmoothing) || 0);
  smooth = !smooth || firstFrame ? { u: ru, v: rv } : { u: smooth.u + a * (ru - smooth.u), v: smooth.v + a * (rv - smooth.v) };
  const { u, v } = smooth;

  const on = active();
  const pinch = !!hand.pinch;
  // Clicking (and pointer motion) is suppressed while a binding holds or a non-pointer pose is up.
  const suppress = !!cur || !POINTER_POSES.has(poseOf(hand));
  const engaged = !!(cur && cur.engaged);
  let freeze = suppress;

  if (suppress) {
    if (dragging) { send({ type: 'up' }); dragging = false; }
    if (pinch) pinchIgnored = true;
    preFreezeStart = 0;
  } else {
    // Pre-pinch freeze: fingers closing in nudges the midpoint, so hold the cursor still briefly.
    if (!pinch && !dragging && hand.pinchStrength > PRE_FREEZE) {
      if (!preFreezeStart) preFreezeStart = now;
      if (now - preFreezeStart < PRE_FREEZE_MAX_MS) freeze = true;
    } else if (!pinch) preFreezeStart = 0;

    if (pinch && !pinchIgnored) {
      if (!wasPinch) { pinchStart = now; pinchPos = { u, v }; }
      const heldMs = now - pinchStart;
      const moved = pinchPos ? Math.hypot(u - pinchPos.u, v - pinchPos.v) : 0;
      if (!dragging && (heldMs >= (cfg.clickMaxMs || 250) || moved > DRAG_MOVE)) {
        dragging = true;
        if (on) send({ type: 'down' }); // pressed at the frozen position
      }
      if (!dragging) freeze = true; // freeze until it is clearly a drag
    } else if (wasPinch && !pinch && !pinchIgnored) {
      if (dragging) send({ type: 'up' });
      else if (on) send({ type: 'click' }); // quick pinch; two quick pinches = OS double click (cursor frozen)
      dragging = false; pinchPos = null;
      preFreezeStart = now; freeze = true; // also hold still for the release frame
    }
  }
  if (!pinch) pinchIgnored = false;
  wasPinch = pinch;

  if (!engaged || cur.b.action.type !== 'moveWindow') {
    if (!freeze || firstFrame || !cursor) cursor = { u, v };
  }
  if (on && !freeze && !engaged && (!lastSent || Math.abs(u - lastSent.u) > MOVE_EPS || Math.abs(v - lastSent.v) > MOVE_EPS)) {
    send({ type: 'move', u, v }); // at most once per video frame
    lastSent = { u, v };
  }
  draw();
  renderChip();
}

// ---------- Telemetry (only while Settings is open) ----------
setInterval(() => {
  if (!api || !st.settingsOpen) return;
  api.telemetry({
    status: st.track,
    hands: lastHands.map((h) => ({
      // overlay px == primary-display DIP (Settings divides by screen.width)
      id: h.id, x: h.x, y: h.y, pose: poseOf(h), fingers: h.fingers || null,
      pinch: !!h.pinch, pinchStrength: h.pinchStrength || 0, metrics: h.metrics || null,
      lm:Array.isArray(h.landmarks) ? h.landmarks.map((p) => [Math.round(p.x), Math.round(p.y)]) : null,
    })),
    activeBinding: cur ? cur.b.id : null,
    holdProgress: holdProgress(),
  });
}, TELEMETRY_MS);

// Re-render the chip so trigger flashes expire even without hand frames.
setInterval(() => { if (st.enabled) renderChip(); }, 300);

// ---------- Wiring ----------
function applyState(s) {
  if (!s) return;
  const wasActive = active();
  Object.assign(st, s);
  // Drop engaged continuous actions; keep trigger holds so e.g. the pause pose doesn't re-arm and toggle back.
  if (wasActive && !active()) { if (cur && cur.engaged) endBinding(); releasePointer(); }
  updatePower();
  draw();
  renderChip();
}

// Power policy: the camera only runs when something needs it.
//  - control off and Settings closed  -> camera released (nothing can use hand data)
//  - control on but paused            -> 12 fps (only needs to see the resume pose)
//  - control on / Settings open       -> full rate (tracker drops to ~6 fps by itself when no hand is in view)
function updatePower() {
  if (!tracker || !tracker.setActive) return;
  const needed = st.enabled || st.settingsOpen;
  tracker.setActive(needed);
  if (tracker.setMaxFps) tracker.setMaxFps(st.enabled && st.paused && !st.settingsOpen ? 12 : 30);
}
let tracker = null;
function applyConfig(c) {
  if (!c || !Array.isArray(c.bindings)) return;
  cfg = c;
  if (tracker && tracker.setTuning && c.poseTuning) tracker.setTuning(c.poseTuning);
}

if (api) {
  api.onState(applyState);
  api.onConfig(applyConfig);
  api.getState().then(applyState).catch(() => {});
  api.getConfig().then(applyConfig).catch(() => {});
} else {
  st.mouseOk = false; st.mouseError = 'preload bridge missing';
}
renderChip();

createHandTracker(video, {
  onUpdate,
  tuning: cfg && cfg.poseTuning,
  onStatus(status, detail) {
    st.track = status; st.trackDetail = detail || '';
    if (status === 'error') console.error('tracking error:', detail);
    renderChip();
  },
}).then((t) => {
  tracker = t;
  if (cfg && cfg.poseTuning && t.setTuning) t.setTuning(cfg.poseTuning);
  updatePower();
});
