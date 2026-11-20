# Lectern

Worship presentation software for Windows and macOS with **six independent outputs**. Each output can send NDI, show fullscreen on a screen or projector, or do both.

## Install

| Platform | File | Notes |
|---|---|---|
| Windows 10/11 (64-bit) | `Lectern-Setup-1.1.1.exe` | Installer with Start menu and desktop shortcuts, `.lectern` file association and a firewall rule. Not code-signed, so SmartScreen will warn: choose **More info → Run anyway**. |
| Windows (portable) | `Lectern-1.1.1-win.zip` | Unzip anywhere and run `Lectern.exe`. |
| Mac (Apple Silicon and Intel) | `Lectern-1.1.1-universal.dmg` | One universal app for every Mac. See "First run on a Mac" below. |
| Mac (zip) | `Lectern-1.1.1-universal-mac.zip` | Same app as the DMG, zipped. |

**NDI:** install the free [NDI Tools](https://ndi.video/tools/) (or the NDI 6 Runtime) on the presentation computer. Lectern finds the NDI library automatically. If it is somewhere unusual, set its location under Settings → NDI. Without NDI, screen outputs and previews still work, and a banner explains what's missing.

### First run on a Mac

These builds are not signed with an Apple Developer ID. Open the DMG (or unzip the zip), drag `Lectern.app` to Applications, then run this once in Terminal:

```bash
xattr -cr /Applications/Lectern.app && codesign --force --deep --sign - /Applications/Lectern.app
```

When macOS asks to let Lectern find devices on your local network, click **Allow**. NDI needs this permission.

## Using it

- **Service order (left):** add songs, scripture, text slides, countdowns, media and blanks. Drag to reorder. Double-click an item to put it on screen.
- **Slides (middle):** click a slide to go live. Use → / Space / Page Down for next, ← / Page Up for previous, and 1–9 to jump to a slide in the selected item.
- **Clear buttons:** F1 clears everything, F2 media, F3 slide, F4 props, F6 message. **Restore** brings media, slide and props back.
- **Right column:** live and up-next monitors, stage timer, audience message, a private stage message, NDI inputs and the Claude chat panel.
- **Outputs (bottom):** turn each output on or off. The ⚙ button sets the look, resolution, frame rate, NDI groups, transparency and an optional screen.
- **Songs:** in the lyrics, use `[Verse 1]`, `[Chorus]` and so on to start sections, and a blank line to start a new slide. The arrangement field reorders sections. Import accepts SongSelect `.txt` files.
- **Bible:** the King James Version is built in. Type a reference such as `Psalm 23`, `John 3:16-18` or `1 Cor 13:4-7`.
- **Phone remote:** open the address shown at the bottom right on a phone on the same network and enter the PIN (Settings → Phone remote).
- **CCLI:** song uses are logged when a song first goes live. Export them under Settings or File → Export CCLI Usage.
- **Files:** File → Save stores a `.lectern` file that contains the service and its songs.

### Panels

- Click a panel's title to minimize it to its header, and click again to expand it.
- Drag the dividers between the columns, and above the outputs, to resize them. Double-click a column divider, or use its arrow button, to hide that column.
- Drag the bottom edge of the service order, Inputs or Claude panel to change its height.
- The layout is remembered. **View → Reset Panel Layout** puts it back.

### Text boxes, shapes and presets

- Select an item and click **Text boxes & shapes** above the slides.
- Drag a box to move it and drag a corner to resize it. For each box, set the text size (in % of screen height), font, colour, alignment, bold, italic and uppercase. **+ Fixed text box** adds a box with your own text.
- Give any text box a background shape (rectangle, rounded rectangle or ellipse) with its own fill colour, opacity and border. **+ Shape** adds a shape on its own, for example a band behind the lyrics. **Bring forward** and **Send back** change which box is in front.
- **Use for this item** or **Use for every item in the service** applies the layout. Type a name and click **Save** to keep it as a text preset, then pick it under **Start from** later.
- The layout is used on the Main, Lyrics key and Lobby looks. **Built-in look for this item** returns an item to the standard layout.

### Backgrounds that change during a song

- Drag a background from **Library → Media** (or an NDI input from the Inputs panel) onto a slide.
- It is used on that slide and every slide after it in the item, including repeated choruses, until a later slide where you dropped another background.
- The slide shows a ▸ marker with the background's name. Click its ✕ to remove that change.

### NDI inputs

- In the **Inputs** panel, click **+ NDI input** and pick a source found on the network.
- **Background** uses the input behind the selected item's slides. **Full screen** adds it to the service and puts it on screen. You can also drag an input onto a slide, or choose it in the Background menu.
- **Audio** turns the input's sound on or off, and the slider sets its volume. Input audio works whether or not the input is on screen, and plays through the device chosen in Settings → Audio.

If Lectern closes unexpectedly while NDI inputs are running, it starts the next time with inputs paused, and the Inputs panel offers **Resume inputs**.

### Audio devices and Dante

- Settings → Audio chooses the device for NDI input audio. Each output's ⚙ settings choose the device for that output's video sound.
- To send sound to Dante, choose **Dante Via** (or Dante Virtual Soundcard) as the device. Lectern needs no Dante software of its own.

### Video playback speed

- Click a video in **Library → Media**. Under Playback, choose a speed from 50% to 200%. The default is 100%.
- **Sound** either follows the video's speed or stays at 100%. Keeping it at 100% suits videos without speech, because it can drift from the picture.
- **Reset to 100%** goes back to normal. Changes apply straight away, even while the video is live, and are saved with the service.

### PowerPoint

- Use **+ Add → PowerPoint file…**, **File → Import PowerPoint…**, or drag a `.pptx` file onto the service order.
- **As text slides:** each slide's heading and text become editable Lectern slides, styled by your text boxes and presets.
- **As pictures:** each slide becomes an image that looks exactly like the original. This uses PowerPoint on Windows if it is installed, otherwise the free [LibreOffice](https://www.libreoffice.org/). Older `.ppt` files need LibreOffice.

### Claude

Both ways use the same Lectern controls. Lectern shows you each change and asks before making it. Anything that changes what is on screen always asks. **Edit → Undo Claude Change** (or **Undo** in the Claude panel) reverses the last change. Imported files stay in the media library after an undo.

- **Claude desktop app:** open Settings → Claude and click **Copy setup for Claude app**. In the Claude app, open Settings → Developer → Edit Config, paste it into `claude_desktop_config.json` (merging with anything already there), save, and restart the Claude app. Lectern must be open. This uses your Claude subscription and can import files from this computer.
- **Chat panel:** enter an Anthropic API key in Settings → Claude, then type requests in the Claude panel. The key is stored encrypted, and usage is billed to your Anthropic account. The panel needs an internet connection.

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

### If something goes wrong

Lectern writes a log to `lectern.log` in its data folder (**Help → Open Log Folder**): on Windows `%APPDATA%\Lectern\logs`, on a Mac `~/Library/Application Support/Lectern/logs`. Crash reports stay on this computer (**Help → Open Crash Reports Folder**). Nothing is uploaded.

## How it works

- Electron app. The main process owns the state (`src/main/main.js`), and every window renders from it.
- Each output has its own **offscreen Chromium renderer** (`src/main/outputs.js`). Its frames pass through triple-buffered shared memory to a **worker thread per output** (`src/main/ndi-worker.js`). The worker sends them with the NDI SDK at the output's frame rate and repeats the last frame, so receivers that connect late still get a picture.
- NDI is called through [koffi](https://koffi.dev) FFI (`src/main/ndi.js`), so no native code is compiled. Transparent outputs are converted from Chromium's premultiplied alpha to the straight alpha NDI expects.
- All looks share one renderer (`src/renderer/shared/render.js`). The previews in the control window match what is sent, and text auto-shrinks to fit.
- NDI inputs run one receiver worker per input (`src/main/input-worker.js`, managed by `src/main/inputs.js`). Full frames go only to windows showing the input, small previews go to the control window, and audio goes to a hidden audio window (`src/renderer/audio.js`) that sends it to the chosen device.
- PowerPoint import is in `src/main/pptx.js`. Picture mode renders slides with PowerPoint, or with LibreOffice and [pdf.js](https://mozilla.github.io/pdf.js/) in a hidden window.
- The Claude tools are defined once in `src/main/bridge.js`. The Claude app connector (`src/mcp/lectern-mcp.js`) reaches them through a local API on 127.0.0.1 with a private token, and the chat panel (`src/main/chat.js`) calls them directly.

## Building from source

```bash
npm install
```

```bash
npm start
```

- Windows installer, on Windows: `npm run dist:win`.
- Universal, signed DMG, on a Mac: `npm run dist:mac`. Set `CSC_LINK`/`CSC_KEY_PASSWORD` to sign, and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` to notarize.
- Cross-building from Linux (no Wine): `npx electron-builder --win zip -c.win.signAndEditExecutable=false`, then `makensis -DVERSION=1.0.0 -DSRCDIR=../dist/win-unpacked -DOUTFILE=../dist/Lectern-Setup-1.1.1.exe build/standalone-installer.nsi` run from the `build` folder. For Mac: `node build/package-mac.js`.
- CI: `.github/workflows/build.yml` builds both platforms on GitHub's Windows and macOS runners when you push a `v*` tag or run the **Build** workflow from the Actions tab. The files are attached to the run as `lectern-Windows` and `lectern-macOS`.

### NDI loopback test

This test sends a frame through the real sender and receives it back:

```bash
NDI_RUNTIME_DIR_V6="/path/to/ndi/lib" npm run test:ndi
```

It should print `PASS`.

NDI® is a registered trademark of Vizrt NDI AB. Lectern uses the NDI runtime installed on the user's computer. Follow the NDI SDK license if you redistribute the runtime.
