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
- Check the latest GitHub Release on startup and show an update link in the footer when a newer version is available.

## Install From Release

1. Open the [Releases](https://github.com/izyazev/WiggleGramStudio/releases) page.
2. Download the file for your operating system:
   - Windows 10/11 x64: the latest `*-setup.exe` installer.
   - Apple Silicon macOS: the latest `*_aarch64.dmg` image.
3. Run the installer, then launch WiggleGram Studio.

Release installers bundle FFmpeg. End users do not need Homebrew, a system FFmpeg installation, or any other runtime dependency.

If macOS says the app cannot be opened because it is from an unidentified developer, open it with right click -> Open. This can happen until the app is signed and notarized with an Apple Developer account.

Unsigned Windows installers can show a Microsoft Defender SmartScreen warning. Signing the installer with a trusted code-signing certificate removes that warning for future releases.

## Build From Source

Requirements:

- Node.js 20+
- Rust stable
- FFmpeg with H.264 support for local development (release helpers download compatible standalone builds)
- On Windows: Microsoft C++ Build Tools with the Desktop development with C++ workload and a Windows SDK
- On macOS: Xcode Command Line Tools

Install dependencies:

```bash
git clone https://github.com/izyazev/WiggleGramStudio.git
cd WiggleGramStudio
npm install
```

Add FFmpeg for local development:

Windows 10/11 x64:

```powershell
npm run ffmpeg:download:windows
```

macOS local development:

```bash
brew install ffmpeg
npm run ffmpeg:link
```

The FFmpeg helper creates a platform-specific sidecar in `src-tauri/binaries/`. On Windows it copies `ffmpeg.exe`, avoiding symlink permissions. The generated binary is ignored by Git.

For an Apple Silicon macOS release build, use the pinned standalone binary instead of Homebrew FFmpeg:

```bash
npm run ffmpeg:download:macos
APPLE_SIGNING_IDENTITY=- npm run tauri build
```

The macOS helper verifies both the downloaded archive and extracted binary with SHA-256 before writing the Tauri sidecar. `APPLE_SIGNING_IDENTITY=-` applies an ad-hoc signature for local testing; public distribution without Gatekeeper warnings requires an Apple Developer certificate and notarization.

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

Build an installer for the current operating system:

```bash
npm run tauri build
```

Build output is created in:

```text
Windows: src-tauri/target/release/bundle/nsis/
macOS:   src-tauri/target/release/bundle/dmg/
```

## Creating a Release

Keep the application version synchronized before creating a tag:

```bash
npm run version:set -- 0.2.0
```

Commit the version change, then create and push tag `0.2.0` or `v0.2.0`. The Windows GitHub Actions workflow runs the tests, builds an NSIS installer, and attaches it to the matching GitHub Release. A manually started workflow also produces a downloadable Windows artifact without creating a Release.

## FFmpeg Distribution

The app uses FFmpeg as a Tauri sidecar binary and does not rely on the user's system `PATH` at runtime.

For development, `npm run ffmpeg:link` can use a locally installed FFmpeg. The Windows helper and GitHub Actions workflow use the GPL BtbN Windows build and bundle the resulting x64 binary with the application.

Apple Silicon release builds use a pinned static FFmpeg 6.1.1 binary from the [eugeneware/ffmpeg-static release](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1). It links only to macOS system libraries, so the distributed DMG does not depend on Homebrew or the user's `PATH`.

This project is distributed under GNU General Public License v3.0. If a release DMG includes FFmpeg/x264, make sure the release also satisfies the license requirements of the bundled FFmpeg build and its codecs.

Platform-specific Tauri configuration lives in `tauri.windows.conf.json` and `tauri.macos.conf.json`, so the same source tree builds an NSIS setup executable on Windows and an app/DMG on macOS.
