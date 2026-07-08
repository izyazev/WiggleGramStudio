# WiggleGram Studio

WiggleGram Studio is a desktop app for making wigglegram animations from 2-4 Nishika N8000 photos. Processing is local: source photos are not changed and are not uploaded anywhere.

Repository: https://github.com/izyazev/WiggleGramStudio

## Features

- Import 2-4 photos with a file dialog or drag-and-drop.
- Reorder frames by dragging thumbnails.
- Set an anchor point on every frame with zoom controls.
- Align frames by X/Y offset without stretching or perspective distortion.
- Crop manually, auto-crop to the common visible area, or use 4:3, 3:4, 16:9, and 9:16 presets.
- Preview ping-pong or loop animation with adjustable frame speed.
- Optional Smooth intermediate frames through FFmpeg optical flow.
- Export MP4/H.264, GIF, or aligned image sets in PNG, JPG, and TIFF.
- Export image sets for printing and lenticular workflows.
- Russian and English UI with system-language detection.

## Install From Release

1. Open the [Releases](https://github.com/izyazev/WiggleGramStudio/releases) page.
2. Download the latest `WiggleGram Studio_..._aarch64.dmg`.
3. Open the `.dmg`.
4. Drag `WiggleGram Studio.app` to `Applications`.
5. Launch the app.

If macOS says the app cannot be opened because it is from an unidentified developer, open it with right click -> Open. This can happen until the app is signed and notarized with an Apple Developer account.

## Build From Source

Requirements:

- macOS
- Node.js 20+
- Rust stable
- FFmpeg with H.264 support

Install dependencies:

```bash
git clone https://github.com/izyazev/WiggleGramStudio.git
cd WiggleGramStudio
npm install
```

Add FFmpeg for local development:

```bash
brew install ffmpeg
npm run ffmpeg:link
```

`npm run ffmpeg:link` creates a local sidecar link in `src-tauri/binaries/`. The linked binary is ignored by Git.

Run the app in development mode:

```bash
npm run tauri dev
```

Run checks:

```bash
npm test
npm run build
cd src-tauri && cargo test
```

Build a macOS app and DMG:

```bash
npm run tauri build -- --bundles dmg
```

The DMG will be created in:

```text
src-tauri/target/release/bundle/dmg/
```

## FFmpeg Distribution

The app uses FFmpeg as a Tauri sidecar binary and does not rely on the user's system `PATH` at runtime.

For development, `npm run ffmpeg:link` can link to a locally installed FFmpeg. For public releases, bundle a specific, tested FFmpeg binary for the target architecture.

This project is distributed under GNU General Public License v3.0. If a release DMG includes FFmpeg/x264, make sure the release also satisfies the license requirements of the bundled FFmpeg build and its codecs.

## Future Windows Build

The React/TypeScript model and Rust image-processing logic are platform independent. A Windows build should be possible by adding a Windows FFmpeg sidecar, adding an installer target such as `nsis` or `msi` in `tauri.conf.json`, and running the Tauri build on Windows.
