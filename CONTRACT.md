# HandControl v2 — shared contract

The app is now a **gesture control layer for Windows**. The card dashboard is dropped from the app.
The tray's "Dashboard" item becomes **Settings**, a glass-styled window for editing gesture bindings.

## 1. tracking.js output (owner: tracking agent)
Each hand object keeps all existing fields (`id, x, y, pinch, pinchStrength, gesture, landmarks`) and adds:
```js
fingers: { thumb, index, middle, ring, pinky }   // booleans, true = clearly extended (debounced ~3 frames)
pose: string   // best-matching built-in pose id (debounced ~3 frames), or 'none'
```
Built-in pose ids (pinch still wins as gesture/pose 'pinch'):
| id | fingers up |
|---|---|
| `open` | all five, spread (strict, uses isWideOpenPalm) |
| `fist` | none |
| `point` | index |
| `two` | index + middle (V) |
| `three` | index + middle + ring |
| `thumb` | thumb only (thumbs up) |
| `rock` | index + pinky |
| `call` | thumb + pinky |
| `L` | thumb + index |
| `pinky` | pinky only |
Also export `export const POSES = [{ id, label, fingers:{thumb,index,middle,ring,pinky} }]` for the settings UI.

## 2. Config (owner: electron agent; stored at `app.getPath('userData')/config.json`, defaults in `electron/config.js`)
```js
{
  version: 2,
  enabled: false,              // control starts paused/off each launch regardless
  primaryHand: 'Right',        // 'Right' | 'Left'
  comfortBox: { w: 0.7, h: 0.6 },
  cursorSmoothing: 0.5,        // 0..1
  clickMaxMs: 250,
  bindings: [ Binding ]
}
Binding = {
  id: string, enabled: boolean, name: string,
  pose: <pose id>, hand: 'any' | 'Left' | 'Right',
  holdMs: number,              // pose must be held this long before firing / engaging (default 500)
  cooldownMs: number,          // for trigger actions (default 1000)
  action: Action
}
Action (trigger = fires once per hold; continuous = active while pose is held):
  { type: 'media', key: 'playpause'|'next'|'prev'|'volup'|'voldown'|'mute' }     // trigger
  { type: 'keys', combo: 'Ctrl+Shift+T' }  // trigger; modifiers Ctrl Alt Shift Win + key (A-Z, 0-9, F1-F24, Tab, Enter, Esc, Space, Up/Down/Left/Right, Home, End, PageUp, PageDown, Delete, Backspace, PrintScreen)
  { type: 'launch', target: 'C:\\path\\app.exe' | 'https://...' }            // trigger
  { type: 'mouse', button: 'right' | 'double' | 'middle' }                   // trigger (at cursor)
  { type: 'togglePause' }                                                    // trigger
  { type: 'moveWindow' }    // continuous: grab top-level window under cursor at engage, move it by hand delta, release on pose end
  { type: 'scroll', speed: 1 }   // continuous: vertical hand motion -> wheel (horizontal optional)
  { type: 'none' }
```
Default bindings: `fist` → moveWindow (holdMs 250); `two` → media playpause; `three` → scroll;
`thumb` → media next; `pinky` → media prev; `open` → togglePause (holdMs 1600); `call` → keys `Win+D` (disabled by default).

Core pointer is always on (not a binding): pinch point moves the cursor; quick pinch = left click; held pinch = drag.
While a continuous binding is engaged or a pose other than pinch/point/none is active, clicking is suppressed.

## 3. IPC — `window.hand` from `electron/preload.js` (owner: electron agent)
```js
hand.getConfig(): Promise<Config>
hand.setConfig(cfg): Promise<void>        // validates, saves, broadcasts
hand.resetConfig(): Promise<Config>
hand.onConfig(cb)                         // cb(cfg) on any change
hand.testAction(action): Promise<{ok, error?}>   // run an action now (from Settings)
hand.onTelemetry(cb)                      // Settings only. ~15 Hz:
  // { status, enabled, paused, hands:[{id,x,y,pose,fingers,pinch,pinchStrength}], activeBinding: id|null, holdProgress: 0..1, lastAction: {name, at} | null, mouseBackend }
hand.setEnabled(bool), hand.setPaused(bool)
hand.getPoses(): Promise<POSES>           // may just import from tracking.js in renderer instead
// overlay-only: existing hand.send(intent) plus whatever the electron agent needs internally
```
The overlay window runs the tracker whenever the app runs (so Settings can show live poses even when control is off),
and posts telemetry to main, which forwards it to the Settings window if open. Settings never opens the camera itself.
