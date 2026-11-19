# Lectern roadmap

Planned changes after 1.0.0. Nothing here is built yet.

Plan for building: one item at a time on a branch, each checked in a test build, with installers to try before it goes on `main`.

## 1. Resizable and minimizable panels

- Every panel (service order, songs, Bible, media, slides, live, up next, timer and messages, outputs, and the new Inputs panel) can be resized by dragging the edges between panels.
- Every panel can be minimized to its header and expanded again.
- Panels keep their current places.
- The layout is remembered between sessions, with a **Reset layout** option.

## 2. Editable text boxes on slides

- Drag and resize the text boxes on a slide. A slide can have more than one box.
- Set text size, font, color and alignment for each box.
- Apply a layout to every item in the service in one step.
- Save a layout as a named **text preset** and apply it later.

## 3. Changing backgrounds within a song

- Drag a background from the media panel and drop it on a slide.
- It applies to that slide and every slide after it in the song, including repeated sections, until another background is dropped on a later slide.
- A song can have as many background changes as needed.

## 4. NDI inputs

- A new **Inputs** panel, resizable and minimizable like the others, lists the NDI sources on the network with a preview of each.
- Any input can be used as a **background** behind slides, or as a **full-screen source**.
- Input audio is received with the video.
- Each input's audio has its own on/off and volume, separate from whether the input is on screen.

## 5. Dante audio

- The presentation PC has **Dante Via** installed.
- Each output gets an audio device choice, plus a main audio setting, so sound can go to Dante Via or any other device.
- Dante Via picks up Lectern's audio from the device it is set to capture. No Dante developer kit is needed.

## 6. Playback speed for videos

- In each video's options menu in the media panel, not under the Live monitor:
  - Speed from 0.5× to 2×. The default is always 100%.
  - Audio either **follows the video's speed** or **stays at 100%**. Drift doesn't matter for videos without dialogue.
  - One click resets the speed to 100%.
- Changing the speed while the video is live takes effect straight away.
- The speed is saved with the video in the service.

## 7. Claude control bridge

Control changes such as font size, importing files and backgrounds by asking Claude. Both options below are planned, and they share one set of Lectern controls so they behave the same way.

- **A. Claude app connector**
  - Lectern includes an MCP connector that is added once to the Claude desktop app on the presentation PC.
  - Uses the existing Claude subscription, with no separate API key.
  - Can read files on the PC, for imports of songs, media and backgrounds.
- **B. Chat panel in Lectern**
  - A resizable, minimizable panel for typed requests.
  - Needs an Anthropic API key entered in Settings, billed per use. The panel is off until a key is added.
  - Needs internet access while in use.
- **Safety rules for both:**
  - Changes are shown before they happen.
  - Lectern asks before anything affects the live output during a service.
  - Everything can be undone.
- **Open question:** whether the chat panel should also appear on the phone remote.

## 8. PowerPoint import

- Import `.pptx` files from the File menu, or by dragging them onto the service order.
- Two ways to import:
  - **As text slides:** each PowerPoint slide becomes an editable Lectern slide, keeping its text and its order. Text can then be restyled with Lectern's text boxes and presets.
  - **As pictures:** each slide becomes an image, so it looks exactly like the original, including its design and graphics. This needs PowerPoint or the free LibreOffice installed on the PC to turn the slides into images.
- The imported slides become one item in the service, with the file name as its title.
- Older `.ppt` files are converted the same way as pictures, when PowerPoint or LibreOffice is available.
