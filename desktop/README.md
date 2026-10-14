# ClosedCode desktop

ClosedCode desktop packages the coding workspace, local companion, Node.js and npm/npx into a native application. No Node installation, hosted website, cloud account or terminal pairing is required to open it. Model access remains configured locally: Free Only accepts verified zero-priced direct models or downloaded Ollama models, and OmniRoute setup runs only after its explicit button is clicked.

The renderer is a built Vite SPA using the same workspace components and CSS as the web app. Electron serves that bundle on a loopback origin and starts the imported companion in its main process. Session history and the pairing secret live in Electron's per-user application data directory. The preload exposes only `getConnection`, `chooseDirectory` and `getVersion`; the native folder picker changes the companion workspace through its protected API.

Renderer Node integration is disabled, context isolation and sandboxing are enabled, navigation stays local, IPC is checked against the window's main frame, and a CSP allows scripts only from the bundled UI. External documentation/dashboard links open in the system browser from a small origin allowlist. The companion accepts the exact desktop origin and requires its token for all desktop APIs.

## Build

Install development dependencies once, then build an installer/portable app:

```sh
npm ci
npm run desktop:dist -- --win --x64
npm run desktop:dist -- --mac --arm64
npm run desktop:dist -- --mac --x64
```

The build creates the SPA, downloads the official Node 24.21.0 archive for the selected platform/architecture, verifies its SHA-256 against Node's official release manifest and packages the complete runtime (including its npm/npx). Node runs provider packages separately from Electron so native modules use a normal Node ABI. Generated runtimes, archives and UI output are ignored in version control.

Artifacts appear in `release/`:

- Windows: `ClosedCode-<version>-win-x64-setup.exe` and `ClosedCode-<version>-win-x64-portable.exe`.
- macOS: `ClosedCode-<version>-mac-arm64.{dmg,zip}` and `ClosedCode-<version>-mac-x64.{dmg,zip}`.

Windows builds run on Windows. macOS DMGs and native smoke checks run on macOS; a cross-host macOS build produces an unsigned ZIP only and does not verify it can launch. Electron 44 requires macOS 13 or later. The current packages are unsigned: Windows/macOS may show their normal unrecognized publisher warnings. Signing/notarization require the owner's platform certificates and are not bundled.

## Verify

```sh
node --test desktop/*.test.mjs
npm run desktop:dist -- --win --x64 --smoke --skip-build
npm run desktop:dist -- --mac --arm64 --smoke --skip-build
```

The smoke check starts the packaged executable in a temporary application-data directory with its window hidden, verifies the isolated preload bridge, local health/files/session APIs and bundled Node/npm, captures the UI, then closes the owned services. Screenshots are saved under `desktop/resources/smoke/`. A macOS artifact needs this check on a Mac runner. To run the development desktop app visibly, use `npm run desktop:dev`.

Primary references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), [Electron releases](https://releases.electronjs.org/), [Electron 44 platform changes](https://www.electronjs.org/blog/electron-44-0), [electron-builder cross-platform builds](https://www.electron.build/docs/features/multi-platform-build/), and [Node release archives](https://nodejs.org/dist/v24.21.0/).
