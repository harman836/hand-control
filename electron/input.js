// Input backends for the main process.
//  - Mouse: tries @nut-tree-fork/nut-js first; if its native module can't load (its libnut-win32
//    prebuild is x64-only, so it fails on Windows on ARM) falls back to user32.dll via koffi.
//  - Keyboard (combos + media keys), extra mouse buttons, wheel and window moving: user32 via koffi.
// All coordinates are physical screen pixels (Electron is per-monitor DPI aware).

// ---------- Key names (CONTRACT section 2) -> virtual-key codes ----------
const MODS = { ctrl: 0x11, control: 0x11, alt: 0x12, option: 0x12, shift: 0x10, win: 0x5b, meta: 0x5b, super: 0x5b, cmd: 0x5b };
const NAMED = {
  tab: 0x09, enter: 0x0d, return: 0x0d, esc: 0x1b, escape: 0x1b, space: 0x20,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  home: 0x24, end: 0x23, pageup: 0x21, pgup: 0x21, pagedown: 0x22, pgdn: 0x22,
  delete: 0x2e, del: 0x2e, insert: 0x2d, ins: 0x2d, backspace: 0x08, printscreen: 0x2c, prtsc: 0x2c,
};
// Keys that need KEYEVENTF_EXTENDEDKEY.
const EXTENDED = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2c, 0x2d, 0x2e, 0x5b, 0x5c, 0xad, 0xae, 0xaf, 0xb0, 0xb1, 0xb2, 0xb3]);
const MEDIA = { playpause: 0xb3, next: 0xb0, prev: 0xb1, volup: 0xaf, voldown: 0xae, mute: 0xad };

function keyVk(name) {
  const k = name.toLowerCase();
  if (NAMED[k] !== undefined) return NAMED[k];
  if (/^[a-z]$/.test(k)) return k.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(k)) return k.charCodeAt(0);
  const f = /^f([1-9]|1[0-9]|2[0-4])$/.exec(k);
  if (f) return 0x6f + Number(f[1]);
  return null;
}

// 'Ctrl+Shift+T' -> { ok, mods:[vk], key: vk } ; a combo may be modifiers only (e.g. 'Win').
function parseCombo(combo) {
  if (typeof combo !== 'string' || !combo.trim()) return { ok: false, error: 'empty combo' };
  const parts = combo.split('+').map((s) => s.trim()).filter(Boolean);
  const mods = []; let key = null;
  for (const p of parts) {
    const m = MODS[p.toLowerCase()];
    if (m !== undefined) { if (!mods.includes(m)) mods.push(m); continue; }
    if (key !== null) return { ok: false, error: `more than one non-modifier key in "${combo}"` };
    key = keyVk(p);
    if (key === null) return { ok: false, error: `unknown key "${p}"` };
  }
  if (key === null && !mods.length) return { ok: false, error: 'no keys' };
  return { ok: true, mods, key };
}

// ---------- nut-js mouse (optional) ----------
function loadNut() {
  const nut = require('@nut-tree-fork/nut-js');
  nut.mouse.config.autoDelayMs = 0; // default 100ms per action would make the cursor laggy
  nut.mouse.config.mouseSpeed = 100000;
  const L = nut.Button.LEFT;
  const unit = process.platform === 'win32' ? 120 : 1; // libnut on Windows passes raw wheel delta
  return {
    name: 'nut-js',
    move: (x, y) => nut.mouse.setPosition(new nut.Point(x, y)),
    down: () => nut.mouse.pressButton(L),
    up: () => nut.mouse.releaseButton(L),
    click: () => nut.mouse.click(L),
    scroll: (n) => (n > 0 ? nut.mouse.scrollDown(n * unit) : nut.mouse.scrollUp(-n * unit)),
    // Raw wheel delta, positive = up. libnut passes it straight through on Windows (sub-notch = smooth).
    wheelUnits: (d) => (process.platform === 'win32'
      ? (d > 0 ? nut.mouse.scrollUp(d) : nut.mouse.scrollDown(-d))
      : (d > 0 ? nut.mouse.scrollUp(Math.max(1, Math.round(d / 120))) : nut.mouse.scrollDown(Math.max(1, Math.round(-d / 120))))),
  };
}

// ---------- user32 via koffi ----------
function loadWin32() {
  if (process.platform !== 'win32') throw new Error('user32 backend is Windows-only');
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');

  const POINT = koffi.struct('HC_POINT', { x: 'int32_t', y: 'int32_t' });
  const RECT = koffi.struct('HC_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  const MOUSEINPUT = koffi.struct('HC_MOUSEINPUT', { dx: 'int32_t', dy: 'int32_t', mouseData: 'uint32_t', dwFlags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t' });
  const KEYBDINPUT = koffi.struct('HC_KEYBDINPUT', { wVk: 'uint16_t', wScan: 'uint16_t', dwFlags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t' });
  const HARDWAREINPUT = koffi.struct('HC_HARDWAREINPUT', { uMsg: 'uint32_t', wParamL: 'uint16_t', wParamH: 'uint16_t' });
  const INPUT_U = koffi.union('HC_INPUT_U', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT });
  const INPUT = koffi.struct('HC_INPUT', { type: 'uint32_t', u: INPUT_U });
  const INPUT_SIZE = koffi.sizeof(INPUT); // 40 on 64-bit

  const SendInput = user32.func('uint32_t __stdcall SendInput(uint32_t cInputs, HC_INPUT *pInputs, int cbSize)');
  const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)');
  const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ HC_POINT *p)');
  const WindowFromPoint = user32.func('intptr_t __stdcall WindowFromPoint(HC_POINT p)');
  const GetAncestor = user32.func('intptr_t __stdcall GetAncestor(intptr_t hwnd, uint32_t flags)');
  const GetWindow = user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)');
  const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ uint16_t *buf, int n)');
  const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint16_t *buf, int n)');
  const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ HC_RECT *r)');
  const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)');
  const ShowWindow = user32.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)');
  const IsZoomed = user32.func('bool __stdcall IsZoomed(intptr_t hwnd)');
  const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hwnd)');
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)');
  const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr_t hwnd)');
  const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
  const GetShellWindow = user32.func('intptr_t __stdcall GetShellWindow()');
  const GetDesktopWindow = user32.func('intptr_t __stdcall GetDesktopWindow()');

  const INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
  const KEYUP = 0x0002, EXTKEY = 0x0001;
  const M = { LEFTDOWN: 0x0002, LEFTUP: 0x0004, RIGHTDOWN: 0x0008, RIGHTUP: 0x0010, MIDDLEDOWN: 0x0020, MIDDLEUP: 0x0040, WHEEL: 0x0800, HWHEEL: 0x1000 };
  const NOTCH = 120;

  const mi = (flags, data = 0) => ({ type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: data >>> 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } });
  const ki = (vk, up) => ({ type: INPUT_KEYBOARD, u: { ki: { wVk: vk, wScan: 0, dwFlags: (up ? KEYUP : 0) | (EXTENDED.has(vk) ? EXTKEY : 0), time: 0, dwExtraInfo: 0 } } });

  // Send a batch atomically; fall back to one-by-one if array marshalling is refused.
  let batchOk = true;
  function send(inputs) {
    if (!inputs.length) return 0;
    if (batchOk) {
      try { return SendInput(inputs.length, inputs, INPUT_SIZE); }
      catch { batchOk = false; }
    }
    let n = 0;
    for (const i of inputs) n += SendInput(1, i, INPUT_SIZE);
    return n;
  }

  const held = new Set(); // keys currently held down by us (released on emergency)
  function tapVks(mods, key) {
    const seq = [];
    for (const m of mods) seq.push(ki(m, false));
    if (key !== null && key !== undefined) { seq.push(ki(key, false)); seq.push(ki(key, true)); }
    for (const m of [...mods].reverse()) seq.push(ki(m, true));
    const n = send(seq);
    if (n !== seq.length) {
      for (const m of mods) send([ki(m, true)]); // never leave a modifier stuck
      throw new Error(`SendInput sent ${n}/${seq.length} events (blocked by UIPI or a secure desktop?)`);
    }
  }

  function wstr(fn, hwnd) {
    const buf = new Uint16Array(256);
    const n = fn(hwnd, buf, 256);
    return n > 0 ? String.fromCharCode(...buf.subarray(0, n)) : '';
  }
  const rectOf = (hwnd) => { const r = {}; return GetWindowRect(hwnd, r) ? r : null; };
  const cursor = () => { const p = {}; GetCursorPos(p); return { x: p.x, y: p.y }; };

  const IGNORE_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow']);
  const GA_ROOT = 2, GW_HWNDNEXT = 2;
  const SW_RESTORE = 9;
  const SWP = { NOSIZE: 0x0001, NOMOVE: 0x0002, NOZORDER: 0x0004, NOACTIVATE: 0x0010, ASYNC: 0x4000 };

  // Top-level window under a physical point, skipping our own windows (by hwnd) and the shell.
  function topWindowAt(pt, ownHwnds = []) {
    const own = new Set(ownHwnds.map(Number));
    let hwnd = Number(GetAncestor(WindowFromPoint(pt), GA_ROOT));
    if (own.has(hwnd)) {
      // Our overlay should be hit-test transparent, but if it isn't, walk the z-order below it.
      hwnd = Number(GetWindow(hwnd, GW_HWNDNEXT));
      while (hwnd) {
        const r = IsWindowVisible(hwnd) && !IsIconic(hwnd) && !own.has(hwnd) ? rectOf(hwnd) : null;
        if (r && pt.x >= r.left && pt.x < r.right && pt.y >= r.top && pt.y < r.bottom) break;
        hwnd = Number(GetWindow(hwnd, GW_HWNDNEXT));
      }
    }
    if (!hwnd || own.has(hwnd) || hwnd === Number(GetShellWindow()) || hwnd === Number(GetDesktopWindow())) return null;
    const cls = wstr(GetClassNameW, hwnd);
    if (IGNORE_CLASSES.has(cls)) return null;
    return { hwnd, cls, title: wstr(GetWindowTextW, hwnd), rect: rectOf(hwnd), maximized: !!IsZoomed(hwnd) };
  }

  function bringToFront(hwnd) {
    if (Number(GetForegroundWindow()) === hwnd) return true;
    if (SetForegroundWindow(hwnd)) return true;
    // Foreground lock: hold Alt while asking, with a dummy key so Alt's release doesn't open a menu.
    send([ki(0x12, false)]);
    const ok = SetForegroundWindow(hwnd);
    send([ki(0xff, false), ki(0xff, true), ki(0x12, true)]);
    if (!ok) SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP.NOMOVE | SWP.NOSIZE | SWP.NOACTIVATE);
    return ok;
  }

  const mouse = {
    name: 'user32',
    move: async (x, y) => { SetCursorPos(x, y); },
    down: async () => { send([mi(M.LEFTDOWN)]); },
    up: async () => { send([mi(M.LEFTUP)]); },
    click: async () => { send([mi(M.LEFTDOWN), mi(M.LEFTUP)]); },
    scroll: async (n) => { send([mi(M.WHEEL, -n * NOTCH)]); }, // positive wheel delta = scroll up
    wheelUnits: async (d) => { send([mi(M.WHEEL, d)]); },      // raw delta, positive = up
  };

  return {
    mouse,
    keys(combo) {
      const p = parseCombo(combo);
      if (!p.ok) throw new Error(p.error);
      tapVks(p.mods, p.key);
    },
    media(key) {
      const vk = MEDIA[key];
      if (!vk) throw new Error(`unknown media key "${key}"`);
      tapVks([], vk);
    },
    tapVk: (vk) => tapVks([], vk),
    button(which) {
      if (which === 'right') send([mi(M.RIGHTDOWN), mi(M.RIGHTUP)]);
      else if (which === 'middle') send([mi(M.MIDDLEDOWN), mi(M.MIDDLEUP)]);
      else if (which === 'double') send([mi(M.LEFTDOWN), mi(M.LEFTUP), mi(M.LEFTDOWN), mi(M.LEFTUP)]);
      else throw new Error(`unknown button "${which}"`);
    },
    wheel(notches, horizontal = false) {
      if (!notches) return;
      send([horizontal ? mi(M.HWHEEL, notches * NOTCH) : mi(M.WHEEL, -notches * NOTCH)]);
    },
    // Release everything we might be holding (left button + modifiers).
    releaseAll() {
      send([mi(M.LEFTUP), ...[0x11, 0x12, 0x10, 0x5b].map((vk) => ki(vk, true))]);
      held.clear();
    },
    cursor,
    setCursor: (x, y) => SetCursorPos(Math.round(x), Math.round(y)),
    topWindowAt,
    windowRect: rectOf,
    restore(hwnd) { ShowWindow(hwnd, SW_RESTORE); return rectOf(hwnd); },
    bringToFront,
    moveWindowTo(hwnd, x, y) {
      return SetWindowPos(hwnd, 0, Math.round(x), Math.round(y), 0, 0, SWP.NOSIZE | SWP.NOZORDER | SWP.NOACTIVATE | SWP.ASYNC);
    },
  };
}

// Returns { mouse, mouseError, win32, win32Error }. mouse may be nut-js or win32.mouse.
function loadInput() {
  let win32 = null, win32Error = null;
  try { win32 = loadWin32(); } catch (e) { win32Error = (e && e.message ? e.message : String(e)).split('\n')[0]; }
  const errors = [];
  let mouse = null;
  if (!process.env.HAND_NO_NUT) {
    try { mouse = loadNut(); } catch (e) { errors.push(`nut-js: ${(e && e.message ? e.message : String(e)).split('\n')[0]}`); }
  }
  if (!mouse && win32) mouse = win32.mouse;
  if (!mouse && win32Error) errors.push(`user32: ${win32Error}`);
  return { mouse, mouseError: mouse ? null : errors.join(' | '), win32, win32Error };
}

module.exports = { loadInput, parseCombo, MEDIA };
