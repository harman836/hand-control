// tracking.js - webcam -> smoothed hand data via MediaPipe HandLandmarker.
// Usage: const t = await createHandTracker(videoEl, { onUpdate, onStatus }); t.stop();
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const PINCH_ON = 0.33, PINCH_OFF = 0.45; // normalized thumb-index distance thresholds
const GESTURE_FRAMES = 3;                // frames a raw gesture must hold before it commits
const LOST_MS = 300;                     // hand gone this long -> reset its filters

// ---------- One Euro filter (Casiez et al. 2012) ----------
const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = null; this.dx = 0; this.t = 0;
  }
  filter(v, t) { // t in seconds
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(t - this.t, 1e-3);
    this.t = t;
    const rawD = (v - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawD - this.dx);          // smoothed speed
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);  // faster motion -> less lag
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

// Per-hand state: filters for the pinch point, 21 landmarks (lighter smoothing), pinch + gesture debounce.
function newState() {
  return {
    fx: new OneEuro(1.2, 0.02, 1), fy: new OneEuro(1.2, 0.02, 1),
    lm: Array.from({ length: 21 }, () => [new OneEuro(3, 0.05, 1), new OneEuro(3, 0.05, 1)]),
    pinch: false, gesture: 'none', cand: 'none', candN: 0, seen: 0,
    fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
    fCand: '', fN: 0, rawFingers: null,
    pose: 'none', pCand: 'none', pN: 0,
  };
}

// ---------- Geometry helpers (video-pixel space so aspect ratio is correct) ----------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// A finger is extended if its tip is farther from the wrist than its PIP joint.
function fingersExtended(p) {
  return [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => dist(p[0], p[tip]) > dist(p[0], p[pip]));
}

// Stricter test for 'open': every finger clearly straight (tip well past its PIP), thumb out
// to the side, and fingers spread. A relaxed or half-curled hand no longer counts.
const OPEN_STRAIGHT = 1.25;  // tip-to-wrist must exceed PIP-to-wrist by this factor
const OPEN_THUMB = 0.75;     // thumb tip to index MCP, as a fraction of hand size
const OPEN_SPREAD = 0.95;    // index tip to pinky tip, as a fraction of hand size
function isWideOpenPalm(p) {
  const size = dist(p[0], p[9]) || 1;
  const straight = [[8, 6], [12, 10], [16, 14], [20, 18]]
    .every(([tip, pip]) => dist(p[0], p[tip]) > dist(p[0], p[pip]) * OPEN_STRAIGHT);
  const thumbOut = dist(p[4], p[5]) / size > OPEN_THUMB;
  const spread = dist(p[8], p[20]) / size > OPEN_SPREAD;
  return straight && thumbOut && spread;
}

// ---------- Per-finger extension + pose classification (pure, exported for tests) ----------
const FINGER_UP = 1.15;     // fingertip-to-wrist must exceed PIP-to-wrist by this factor to count as up (else not up)
const THUMB_IDX = 0.55;     // thumb tip to index MCP, as a fraction of hand size, must exceed this
const THUMB_PINKY = 1.0;    // thumb tip to pinky MCP, as a fraction of hand size, must exceed this (tucked thumb is closer)
const THUMB_ANGLE = 140;    // degrees at the thumb IP joint (3); straighter than this counts as extended
const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function angleAt(b, a, c) { // angle in degrees at b between a and c
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m))) * 180 / Math.PI;
}

// p: 21 landmarks in video-pixel space. Returns { thumb, index, middle, ring, pinky } booleans.
export function fingerStates(p) {
  const size = dist(p[0], p[9]) || 1;
  const up = ([tip, pip]) => dist(p[0], p[tip]) > dist(p[0], p[pip]) * FINGER_UP;
  const thumb = dist(p[4], p[5]) / size > THUMB_IDX
    && dist(p[4], p[17]) / size > THUMB_PINKY
    && angleAt(p[3], p[2], p[4]) > THUMB_ANGLE;
  return {
    thumb, index: up([8, 6]), middle: up([12, 10]), ring: up([16, 14]), pinky: up([20, 18]),
  };
}

const F = (...names) => Object.fromEntries(FINGER_NAMES.map((n) => [n, names.includes(n)]));
export const POSES = [
  { id: 'open',  label: 'Open palm',   fingers: F('thumb', 'index', 'middle', 'ring', 'pinky') },
  { id: 'fist',  label: 'Fist',        fingers: F() },
  { id: 'point', label: 'Point',       fingers: F('index') },
  { id: 'two',   label: 'Two (V)',     fingers: F('index', 'middle') },
  { id: 'three', label: 'Three',       fingers: F('index', 'middle', 'ring') },
  { id: 'thumb', label: 'Thumbs up',   fingers: F('thumb') },
  { id: 'rock',  label: 'Rock',        fingers: F('index', 'pinky') },
  { id: 'call',  label: 'Call me',     fingers: F('thumb', 'pinky') },
  { id: 'L',     label: 'L shape',     fingers: F('thumb', 'index') },
  { id: 'pinky', label: 'Pinky',       fingers: F('pinky') },
];

export function classifyPose(p, fingers, pinching) {
  if (pinching) return 'pinch';
  const hit = POSES.find((s) => FINGER_NAMES.every((n) => s.fingers[n] === fingers[n]));
  if (!hit) return 'none';
  if (hit.id === 'open' && !isWideOpenPalm(p)) return 'none';
  return hit.id;
}

function rawGesture(p, pinching) {
  if (pinching) return 'pinch';
  const [i, m, r, k] = fingersExtended(p);
  if (!i && !m && !r && !k) return 'fist';
  if (i && m && r && k && isWideOpenPalm(p)) return 'open';
  if (i && !m && !r && !k) return 'point';
  return 'none';
}

export async function createHandTracker(videoEl, { onUpdate, onStatus } = {}) {
  const status = (s, d) => { try { if (onStatus) onStatus(s, d); } catch (e) { console.error(e); } };
  let running = true, rafId = 0, stream = null, landmarker = null, lastVideoTime = -1;
  const states = new Map(); // 'Left' | 'Right' -> state

  const stop = () => {
    running = false;
    cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    videoEl.srcObject = null;
    if (landmarker) { try { landmarker.close(); } catch (e) { /* ignore */ } landmarker = null; }
  };

  try {
    // 1. Camera
    status('camera');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' } });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'SecurityError')) {
        status('denied');
      } else {
        status('error', (err && err.message) || String(err));
      }
      return { stop };
    }
    if (!running) { stop(); return { stop }; }
    videoEl.srcObject = stream;
    videoEl.muted = true; videoEl.playsInline = true;
    await videoEl.play();

    // 2. Model (GPU first, CPU fallback)
    status('loading');
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO', numHands: 2,
    });
    try { landmarker = await make('GPU'); }
    catch (e) { console.warn('GPU delegate failed, using CPU', e); landmarker = await make('CPU'); }
    if (!running) { stop(); return { stop }; }
    status('ready');
  } catch (err) {
    status('error', (err && err.message) || String(err));
    stop();
    return { stop };
  }

  // Normalized landmark -> mirrored viewport px, replicating object-fit: cover.
  function mapPoint(l, vw, vh, W, H) {
    const scale = Math.max(W / vw, H / vh);
    const ox = (W - vw * scale) / 2, oy = (H - vh * scale) / 2;
    return { x: W - (l.x * vw * scale + ox), y: l.y * vh * scale + oy, z: l.z };
  }

  function frame() {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (videoEl.readyState < 2 || videoEl.currentTime === lastVideoTime) return;
    lastVideoTime = videoEl.currentTime;

    const nowMs = performance.now(), t = nowMs / 1000;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) return;
    const W = window.innerWidth, H = window.innerHeight;

    let result;
    try { result = landmarker.detectForVideo(videoEl, nowMs); }
    catch (e) { console.error(e); return; }

    const hands = [];
    const taken = new Set();
    (result.landmarks || []).forEach((lms, idx) => {
      // MediaPipe assumes a mirrored input; our frame is not mirrored, so its label is flipped for the user.
      const cat = result.handedness && result.handedness[idx] && result.handedness[idx][0];
      let id = cat && cat.categoryName === 'Left' ? 'Right' : 'Left';
      if (taken.has(id)) id = id === 'Left' ? 'Right' : 'Left'; // both labelled the same: give second the other id
      taken.add(id);

      let st = states.get(id);
      if (!st || nowMs - st.seen > LOST_MS) { st = newState(); states.set(id, st); }
      st.seen = nowMs;

      // Gesture math in video-pixel space (aspect-correct); drawing coords mapped separately.
      const vp = lms.map((l) => ({ x: l.x * vw, y: l.y * vh }));
      const size = dist(vp[0], vp[9]) || 1;
      const d = dist(vp[4], vp[8]) / size;
      if (!st.pinch && d < PINCH_ON) st.pinch = true;
      else if (st.pinch && d > PINCH_OFF) st.pinch = false;
      const pinchStrength = clamp01((0.6 - d) / (0.6 - 0.2));

      // Debounce gesture: raw value must persist GESTURE_FRAMES frames.
      const raw = rawGesture(vp, st.pinch);
      if (raw === st.cand) st.candN++; else { st.cand = raw; st.candN = 1; }
      if (st.candN >= GESTURE_FRAMES) st.gesture = st.cand;

      // Debounced per-finger state and pose.
      const rf = fingerStates(vp);
      const fKey = FINGER_NAMES.map((n) => (rf[n] ? 1 : 0)).join('');
      if (fKey === st.fCand) st.fN++; else { st.fCand = fKey; st.fN = 1; }
      if (st.fN >= GESTURE_FRAMES) st.fingers = rf;
      const rawPose = classifyPose(vp, rf, st.pinch);
      if (rawPose === st.pCand) st.pN++; else { st.pCand = rawPose; st.pN = 1; }
      if (st.pN >= GESTURE_FRAMES) st.pose = st.pCand;

      // Smoothed screen-space outputs.
      const pts = lms.map((l) => mapPoint(l, vw, vh, W, H));
      const landmarks = pts.map((p, i) => ({
        x: st.lm[i][0].filter(p.x, t), y: st.lm[i][1].filter(p.y, t), z: p.z,
      }));
      const mx = (pts[4].x + pts[8].x) / 2, my = (pts[4].y + pts[8].y) / 2;
      hands.push({
        id, x: st.fx.filter(mx, t), y: st.fy.filter(my, t),
        pinch: st.pinch, pinchStrength, gesture: st.gesture, landmarks,
        fingers: { ...st.fingers }, pose: st.pose,
      });
    });

    // Forget hands that have been absent too long (state is rebuilt on return).
    for (const [id, st] of states) if (nowMs - st.seen > LOST_MS) states.delete(id);

    try { if (onUpdate) onUpdate(hands); } catch (e) { console.error(e); }
  }
  rafId = requestAnimationFrame(frame);

  return { stop };
}
