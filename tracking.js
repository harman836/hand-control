// tracking.js - webcam -> smoothed hand data via MediaPipe HandLandmarker.
// Usage: const t = await createHandTracker(videoEl, { onUpdate, onStatus }); t.stop();
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const PINCH_ON = 0.33, PINCH_OFF = 0.45; // normalized thumb-index distance thresholds
const GESTURE_FRAMES = 3;                // frames a raw gesture must hold before it commits
const LOST_MS = 300;                     // hand gone this long -> reset its filters

// ---------- Power ----------
// Hand landmarks are computed on a ~224px crop internally, so 640x360 capture loses nothing
// but cuts camera decode and GPU upload cost ~4x versus 720p.
const CAPTURE = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } };
const IDLE_AFTER_MS = 1500;              // no hand seen this long -> idle rate
const IDLE_FPS = 6;                      // detections/s while no hand is in view (still notices a hand within ~0.2s)

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

// ---------- Per-pose tunable thresholds (config.poseTuning; must match electron/config.js) ----------
// up:     a finger the pose needs RAISED must have tip-to-wrist / PIP-to-wrist above this
// down:   a finger the pose needs FOLDED must be below this
// thumb:  thumb tip to index MCP / hand size; above = thumb out (plus fixed angle/pinky checks), else tucked
// frames: consecutive frames before the pose registers;  spread (open only): index tip to pinky tip / hand size
const BASE_TUNING = { up: FINGER_UP, down: FINGER_UP, thumb: THUMB_IDX, frames: GESTURE_FRAMES };
export const DEFAULT_TUNING = Object.fromEntries(POSES.map((s) => [s.id, { ...BASE_TUNING }]));
DEFAULT_TUNING.open = { up: OPEN_STRAIGHT, down: FINGER_UP, thumb: OPEN_THUMB, frames: GESTURE_FRAMES, spread: OPEN_SPREAD };

// Raw continuous measurements the thresholds are compared against (also sent to Settings' live meter).
export function fingerMetrics(p) {
  const size = dist(p[0], p[9]) || 1;
  const r = ([tip, pip]) => dist(p[0], p[tip]) / (dist(p[0], p[pip]) || 1);
  return {
    thumb: dist(p[4], p[5]) / size,
    index: r([8, 6]), middle: r([12, 10]), ring: r([16, 14]), pinky: r([20, 18]),
    spread: dist(p[8], p[20]) / size,
    thumbPinky: dist(p[4], p[17]) / size,
    thumbAngle: angleAt(p[3], p[2], p[4]),
  };
}
const thumbOut = (m, thr) => m.thumb > thr && m.thumbPinky > THUMB_PINKY && m.thumbAngle > THUMB_ANGLE;
const tuneFor = (tuning, id) => ({ ...DEFAULT_TUNING[id], ...((tuning && tuning[id]) || {}) });

// Returns the pose whose every requirement passes; if several pass, the one with the largest margin.
export function classifyPose(p, pinching, tuning = DEFAULT_TUNING, m = fingerMetrics(p)) {
  if (pinching) return 'pinch';
  let best = 'none', bestMargin = -Infinity;
  for (const pose of POSES) {
    const t = tuneFor(tuning, pose.id);
    let margin = Infinity;
    for (const n of ['index', 'middle', 'ring', 'pinky']) {
      margin = Math.min(margin, pose.fingers[n] ? m[n] - t.up : t.down - m[n]);
      if (margin <= 0) break;
    }
    if (margin <= 0) continue;
    if (pose.fingers.thumb !== thumbOut(m, t.thumb)) continue;
    if (t.spread != null && !(m.spread > t.spread)) continue;
    if (margin > bestMargin) { best = pose.id; bestMargin = margin; }
  }
  return best;
}

function rawGesture(p, pinching) {
  if (pinching) return 'pinch';
  const [i, m, r, k] = fingersExtended(p);
  if (!i && !m && !r && !k) return 'fist';
  if (i && m && r && k && isWideOpenPalm(p)) return 'open';
  if (i && !m && !r && !k) return 'point';
  return 'none';
}

export async function createHandTracker(videoEl, { onUpdate, onStatus, tuning: initialTuning } = {}) {
  const status = (s, d) => { try { if (onStatus) onStatus(s, d); } catch (e) { console.error(e); } };
  let running = true, rafId = 0, stream = null, landmarker = null, lastVideoTime = -1;
  const states = new Map(); // 'Left' | 'Right' -> state
  let tuning = initialTuning || DEFAULT_TUNING;
  const setTuning = (t) => { if (t && typeof t === 'object') tuning = t; };

  // Power state: `active` false releases the camera entirely (LED off, ~0 CPU); maxFps caps detection rate.
  let active = true, maxFps = 30, lastDetect = 0, lastHandAt = 0, idle = false, vfcId = 0;
  const hasVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  const schedule = () => {
    if (!running || !active) return;
    if (hasVFC) vfcId = videoEl.requestVideoFrameCallback(() => frame());
    else rafId = requestAnimationFrame(frame);
  };
  const unschedule = () => {
    cancelAnimationFrame(rafId);
    if (hasVFC && vfcId) { try { videoEl.cancelVideoFrameCallback(vfcId); } catch (e) { /* ignore */ } }
    vfcId = 0;
  };
  const releaseCamera = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; videoEl.srcObject = null;
  };
  async function openCamera() {
    stream = await navigator.mediaDevices.getUserMedia({ video: { ...CAPTURE, facingMode: 'user' } });
    videoEl.srcObject = stream;
    videoEl.muted = true; videoEl.playsInline = true;
    await videoEl.play();
  }
  // Ask the webcam itself to slow down while idle (not all cameras honour it; harmless if ignored).
  const setCameraRate = (fps) => {
    const tr = stream && stream.getVideoTracks()[0];
    if (tr && tr.applyConstraints) tr.applyConstraints({ frameRate: { ideal: fps, max: 30 } }).catch(() => {});
  };

  const stop = () => {
    running = false;
    unschedule();
    releaseCamera();
    if (landmarker) { try { landmarker.close(); } catch (e) { /* ignore */ } landmarker = null; }
  };

  let resuming = null;
  async function setActive(on) {
    on = !!on;
    if (!running || on === active) return;
    active = on;
    if (!on) { unschedule(); releaseCamera(); states.clear(); status('sleeping'); return; }
    if (resuming) return resuming;
    resuming = (async () => {
      try {
        status('camera');
        await openCamera();
        if (!active) { releaseCamera(); return; } // switched off again while opening
        lastVideoTime = -1; lastHandAt = performance.now(); idle = false;
        status(landmarker ? 'ready' : 'loading');
        schedule();
      } catch (err) {
        status('error', (err && err.message) || String(err));
      } finally { resuming = null; }
    })();
    return resuming;
  }
  const setMaxFps = (n) => { if (Number.isFinite(n) && n > 0) maxFps = Math.min(30, n); };

  try {
    // 1. Camera
    status('camera');
    try {
      await openCamera();
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'SecurityError')) {
        status('denied');
      } else {
        status('error', (err && err.message) || String(err));
      }
      return { stop, setTuning, setActive, setMaxFps };
    }
    if (!running) { stop(); return { stop, setTuning, setActive, setMaxFps }; }

    // 2. Model (GPU first, CPU fallback)
    status('loading');
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO', numHands: 2,
    });
    try { landmarker = await make('GPU'); }
    catch (e) { console.warn('GPU delegate failed, using CPU', e); landmarker = await make('CPU'); }
    if (!running) { stop(); return { stop, setTuning, setActive, setMaxFps }; }
    status(active ? 'ready' : 'sleeping');
  } catch (err) {
    status('error', (err && err.message) || String(err));
    stop();
    return { stop, setTuning, setActive, setMaxFps };
  }

  // Normalized landmark -> mirrored viewport px, replicating object-fit: cover.
  function mapPoint(l, vw, vh, W, H) {
    const scale = Math.max(W / vw, H / vh);
    const ox = (W - vw * scale) / 2, oy = (H - vh * scale) / 2;
    return { x: W - (l.x * vw * scale + ox), y: l.y * vh * scale + oy, z: l.z };
  }

  function frame() {
    if (!running || !active) return;
    schedule();
    if (videoEl.readyState < 2 || videoEl.currentTime === lastVideoTime) return;
    const nowMs = performance.now(), t = nowMs / 1000;
    // Rate limit: full rate while a hand is in view, IDLE_FPS once none has been seen for a while.
    const nowIdle = nowMs - lastHandAt > IDLE_AFTER_MS;
    if (nowIdle !== idle) { idle = nowIdle; setCameraRate(idle ? 10 : 30); }
    const fps = idle ? Math.min(IDLE_FPS, maxFps) : maxFps;
    if (nowMs - lastDetect < 1000 / fps - 4) return;
    lastDetect = nowMs;
    lastVideoTime = videoEl.currentTime;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) return;
    const W = window.innerWidth, H = window.innerHeight;

    let result;
    try { result = landmarker.detectForVideo(videoEl, nowMs); }
    catch (e) { console.error(e); return; }

    const hands = [];
    const taken = new Set();
    (result.landmarks || []).forEach((lms, idx) => {
      // MediaPipe's handedness label already matches the user's real hand for this front camera
      // (verified by the user: flipping it reported Left/Right the wrong way round).
      const cat = result.handedness && result.handedness[idx] && result.handedness[idx][0];
      let id = cat && cat.categoryName === 'Left' ? 'Left' : 'Right';
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
      const metrics = fingerMetrics(vp);
      const rawPose = classifyPose(vp, st.pinch, tuning, metrics);
      if (rawPose === st.pCand) st.pN++; else { st.pCand = rawPose; st.pN = 1; }
      const need = DEFAULT_TUNING[st.pCand] ? tuneFor(tuning, st.pCand).frames : GESTURE_FRAMES;
      if (st.pN >= need) st.pose = st.pCand;

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
        metrics: {
          thumb: +metrics.thumb.toFixed(3), index: +metrics.index.toFixed(3), middle: +metrics.middle.toFixed(3),
          ring: +metrics.ring.toFixed(3), pinky: +metrics.pinky.toFixed(3), spread: +metrics.spread.toFixed(3),
        },
      });
    });

    if (hands.length) lastHandAt = nowMs;

    // Forget hands that have been absent too long (state is rebuilt on return).
    for (const [id, st] of states) if (nowMs - st.seen > LOST_MS) states.delete(id);

    try { if (onUpdate) onUpdate(hands); } catch (e) { console.error(e); }
  }
  if (active) schedule();

  return { stop, setTuning, setActive, setMaxFps };
}
