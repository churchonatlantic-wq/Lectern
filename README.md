# Lectern

Worship presentation software for Windows and macOS with **six independent outputs**. Each output can send NDI, show fullscreen on a screen or projector, or do both.

## Install

| Platform | File | Notes |
|---|---|---|
| Windows 10/11 (64-bit) | `Lectern-Setup-1.0.0.exe` | Installer with Start menu and desktop shortcuts, `.lectern` file association and a firewall rule. Not code-signed, so SmartScreen will warn: choose **More info → Run anyway**. |
| Windows (portable) | `Lectern-1.0.0-win.zip` | Unzip anywhere and run `Lectern.exe`. |
| Mac with Apple Silicon (M1 and later) | `Lectern-1.0.0-mac-apple-silicon.zip` | See "First run on a Mac" below. |
| Mac with Intel | `Lectern-1.0.0-mac-intel.zip` | See "First run on a Mac" below. |

**NDI:** install the free [NDI Tools](https://ndi.video/tools/) (or the NDI 6 Runtime) on the presentation computer. Lectern finds the NDI library automatically. If it is somewhere unusual, set its location under Settings → NDI. Without NDI, screen outputs and previews still work, and a banner explains what's missing.

### First run on a Mac

These builds are not signed with an Apple Developer ID. Unzip, drag `Lectern.app` to Applications, then run this once in Terminal:

```bash
xattr -cr /Applications/Lectern.app && codesign --force --deep --sign - /Applications/Lectern.app
```

When macOS asks to let Lectern find devices on your local network, click **Allow**. NDI needs this permission.

## Using it

- **Service order (left):** add songs, scripture, text slides, countdowns, media and blanks. Drag to reorder. Double-click an item to put it on screen.
- **Slides (middle):** click a slide to go live. Use → / Space / Page Down for next, ← / Page Up for previous, and 1–9 to jump to a slide in the selected item.
- **Clear buttons:** F1 clears everything, F2 media, F3 slide, F4 props, F6 message. **Restore** brings media, slide and props back.
- **Right column:** live and up-next monitors, stage timer, audience message, and a private stage message.
- **Outputs (bottom):** turn each output on or off. The ⚙ button sets the look, resolution, frame rate, NDI groups, transparency and an optional screen.
- **Songs:** in the lyrics, use `[Verse 1]`, `[Chorus]` and so on to start sections, and a blank line to start a new slide. The arrangement field reorders sections. Import accepts SongSelect `.txt` files.
- **Bible:** the King James Version is built in. Type a reference such as `Psalm 23`, `John 3:16-18` or `1 Cor 13:4-7`.
- **Phone remote:** open the address shown at the bottom right on a phone on the same network and enter the PIN (Settings → Phone remote).
- **CCLI:** song uses are logged when a song first goes live. Export them under Settings or File → Export CCLI Usage.
- **Files:** File → Save stores a `.lectern` file that contains the service and its songs.

### Output looks

| Look | What it shows | Default transparency |
|---|---|---|
| Main | Lyrics/scripture over the background, logo, audience message | No |
| Lower third | Text in a band at the bottom, for keying over cameras | Yes (alpha) |
| Lyrics key | Outlined text only, for keying over cameras | Yes (alpha) |
| Stage display | Clock, timer, current and next slide, stage message | No |
| Lobby | Background plus announcement slides that cycle on their own | No |
| Clean feed | Background media only | No |

NDI sources appear on the network as `LECTERN 1 (Main)`, `LECTERN 2 (Lower Third)` and so on. You can change the prefix in Settings.

## How it works

- Electron app. The main process owns the state (`src/main/main.js`), and every window renders from it.
- Each output has its own **offscreen Chromium renderer** (`src/main/outputs.js`). Its frames pass through triple-buffered shared memory to a **worker thread per output** (`src/main/ndi-worker.js`). The worker sends them with the NDI SDK at the output's frame rate and repeats the last frame, so receivers that connect late still get a picture.
- NDI is called through [koffi](https://koffi.dev) FFI (`src/main/ndi.js`), so no native code is compiled. Transparent outputs are converted from Chromium's premultiplied alpha to the straight alpha NDI expects.
- All looks share one renderer (`src/renderer/shared/render.js`). The previews in the control window match what is sent, and text auto-shrinks to fit.

## Building from source

```bash
npm install
```

```bash
npm start
```

- Windows installer, on Windows: `npm run dist:win`.
- Universal, signed DMG, on a Mac: `npm run dist:mac`. Set `CSC_LINK`/`CSC_KEY_PASSWORD` to sign, and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` to notarize.
- Cross-building from Linux (no Wine): `npx electron-builder --win zip -c.win.signAndEditExecutable=false`, then `makensis -DVERSION=1.0.0 -DSRCDIR=../dist/win-unpacked -DOUTFILE=../dist/Lectern-Setup-1.0.0.exe build/standalone-installer.nsi` run from the `build` folder. For Mac: `node build/package-mac.js`.
- CI: `.github/workflows/build.yml` builds both platforms on GitHub's Windows and macOS runners when you push a `v*` tag.

### NDI loopback test

This test sends a frame through the real sender and receives it back:

```bash
NDI_RUNTIME_DIR_V6="/path/to/ndi/lib" npm run test:ndi
```

It should print `PASS`.

NDI® is a registered trademark of Vizrt NDI AB. Lectern uses the NDI runtime installed on the user's computer. Follow the NDI SDK license if you redistribute the runtime.
