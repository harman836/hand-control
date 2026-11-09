// dashboard.js - cards, physics, input (hands or mouse) and the overlay, in one rAF loop.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = motionQuery.matches;
motionQuery.addEventListener?.('change', (e) => { reduceMotion = e.matches; });

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const video = $('#cam');
const overlay = $('#overlay');
const octx = overlay.getContext('2d');
let VW = innerWidth, VH = innerHeight, DPR = 1;

// ======================================================================
// Status + tracking
// ======================================================================
const statusEl = $('#status');
const STATUS_TEXT = {
  init: 'Starting',
  camera: 'Requesting camera',
  loading: 'Loading hand model',
  ready: 'Tracking',
  denied: 'Camera blocked · mouse mode',
  error: 'Tracking unavailable · mouse mode',
};
let trackStatus = 'init';
let trackedHands = [];
let lastHandsAt = 0;
let trackerFrames = 0;

function setStatus(s, detail) {
  trackStatus = s;
  statusEl.dataset.state = s;
  $('.status-text', statusEl).textContent = STATUS_TEXT[s] || s;
  statusEl.title = detail ? String(detail) : '';
  const mouseMode = s !== 'ready';
  document.body.classList.toggle('mouse-mode', mouseMode);
  document.body.classList.toggle('cam-live', s === 'ready');
  $('#helpMode').textContent = mouseMode ? 'mouse mode' : 'camera mode';
}
setStatus('init');

async function startTracking() {
  try {
    const { createHandTracker } = await import('./tracking.js');
    await createHandTracker(video, {
      onUpdate(hands) {
        trackedHands = Array.isArray(hands) ? hands : [];
        lastHandsAt = performance.now();
        trackerFrames++;
      },
      onStatus(s, detail) { setStatus(s, detail); },
    });
  } catch (err) {
    console.warn('[dashboard] hand tracking unavailable, using mouse:', err);
    setStatus('error', err && err.message);
  }
}

// ======================================================================
// Mouse as a virtual hand
// ======================================================================
const mouse = { x: VW / 2, y: VH / 2, down: false, latch: false, strength: 0, movedAt: 0, seen: false };
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.movedAt = performance.now(); mouse.seen = true;
}, { passive: true });
addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.movedAt = performance.now(); mouse.seen = true;
  if (e.target.closest('textarea')) return; // let the notes field behave natively
  if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') document.activeElement.blur();
  e.preventDefault();
  mouse.down = true;
  mouse.latch = true; // guarantees a quick click is seen for at least one frame
  unlockAudio();
});
addEventListener('pointerup', () => { mouse.down = false; });
addEventListener('pointercancel', () => { mouse.down = false; });
addEventListener('blur', () => { mouse.down = false; });
addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.target.closest && e.target.closest('textarea')) return;
  if (e.key === 't' || e.key === 'T') tidy();
});

// Wheel: mouse substitute for the two-hand scale/rotate.
addEventListener('wheel', (e) => {
  const cardEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.card');
  if (!cardEl) return;
  e.preventDefault();
  const c = cardByEl.get(cardEl);
  c.settle = null;
  if (e.shiftKey) c.rot = clamp(c.rot + Math.sign(e.deltaY || e.deltaX) * 0.06, -1, 1);
  else c.scale = clamp(c.scale * Math.exp(-e.deltaY * 0.0012), SCALE_MIN, SCALE_MAX);
}, { passive: false });

// ======================================================================
// Cards
// ======================================================================
const SCALE_MIN = 0.65, SCALE_MAX = 2.0;
let zTop = 10;
const cards = $$('.card').map((el, i) => {
  for (const pos of ['tl', 'tr', 'bl', 'br']) {
    const s = document.createElement('i');
    s.className = 'screw ' + pos;
    s.style.setProperty('--r', `${(i * 47 + pos.charCodeAt(1) * 13) % 180}deg`);
    el.appendChild(s);
  }
  el.style.zIndex = ++zTop;
  return { el, x: VW / 2, y: VH / 2, vx: 0, vy: 0, w: 0, h: 0, scale: 1, rot: 0, lift: 0,
    holders: [], two: null, hist: [], settle: null, tf: '' };
});
const cardByEl = new Map(cards.map((c) => [c.el, c]));

function measure() {
  for (const c of cards) { c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; }
}

function extents(c) {
  const s = c.scale * (1 + 0.04 * c.lift);
  const cos = Math.abs(Math.cos(c.rot)), sin = Math.abs(Math.sin(c.rot));
  return { hx: (c.w * cos + c.h * sin) * s / 2, hy: (c.w * sin + c.h * cos) * s / 2 };
}

function bringToFront(c) { c.el.style.zIndex = ++zTop; }

// Flow cards into centred rows; returns targets.
function layoutTargets() {
  const gap = 20, padX = 24, top = 72, bottom = 24;
  const maxW = VW - padX * 2;
  const rows = [];
  let row = { items: [], w: 0, h: 0 };
  for (const c of cards) {
    const w = c.w, h = c.h;
    if (row.items.length && row.w + gap + w > maxW) { rows.push(row); row = { items: [], w: 0, h: 0 }; }
    row.w += (row.items.length ? gap : 0) + w;
    row.h = Math.max(row.h, h);
    row.items.push(c);
  }
  if (row.items.length) rows.push(row);
  const totalH = rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1);
  const availH = VH - top - bottom;
  let y = top + Math.max(0, (availH - totalH) / 2);
  // If it does not fit, compress row spacing so cards overlap gently rather than leave the screen.
  const squeeze = totalH > availH && rows.length > 1 ? (totalH - availH) / (rows.length - 1) : 0;
  const out = new Map();
  for (const r of rows) {
    let x = (VW - r.w) / 2;
    for (const c of r.items) {
      out.set(c, { x: x + c.w / 2, y: y + c.h / 2 });
      x += c.w + gap;
    }
    y += r.h + gap - squeeze;
  }
  return out;
}

function tidy(instant = false) {
  const targets = layoutTargets();
  for (const c of cards) {
    if (c.holders.length) continue;
    const t = targets.get(c);
    if (instant || reduceMotion) {
      c.x = t.x; c.y = t.y; c.vx = c.vy = 0; c.scale = 1; c.rot = 0; c.settle = null;
    } else {
      c.settle = { x: t.x, y: t.y };
    }
  }
  flash = 1;
}

function writeTransform(c) {
  const s = c.scale * (1 + 0.04 * c.lift);
  const tf = `translate3d(${(c.x - c.w / 2).toFixed(1)}px,${(c.y - c.h / 2).toFixed(1)}px,0) rotate(${c.rot.toFixed(4)}rad) scale(${s.toFixed(4)})`;
  if (tf !== c.tf) { c.el.style.transform = tf; c.tf = tf; }
}

function stepCard(c, dt, now) {
  const held = c.holders.length > 0;
  c.lift = lerp(c.lift, held ? 1 : 0, 1 - Math.exp(-dt * 14));

  if (held) {
    if (c.holders.length === 1) {
      const h = c.holders[0];
      c.x = h.x + h.offX; c.y = h.y + h.offY;
    } else {
      const [a, b] = c.holders, t = c.two;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const d = Math.max(20, Math.hypot(b.x - a.x, b.y - a.y));
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      let da = ang - t.a0; da = Math.atan2(Math.sin(da), Math.cos(da));
      c.scale = clamp(t.s0 * d / t.d0, SCALE_MIN, SCALE_MAX);
      c.rot = clamp(t.r0 + da, -1.1, 1.1);
      c.x = mx + t.offX; c.y = my + t.offY;
    }
    c.hist.push({ t: now, x: c.x, y: c.y });
    while (c.hist.length > 2 && now - c.hist[0].t > 90) c.hist.shift();
  } else if (c.settle) {
    const k = 140, damp = 2 * Math.sqrt(k) * 0.95;
    c.vx += (k * (c.settle.x - c.x) - damp * c.vx) * dt;
    c.vy += (k * (c.settle.y - c.y) - damp * c.vy) * dt;
    c.x += c.vx * dt; c.y += c.vy * dt;
    const e = 1 - Math.exp(-dt * 8);
    c.scale = lerp(c.scale, 1, e); c.rot = lerp(c.rot, 0, e);
    if (Math.hypot(c.settle.x - c.x, c.settle.y - c.y) < 0.5 && Math.hypot(c.vx, c.vy) < 5) {
      c.x = c.settle.x; c.y = c.settle.y; c.vx = c.vy = 0; c.scale = 1; c.rot = 0; c.settle = null;
    }
  } else {
    c.x += c.vx * dt; c.y += c.vy * dt;
    const f = Math.exp(-dt * 3.0);
    c.vx *= f; c.vy *= f;
    if (Math.abs(c.vx) < 2) c.vx = 0;
    if (Math.abs(c.vy) < 2) c.vy = 0;
  }

  // Keep inside the viewport; bounce when free.
  const { hx, hy } = extents(c);
  const m = 6, rest = 0.55;
  const fit = (pos, half, size, vKey) => {
    if (half * 2 + m * 2 >= size) return size / 2;
    if (pos < half + m) { if (!held && c[vKey] < 0) c[vKey] = -c[vKey] * rest; return half + m; }
    if (pos > size - half - m) { if (!held && c[vKey] > 0) c[vKey] = -c[vKey] * rest; return size - half - m; }
    return pos;
  };
  if (!c.settle) {
    c.x = fit(c.x, hx, VW, 'vx');
    c.y = fit(c.y, hy, VH, 'vy');
  }
  writeTransform(c);
}

function grab(c, st) {
  if (c.holders.includes(st) || c.holders.length >= 2) return false;
  c.settle = null;
  c.holders.push(st);
  st.grab = c;
  if (c.holders.length === 1) {
    st.offX = c.x - st.x; st.offY = c.y - st.y;
    c.vx = c.vy = 0; c.hist = [];
    bringToFront(c);
    c.el.classList.add('is-held');
  } else {
    setupTwo(c);
  }
  return true;
}

function setupTwo(c) {
  const [a, b] = c.holders;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  c.two = {
    d0: Math.max(20, Math.hypot(b.x - a.x, b.y - a.y)),
    a0: Math.atan2(b.y - a.y, b.x - a.x),
    s0: c.scale, r0: c.rot, offX: c.x - mx, offY: c.y - my,
  };
}

function release(st) {
  const c = st.grab;
  if (!c) return;
  st.grab = null;
  c.holders = c.holders.filter((h) => h !== st);
  if (c.holders.length === 1) {
    const h = c.holders[0];
    h.offX = c.x - h.x; h.offY = c.y - h.y;
    c.two = null;
    return;
  }
  c.two = null;
  c.el.classList.remove('is-held');
  const hs = c.hist;
  if (hs.length >= 2) {
    const a = hs[0], b = hs[hs.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt > 0.012) {
      let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
      const sp = Math.hypot(vx, vy), cap = 3200;
      if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
      c.vx = vx; c.vy = vy;
    }
  }
  c.hist = [];
}

// ======================================================================
// Pressable controls (pinch tap)
// ======================================================================
const actions = {
  'timer-toggle': () => timer.toggle(),
  'timer-lap': () => timer.lap(),
  'timer-reset': () => timer.reset(),
  'interval': (el) => intervals.select(el),
  'shot': (el) => shuttle.shoot(el.dataset.shot),
  'linkage-toggle': () => linkage.toggle(),
  'linkage-trace': () => linkage.toggleTrace(),
  'tidy': () => tidy(),
  'help-close': () => setHelp(false),
  'help-open': () => setHelp(true),
};
function activate(el) {
  if (el.disabled) return;
  const fn = actions[el.dataset.press];
  if (fn) fn(el);
}
// Keyboard activation only (mouse/hand presses go through the input system).
for (const el of $$('[data-press]')) {
  el.addEventListener('click', (e) => { if (e.detail === 0) activate(el); });
}

// ======================================================================
// Help panel
// ======================================================================
const help = $('#help'), helpOpen = $('#helpOpen');
function setHelp(open) {
  help.hidden = !open;
  helpOpen.hidden = open;
  store.set('wb-help', open ? '1' : '0');
}
setHelp(store.get('wb-help', '1') === '1');

// ======================================================================
// Input processing: hands + mouse -> uniform "pointers"
// ======================================================================
const states = new Map(); // id -> { x, y, pinching, grab, press, offX, offY, palm, palmLock }
let palmUI = null; // { x, y, p } for drawing
let flash = 0;

function gatherInputs(now) {
  const out = [];
  const handsFresh = trackStatus === 'ready' && now - lastHandsAt < 500;
  if (handsFresh) for (const h of trackedHands) out.push({ ...h, source: 'camera' });
  const mouseActive = trackStatus !== 'ready' || (out.length === 0 && (mouse.down || now - mouse.movedAt < 3000));
  if (mouseActive && mouse.seen) {
    const pinch = mouse.down || mouse.latch;
    mouse.latch = false;
    out.push({ id: 'Mouse', x: mouse.x, y: mouse.y, pinch, pinchStrength: Math.max(mouse.strength, pinch ? 0.6 : 0),
      gesture: pinch ? 'pinch' : 'none', landmarks: null, source: 'mouse' });
  }
  return out;
}

function hitTest(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return { press: null, card: null };
  const press = el.closest('[data-press]');
  return { press: press && !press.disabled && !press.closest('[hidden]') ? press : null, card: el.closest('.card') };
}

function processInputs(inputs, dt) {
  const seen = new Set();
  const hoverCards = new Set(), hotKeys = new Set();
  palmUI = null;

  for (const inp of inputs) {
    seen.add(inp.id);
    let st = states.get(inp.id);
    if (!st) { st = { x: inp.x, y: inp.y, pinching: false, grab: null, press: null, offX: 0, offY: 0, palm: 0, palmLock: false }; states.set(inp.id, st); }
    st.x = inp.x; st.y = inp.y;
    const hit = hitTest(inp.x, inp.y);
    inp.hit = hit;

    if (inp.pinch && !st.pinching) {
      if (hit.press) { st.press = hit.press; hit.press.classList.add('is-pressed'); unlockAudio(); }
      else if (hit.card) grab(cardByEl.get(hit.card), st);
    } else if (!inp.pinch && st.pinching) {
      if (st.press) {
        st.press.classList.remove('is-pressed');
        if (hit.press === st.press) activate(st.press);
        st.press = null;
      }
      release(st);
    }
    st.pinching = inp.pinch;

    if (st.grab) hoverCards.add(st.grab.el);
    else if (hit.card) hoverCards.add(hit.card);
    if (hit.press && !st.grab) hotKeys.add(hit.press);
    inp.hover = !!(hit.card || hit.press);

    // Open palm hold -> tidy.
    if (inp.source === 'camera') {
      if (inp.gesture === 'open' && !st.grab && !st.palmLock) {
        st.palm += dt;
        const lm = inp.landmarks;
        const cx = lm ? (lm[0].x + lm[5].x + lm[17].x + lm[9].x) / 4 : inp.x;
        const cy = lm ? (lm[0].y + lm[5].y + lm[17].y + lm[9].y) / 4 : inp.y;
        if (st.palm > 0.4) palmUI = { x: cx, y: cy, p: clamp((st.palm - 0.4) / 1.4, 0, 1) };
        if (st.palm >= 1.8) { tidy(); st.palmLock = true; st.palm = 0; }
      } else {
        st.palm = Math.max(0, st.palm - dt * 2);
        if (inp.gesture !== 'open') st.palmLock = false;
      }
    }
  }

  // Pointers that vanished: release whatever they held.
  for (const [id, st] of states) {
    if (seen.has(id)) continue;
    if (st.press) { st.press.classList.remove('is-pressed'); st.press = null; }
    release(st);
    states.delete(id);
  }

  for (const c of cards) c.el.classList.toggle('is-hover', hoverCards.has(c.el));
  for (const el of $$('[data-press]')) el.classList.toggle('is-hot', hotKeys.has(el));
}

// ======================================================================
// Overlay drawing
// ======================================================================
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const TIPS = new Set([4, 8, 12, 16, 20]);
const ACCENT = '#ff6a1a';

function resizeOverlay() {
  VW = innerWidth; VH = innerHeight;
  DPR = Math.min(2, devicePixelRatio || 1);
  overlay.width = Math.round(VW * DPR); overlay.height = Math.round(VH * DPR);
}

function drawOverlay(inputs, dt) {
  octx.setTransform(DPR, 0, 0, DPR, 0, 0);
  octx.clearRect(0, 0, VW, VH);

  for (const inp of inputs) {
    const lm = inp.landmarks;
    if (lm && lm.length === 21) {
      octx.lineWidth = 1.25;
      octx.strokeStyle = 'rgba(235,231,224,0.22)';
      octx.beginPath();
      for (const [a, b] of BONES) { octx.moveTo(lm[a].x, lm[a].y); octx.lineTo(lm[b].x, lm[b].y); }
      octx.stroke();
      for (let i = 0; i < 21; i++) {
        const tip = TIPS.has(i);
        octx.fillStyle = tip ? 'rgba(235,231,224,0.75)' : 'rgba(235,231,224,0.35)';
        octx.beginPath(); octx.arc(lm[i].x, lm[i].y, tip ? 2.6 : 1.8, 0, TAU); octx.fill();
      }
      // thumb–index tension line
      const s = inp.pinchStrength || 0;
      octx.strokeStyle = `rgba(255,106,26,${0.15 + 0.6 * s})`;
      octx.lineWidth = 1;
      octx.beginPath(); octx.moveTo(lm[4].x, lm[4].y); octx.lineTo(lm[8].x, lm[8].y); octx.stroke();
    }
    drawCursor(inp);
  }

  if (palmUI) {
    const { x, y, p } = palmUI, r = 46;
    octx.lineWidth = 2;
    octx.strokeStyle = 'rgba(235,231,224,0.15)';
    octx.beginPath(); octx.arc(x, y, r, 0, TAU); octx.stroke();
    octx.strokeStyle = ACCENT;
    octx.beginPath(); octx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * p); octx.stroke();
    octx.font = '500 10px "JetBrains Mono", monospace';
    octx.fillStyle = 'rgba(235,231,224,0.85)';
    octx.textAlign = 'center'; octx.textBaseline = 'middle';
    octx.fillText(p >= 1 ? 'TIDY' : 'HOLD', x, y);
  }

  if (flash > 0) { // brief edge glow on tidy
    octx.strokeStyle = `rgba(255,106,26,${0.35 * flash})`;
    octx.lineWidth = 2;
    octx.strokeRect(1, 1, VW - 2, VH - 2);
    flash = Math.max(0, flash - dt * 2.5);
  }
}

function drawCursor(inp) {
  const s = clamp(inp.pinchStrength || 0, 0, 1);
  const { x, y } = inp;
  const r = lerp(20, 9, s);
  const active = inp.pinch;
  const hot = inp.hover;
  // static faint full ring
  octx.lineWidth = 1;
  octx.strokeStyle = 'rgba(235,231,224,0.18)';
  octx.beginPath(); octx.arc(x, y, r, 0, TAU); octx.stroke();
  // closing arc: two symmetric arcs that meet at the top as you pinch
  const sweep = Math.PI * lerp(0.28, 1, s);
  octx.lineWidth = active ? 2.5 : 2;
  octx.strokeStyle = active || hot ? ACCENT : 'rgba(235,231,224,0.9)';
  octx.beginPath(); octx.arc(x, y, r, Math.PI / 2 - sweep, Math.PI / 2 + sweep); octx.stroke();
  // centre
  octx.fillStyle = active ? ACCENT : 'rgba(235,231,224,0.9)';
  octx.beginPath(); octx.arc(x, y, active ? 3.5 : 1.8, 0, TAU); octx.fill();
  // crosshair ticks
  if (!active) {
    octx.strokeStyle = 'rgba(235,231,224,0.35)';
    octx.lineWidth = 1;
    octx.beginPath();
    octx.moveTo(x - r - 6, y); octx.lineTo(x - r - 2, y);
    octx.moveTo(x + r + 2, y); octx.lineTo(x + r + 6, y);
    octx.stroke();
  }
  if (inp.source === 'camera') {
    octx.font = '500 9px "JetBrains Mono", monospace';
    octx.fillStyle = 'rgba(235,231,224,0.45)';
    octx.textAlign = 'left'; octx.textBaseline = 'middle';
    octx.fillText(inp.id === 'Left' ? 'L' : 'R', x + r + 9, y);
  }
}

// ======================================================================
// Card content
// ======================================================================
function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, d = Math.min(2, devicePixelRatio || 1);
  canvas.width = w * d; canvas.height = h * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w, h };
}

// ---- 01 Clock ----
const clock = (() => {
  const ticks = $('.dial .ticks');
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * TAU, major = i % 5 === 0;
    const r1 = major ? 50 : 53, r2 = 56;
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', 60 + Math.sin(a) * r1); l.setAttribute('y1', 60 - Math.cos(a) * r1);
    l.setAttribute('x2', 60 + Math.sin(a) * r2); l.setAttribute('y2', 60 - Math.cos(a) * r2);
    if (major) l.setAttribute('class', 'major');
    ticks.appendChild(l);
  }
  const hH = $('.hand-h'), hM = $('.hand-m'), hS = $('.hand-s');
  const tEl = $('#clockTime'), dEl = $('#clockDate');
  const pct = $('#dayPct'), fill = $('#dayFill'), wk = $('#weekNo'), doy = $('#dayOfYear');
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  let lastSec = -1;
  const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 864e5 + 1) / 7);
  };
  return {
    update() {
      const n = new Date();
      const ms = n.getMilliseconds(), s = n.getSeconds(), m = n.getMinutes(), h = n.getHours();
      const sf = reduceMotion ? s : s + ms / 1000;
      hS.style.transform = `rotate(${sf * 6}deg)`;
      hM.style.transform = `rotate(${(m + s / 60) * 6}deg)`;
      hH.style.transform = `rotate(${((h % 12) + m / 60) * 30}deg)`;
      if (s === lastSec) return;
      lastSec = s;
      const pad = (v) => String(v).padStart(2, '0');
      tEl.innerHTML = `${pad(h)}:${pad(m)}<span class="sec">${pad(s)}</span>`;
      dEl.textContent = dateFmt.format(n);
      const dayFrac = (h * 3600 + m * 60 + s) / 86400;
      pct.textContent = (dayFrac * 100).toFixed(1) + '%';
      fill.style.transform = `scaleX(${dayFrac})`;
      fill.style.width = '100%';
      wk.textContent = 'ISO week ' + isoWeek(n);
      const start = new Date(n.getFullYear(), 0, 0);
      doy.textContent = 'Day ' + Math.floor((n - start) / 864e5);
    },
  };
})();

// ---- 02 Telemetry ----
const telemetry = (() => {
  const cells = Object.fromEntries($$('.tel-hand').map((el) => [el.dataset.hand, {
    el, g: $('.tel-gesture', el), bar: $('.bar-fill', el), xy: $('.tel-xy', el) }]));
  for (const c of Object.values(cells)) { c.bar.style.width = '100%'; c.bar.style.transform = 'scaleX(0)'; }
  const src = $('#telSource'), hz = $('#telHz'), fps = $('#telFps'), cnt = $('#telCount'), led = $('#telLed');
  let acc = 0, frames = 0, lastTrackerFrames = 0, renderFps = 0, trackHz = 0;
  return {
    update(inputs, dt) {
      acc += dt; frames++;
      if (acc >= 0.5) {
        renderFps = frames / acc;
        trackHz = (trackerFrames - lastTrackerFrames) / acc;
        lastTrackerFrames = trackerFrames; frames = 0; acc = 0;
        fps.textContent = Math.round(renderFps) + ' fps';
        hz.textContent = trackStatus === 'ready' ? Math.round(trackHz) + ' Hz' : '— Hz';
      }
      const cam = inputs.filter((i) => i.source === 'camera');
      const mouseIn = inputs.find((i) => i.source === 'mouse');
      src.textContent = cam.length ? 'camera' : (mouseIn ? 'mouse' : 'idle');
      cnt.textContent = String(cam.length || (mouseIn ? 1 : 0));
      led.classList.toggle('on', inputs.length > 0);
      for (const side of ['Left', 'Right']) {
        const c = cells[side];
        let h = cam.find((i) => i.id === side);
        if (!h && side === 'Right' && mouseIn) h = mouseIn;
        c.el.classList.toggle('live', !!h);
        if (h) {
          c.g.textContent = (h.source === 'mouse' ? 'mouse · ' : '') + (h.gesture || 'none');
          c.bar.style.transform = `scaleX(${clamp(h.pinchStrength || 0, 0, 1).toFixed(3)})`;
          c.xy.textContent = `x ${String(Math.round(h.x)).padStart(4)} y ${String(Math.round(h.y)).padStart(4)}`;
        } else {
          c.g.textContent = 'not seen';
          c.bar.style.transform = 'scaleX(0)';
          c.xy.textContent = 'x — y —';
        }
      }
    },
  };
})();

// ---- 03 Intervals (Lissajous + WebAudio) ----
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio */ }
}
const intervals = (() => {
  const { ctx, w, h } = setupCanvas($('#lissajous'));
  const nameEl = $('#intName'), ratioEl = $('#intRatio'), stateEl = $('#audioState');
  let a = 3, b = 2, phase = 0;
  const BASE = 220;
  function play() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t = audioCtx.currentTime;
    const out = audioCtx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    out.connect(audioCtx.destination);
    for (const f of [BASE, BASE * a / b]) {
      const o = audioCtx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(out); o.start(t); o.stop(t + 1.7);
    }
  }
  return {
    select(el) {
      a = +el.dataset.a; b = +el.dataset.b;
      for (const k of $$('[data-press="interval"]')) k.classList.toggle('is-on', k === el);
      nameEl.textContent = el.dataset.name;
      ratioEl.textContent = `${a} : ${b}`;
      play();
    },
    update(dt) {
      const on = audioCtx && audioCtx.state === 'running';
      const label = on ? 'audio on' : 'audio locked';
      if (stateEl.textContent !== label) { stateEl.textContent = label; stateEl.classList.toggle('on', !!on); }
      if (!reduceMotion) phase += dt * 0.35;
      ctx.clearRect(0, 0, w, h);
      // axes
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(w / 2, 8); ctx.lineTo(w / 2, h - 8); ctx.moveTo(8, h / 2); ctx.lineTo(w - 8, h / 2); ctx.stroke();
      const rx = h * 0.4, ry = h * 0.4, cx = w / 2, cy = h / 2;
      const N = 600;
      ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,106,26,0.9)';
      ctx.shadowColor = 'rgba(255,106,26,0.5)'; ctx.shadowBlur = 6;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const t = i / N * TAU * b;
        const x = cx + rx * 1.35 * Math.sin(a * t / b * 1 + phase);
        const y = cy + ry * Math.sin(t);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(235,231,224,0.35)';
      ctx.textAlign = 'left';
      ctx.fillText(`${BASE} Hz : ${(BASE * a / b).toFixed(0)} Hz`, 10, h - 10);
    },
  };
})();

// ---- 04 Drill timer ----
const timer = (() => {
  const read = $('#timerRead'), toggleBtn = $('#timerToggle'), lapBtn = $('#timerLap'), resetBtn = $('#timerReset');
  const lapsEl = $('#laps'), led = $('#timerLed');
  let running = false, startAt = 0, acc = 0, laps = [], lastLapTotal = 0, lastText = '';
  const elapsed = () => acc + (running ? performance.now() - startAt : 0);
  const fmt = (ms) => {
    const cs = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000);
    return [`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, `.${String(cs).padStart(2, '0')}`];
  };
  function renderLaps() {
    if (!laps.length) { lapsEl.innerHTML = '<li class="empty">Pinch Start, then Lap after each rally set</li>'; return; }
    const best = Math.min(...laps);
    lapsEl.innerHTML = laps.map((l, i) => ({ l, i })).slice(-4).reverse().map(({ l, i }) => {
      const [a, b] = fmt(l);
      return `<li><span class="n">Lap ${i + 1}</span><span class="${l === best && laps.length > 1 ? 'best' : ''}">${a}${b}</span></li>`;
    }).join('');
  }
  function sync() {
    toggleBtn.textContent = running ? 'Stop' : (acc > 0 ? 'Resume' : 'Start');
    toggleBtn.classList.toggle('running', running);
    lapBtn.disabled = !running;
    resetBtn.disabled = running || acc === 0;
    read.classList.toggle('running', running);
    led.classList.toggle('on', running);
  }
  return {
    toggle() {
      if (running) { acc += performance.now() - startAt; running = false; }
      else { startAt = performance.now(); running = true; }
      sync();
    },
    lap() {
      if (!running) return;
      const t = elapsed();
      laps.push(t - lastLapTotal); lastLapTotal = t;
      renderLaps();
      relayoutSoon();
    },
    reset() {
      if (running) return;
      acc = 0; laps = []; lastLapTotal = 0;
      renderLaps(); sync(); relayoutSoon();
    },
    update() {
      const [a, b] = fmt(elapsed());
      const txt = a + b;
      if (txt !== lastText) { read.innerHTML = `${a}<span class="cs">${b}</span>`; lastText = txt; }
    },
    init: sync,
  };
})();
timer.init();

// ---- 05 Shuttle flight ----
const shuttle = (() => {
  const { ctx, w, h } = setupCanvas($('#shuttle'));
  const vEl = $('#shV'), apexEl = $('#shApex'), tEl = $('#shT'), resEl = $('#shRes');
  const G = 9.81, VT = 6.8, K = G / (VT * VT);
  const COURT = 13.4, NET_X = 6.7, NET_H = 1.524;
  const SHOTS = {
    clear: { x0: 1.2, h0: 2.4, v: 62, deg: 47 },
    drop:  { x0: 1.5, h0: 2.4, v: 16, deg: 12 },
    smash: { x0: 3.5, h0: 2.7, v: 72, deg: -13 },
  };
  let path = null, playT = 0, current = null;
  const pad = 14, sx = (w - pad * 2) / 14.4, sy = sx;
  const X = (m) => pad + m * sx, Y = (m) => h - 16 - m * sy;

  function simulate({ x0, h0, v, deg }) {
    const a = deg * Math.PI / 180, dt = 0.002;
    let x = x0, y = h0, vx = v * Math.cos(a), vy = v * Math.sin(a), t = 0, apex = h0, netY = null;
    const pts = [{ t, x, y }];
    while (y > 0 && t < 6) {
      const s = Math.hypot(vx, vy);
      vx += -K * s * vx * dt; vy += (-G - K * s * vy) * dt;
      const px = x; x += vx * dt; y += vy * dt; t += dt;
      if (px < NET_X && x >= NET_X) netY = y;
      apex = Math.max(apex, y);
      if (pts.length === 0 || t - pts[pts.length - 1].t > 0.01) pts.push({ t, x, y: Math.max(0, y) });
    }
    pts.push({ t, x, y: 0 });
    const res = netY !== null && netY < NET_H ? 'net' : x <= NET_X ? 'short' : x > COURT ? 'long' : 'in';
    return { pts, apex, t, land: x, res, v };
  }

  function shoot(kind) {
    current = kind;
    for (const k of $$('[data-press="shot"]')) k.classList.toggle('is-on', k.dataset.shot === kind);
    path = simulate(SHOTS[kind]);
    playT = reduceMotion ? path.t : 0;
    vEl.textContent = `${Math.round(path.v * 3.6)} km/h`;
    apexEl.textContent = `${path.apex.toFixed(1)} m`;
    tEl.textContent = `${path.t.toFixed(2)} s`;
    resEl.textContent = path.res === 'in' ? `in · ${(path.land - NET_X).toFixed(1)} m` : path.res;
  }

  return {
    shoot,
    update(dt) {
      ctx.clearRect(0, 0, w, h);
      // court
      ctx.strokeStyle = 'rgba(235,231,224,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(COURT), Y(0)); ctx.stroke();
      ctx.strokeStyle = 'rgba(235,231,224,0.12)';
      for (const m of [0, 0.76, 4.72, 8.68, 12.64, COURT]) { ctx.beginPath(); ctx.moveTo(X(m), Y(0)); ctx.lineTo(X(m), Y(0) + 4); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(235,231,224,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(NET_X), Y(0)); ctx.lineTo(X(NET_X), Y(NET_H)); ctx.stroke();
      ctx.font = '500 8.5px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(235,231,224,0.3)';
      ctx.textAlign = 'center';
      ctx.fillText('13.4 m', X(COURT / 2) + 40, Y(0) + 12);
      ctx.textAlign = 'left';
      for (const m of [2, 4, 6, 8]) {
        ctx.strokeStyle = 'rgba(255,255,255,0.035)';
        ctx.beginPath(); ctx.moveTo(X(0), Y(m)); ctx.lineTo(X(14), Y(m)); ctx.stroke();
        if (Y(m) > 8) ctx.fillText(`${m}`, 2, Y(m) + 3);
      }
      if (!path) {
        ctx.fillStyle = 'rgba(235,231,224,0.35)'; ctx.textAlign = 'center';
        ctx.fillText('pick a shot', w / 2, h / 2 - 10);
        return;
      }
      playT = Math.min(path.t, playT + dt);
      const pts = path.pts;
      // full predicted path, faint
      ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(235,231,224,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke(); ctx.setLineDash([]);
      // flown portion
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.6;
      ctx.beginPath();
      let head = pts[0];
      for (let i = 0; i < pts.length && pts[i].t <= playT; i++) { head = pts[i]; i ? ctx.lineTo(X(head.x), Y(head.y)) : ctx.moveTo(X(head.x), Y(head.y)); }
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(X(head.x), Y(head.y), 2.6, 0, TAU); ctx.fill();
      if (playT >= path.t) {
        ctx.strokeStyle = path.res === 'in' ? ACCENT : 'rgba(229,101,79,0.9)';
        ctx.beginPath(); ctx.arc(X(path.land), Y(0), 5, 0, TAU); ctx.stroke();
      }
    },
  };
})();

// ---- 06 Four-bar linkage ----
const linkage = (() => {
  const { ctx, w, h } = setupCanvas($('#linkage'));
  const thEl = $('#lkTheta'), gEl = $('#lkGamma'), rEl = $('#lkRange');
  const toggleBtn = $('#lkToggle'), traceBtn = $('#lkTrace');
  // a crank, b coupler, c rocker, d ground (Grashof: s + l = 4 <= p + q = 5.5)
  const a = 1, b = 3, c = 2.5, d = 3;
  const CU = 0.5, CV = 1.1; // coupler point: along AB, perpendicular offset
  let theta = 0.6, running = !reduceMotion, trace = true;
  function solve(th) {
    const A = { x: a * Math.cos(th), y: a * Math.sin(th) };
    const ex = d - A.x, ey = -A.y, e = Math.hypot(ex, ey);
    const along = (b * b - c * c + e * e) / (2 * e);
    const hh = Math.sqrt(Math.max(0, b * b - along * along));
    const px = A.x + along * ex / e, py = A.y + along * ey / e;
    const B = { x: px - hh * ey / e, y: py + hh * ex / e };
    const ux = (B.x - A.x) / b, uy = (B.y - A.y) / b;
    const P = { x: A.x + CU * b * ux - CV * uy, y: A.y + CU * b * uy + CV * ux };
    const cosG = ((A.x - B.x) * (d - B.x) + (A.y - B.y) * (0 - B.y)) / (b * c);
    return { A, B, P, gamma: Math.acos(clamp(cosG, -1, 1)) };
  }
  const curve = []; let gMin = Infinity, gMax = -Infinity;
  for (let i = 0; i <= 240; i++) {
    const s = solve(i / 240 * TAU); curve.push(s.P);
    gMin = Math.min(gMin, s.gamma); gMax = Math.max(gMax, s.gamma);
  }
  const deg = (r) => (r * 180 / Math.PI).toFixed(0) + '°';
  rEl.textContent = `${deg(gMin)}–${deg(gMax)}`;
  // fit to canvas
  const xs = curve.map((p) => p.x).concat([-a, d + c, 0]), ys = curve.map((p) => p.y).concat([-a, a, 0, -c, c]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sc = Math.min((w - 30) / (maxX - minX), (h - 26) / (maxY - minY));
  const ox = (w - (maxX - minX) * sc) / 2 - minX * sc, oy = (h + (maxY - minY) * sc) / 2 + minY * sc;
  const T = (p) => [ox + p.x * sc, oy - p.y * sc];
  function pivot(p) {
    const [x, y] = T(p);
    ctx.strokeStyle = 'rgba(235,231,224,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 9); ctx.lineTo(x + 6, y + 9); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); for (let i = -6; i <= 6; i += 3) { ctx.moveTo(x + i, y + 9); ctx.lineTo(x + i - 3, y + 13); } ctx.stroke();
  }
  function link(p, q, width, color) {
    const [x1, y1] = T(p), [x2, y2] = T(q);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  function joint(p, fill = '#0d0e10') {
    const [x, y] = T(p);
    ctx.fillStyle = fill; ctx.strokeStyle = 'rgba(235,231,224,0.85)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill(); ctx.stroke();
  }
  return {
    toggle() { running = !running; toggleBtn.textContent = running ? 'Pause' : 'Run'; },
    toggleTrace() { trace = !trace; traceBtn.textContent = trace ? 'Hide trace' : 'Show trace'; },
    init() { toggleBtn.textContent = running ? 'Pause' : 'Run'; },
    update(dt) {
      if (running) theta = (theta + dt * 1.6) % TAU;
      const s = solve(theta);
      ctx.clearRect(0, 0, w, h);
      if (trace) {
        ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(255,106,26,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); curve.forEach((p, i) => { const [x, y] = T(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      }
      const O2 = { x: 0, y: 0 }, O4 = { x: d, y: 0 };
      link(O2, O4, 1, 'rgba(235,231,224,0.15)');
      pivot(O2); pivot(O4);
      // coupler triangle
      ctx.fillStyle = 'rgba(235,231,224,0.06)';
      ctx.beginPath(); [s.A, s.B, s.P].forEach((p, i) => { const [x, y] = T(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill();
      link(s.A, s.P, 1, 'rgba(235,231,224,0.35)'); link(s.B, s.P, 1, 'rgba(235,231,224,0.35)');
      link(O2, s.A, 4, 'rgba(235,231,224,0.85)');
      link(s.A, s.B, 3, 'rgba(235,231,224,0.6)');
      link(O4, s.B, 3, 'rgba(235,231,224,0.6)');
      joint(O2); joint(O4); joint(s.A); joint(s.B);
      const [px, py] = T(s.P);
      ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU); ctx.fill();
      thEl.textContent = deg(theta);
      gEl.textContent = deg(s.gamma);
      gEl.style.color = s.gamma < 0.7 || s.gamma > Math.PI - 0.7 ? ACCENT : '';
    },
  };
})();
linkage.init();

// ---- 07 Notes ----
(() => {
  const ta = $('#notes'), saved = $('#notesSaved');
  ta.value = store.get('wb-notes', 'Footwork: split-step before every shot.\nME reading: four-bar linkages, Grashof condition.\n');
  let tmo = 0;
  ta.addEventListener('input', () => {
    saved.textContent = 'editing';
    clearTimeout(tmo);
    tmo = setTimeout(() => { store.set('wb-notes', ta.value); saved.textContent = 'saved locally'; }, 400);
  });
})();

// ======================================================================
// Layout lifecycle
// ======================================================================
let relayoutTimer = 0;
function relayoutSoon() { // content changed height (laps) - re-measure only
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(measure, 30);
}
addEventListener('resize', () => {
  resizeOverlay();
  measure();
});

async function boot() {
  resizeOverlay();
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch { /* ignore */ }
  measure();
  const targets = layoutTargets();
  cards.forEach((c, i) => {
    const t = targets.get(c);
    if (reduceMotion) { c.x = t.x; c.y = t.y; }
    else { // deal in from below, staggered
      c.x = t.x + (i - 3) * 6; c.y = VH + c.h / 2 + 40 + i * 30;
      c.settle = { x: t.x, y: t.y };
    }
    writeTransform(c);
    c.el.classList.add('is-placed');
  });
  requestAnimationFrame(frame);
  startTracking();
}

// ======================================================================
// The one loop
// ======================================================================
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;

  mouse.strength = lerp(mouse.strength, mouse.down ? 1 : 0, 1 - Math.exp(-dt * 22));

  const inputs = gatherInputs(now);
  processInputs(inputs, dt);
  for (const c of cards) {
    // During deal-in the bounds clamp is skipped by the settle branch; still settle cards off-screen.
    stepCard(c, dt, now);
  }

  clock.update();
  telemetry.update(inputs, dt);
  intervals.update(dt);
  timer.update();
  shuttle.update(dt);
  linkage.update(dt);

  drawOverlay(inputs, dt);
  requestAnimationFrame(frame);
}

boot();
