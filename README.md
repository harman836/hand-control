# Hand Control

A customisable hand-gesture control layer for Windows. It's an Electron tray app that tracks your hand through the webcam (MediaPipe, `tracking.js`) and turns poses into real input: cursor, clicks, drags, keyboard shortcuts, media keys, app launching, scrolling and moving windows.

## Download

Grab the latest build from [Releases](https://github.com/harman836/hand-control/releases/latest): the **x64** files for most Windows PCs, **arm64** for Windows on ARM. The installers aren't code-signed, so SmartScreen may warn you (More info → Run anyway). The first launch needs internet to download the hand model.

## Run / build

```bash
npm install
npm start                  # dev run; opens Settings
npm start -- --tray        # start in the tray only (no Settings window)
npm start -- --control     # start with desktop control on (still paused)
npm run dist               # builds for this PC's CPU: dist/HandControl-<ver>-<arch>-portable.exe + -setup.exe
npm run dist:x64           # or force an architecture (dist:arm64)
```

Set `HAND_DEBUG=1` to print all renderer console output and every fired action in the terminal.

## How it works

- The **overlay** is a transparent, click-through, always-on-top window over the primary display. It runs the tracker whenever the app runs, so Settings always shows live poses. It only sends input when desktop control is **on** and **not paused**. While control is off it draws nothing.
- **Settings** (tray > Settings, or double-click the tray icon) edits gesture bindings and shows live tracking. It never opens the camera itself.
- Input goes through `user32.dll` via `koffi` (`SendInput`, `SetCursorPos`, `SetWindowPos`). `@nut-tree-fork/nut-js` is still tried first for the mouse, but its prebuild is x64-only, so on Windows on ARM the app uses user32. The tray menu shows the active backend.
- Control always starts **off** at launch, and turning it on always starts **paused**.

## Core pointer (always on, primary hand)

| Gesture | Action |
|---|---|
| Move the pinch point (thumb + index) | Moves the cursor. The central comfort box (default 70% x 60% of the camera view) maps to the full screen |
| Quick pinch (< 250 ms) | Left click. The cursor freezes at pinch onset so it doesn't jump |
| Two quick pinches | Double click |
| Pinch, hold and move | Drag |

Clicking and cursor movement are suppressed while any other pose (fist, two, open...) is up or a binding is active.

## Default bindings

| Pose | Hold | Action |
|---|---|---|
| Fist | 250 ms | **Move window**: grabs the window under the cursor, moves it with your hand, releases when you open the fist. Maximised windows are restored first |
| Two (V) | 500 ms | Play / pause |
| Three | 500 ms | **Scroll**: move your hand up or down |
| Thumbs up | 500 ms | Next track |
| Pinky | 500 ms | Previous track |
| Open palm (wide) | 1600 ms | Pause / resume control |
| Call me (thumb + pinky) | 500 ms | `Win+D` show desktop (disabled by default) |

The ring around the cursor fills while you hold a pose, and the chip at the top shows the binding's name. **Trigger** actions fire once per hold: release the pose (and wait out the cooldown) to fire again. **Continuous** actions (move window, scroll) stay engaged while the pose holds, and they tolerate about 150 ms of tracking dropout.

## Customising

Open **Settings** from the tray. Each binding has a pose, a hand filter (any / left / right), a hold time, a cooldown and an action:

- `media`: play/pause, next, previous, volume up/down, mute
- `keys`: a combo like `Ctrl+Shift+T`. Modifiers are `Ctrl Alt Shift Win`. Keys are `A-Z 0-9 F1-F24 Tab Enter Esc Space Up Down Left Right Home End PageUp PageDown Delete Backspace PrintScreen`
- `launch`: a URL (`https://...`, `ms-settings:`) or a file or app path
- `mouse`: right click, middle click or double click at the cursor
- `togglePause`, `moveWindow`, `scroll` (with speed), `none`

Settings also has primary hand, comfort box size, cursor smoothing and the click time limit. Changes save to `%APPDATA%\Hand Control\config.json`. Invalid or unknown values fall back to their defaults one field at a time, so deleting the file resets everything.

## Hotkeys

| Keys | Action |
|---|---|
| Ctrl+Alt+H | Desktop control on/off |
| Ctrl+Alt+P | Pause / resume (while control is on) |
| Ctrl+Alt+Q | Quit |

The app lives in the system tray. Closing Settings does not quit it.

## Safety

- If your hands leave the frame, or control is paused or turned off, any held mouse button and window grab are released.
- Key combos are pressed and released in a single `SendInput` batch, so a modifier is never left held down.
- If the overlay renderer crashes, held input is released and the overlay restarts.

## Known limits

- **Needs internet.** The MediaPipe runtime loads from cdn.jsdelivr.net and the model from storage.googleapis.com on every start.
- Primary display only. Display scaling is handled: coordinates are converted to physical pixels.
- Windows UIPI blocks synthetic input into elevated (administrator) windows and UAC prompts. Those windows also can't be moved. `Win+L` can't be injected.
- Windows may refuse to bring a grabbed window to the front (foreground lock). It still moves.
- The Settings window uses Windows 11 acrylic (`backgroundMaterial`) on build 22621 or later, and an opaque background otherwise.
- The x64 and arm64 builds are separate. Build each on (or for) its target, because koffi's native package is installed per CPU.
- The executables are unsigned, so Windows SmartScreen may warn on first run.

`index.html`, `dashboard.js` and `styles.css` are the old card dashboard. They're no longer used by the app.
