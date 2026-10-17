# ClosedCode

ClosedCode 0.5.0 refines Studio's deep-space orbital theme and introduces one-click local OmniRoute setup with multi-tier Free routing across built-in no-auth models, free OAuth/CLI providers, and free-tier APIs.

0.4.0 introduced Studio: a focused glass coding workspace with live activity, direct file review, a project pad, and local preview controls.

### Work in Studio

1. Connect a project and configure a verified model in **Model routing**. Missing keys, rejected keys, and accepted chat keys without gateway management permission now have separate diagnostics.
2. Describe your idea, or choose **Plan** to investigate before changing files. **Build this plan** prepares a follow-up prompt for you to review and send.
3. Follow actual reads, file edits, commands and provider fallbacks in **Activity**. Commands and external MCP tools still require approval.
4. Open **Changes** to inspect the exact direct agent file edits. **Keep changes** accepts edits already in your workspace; **Undo** restores their saved before-state only when the files have not changed elsewhere. Command and MCP side effects are outside file Undo. These actions do not create Git commits.
5. Keep workspace-specific notes in **Pad**. Start your own development server and enter its loopback HTTP address in **Preview** to open it in your browser.

The companion keeps a private, bounded review history for the 20 most recent runs. Files are limited to 512 KB of UTF-8 text, with at most 24 changed files and 8 MB of snapshots in a run. Interrupted runs retain their captured direct edits for review. Newer edits, renamed/replaced files, symbolic links and workspace mismatches block Undo.

**Free. Unlimited. Yours.** A standalone coding agent desktop app for Windows and macOS, with a focused workspace, expressive agents, local project tools, OmniRoute setup, and automatic provider fallback.

[Website](https://closedcode-desktop.vercel.app) · [Download releases](https://github.com/ahpah-dev/closedcode/releases) · [Source](https://github.com/ahpah-dev/closedcode)

ClosedCode charges no subscription, seat fee, or fee per run. Use it as often as you want with the models you configure. Hosted providers still control their own accounts, pricing, quotas, and availability; local inference uses your computer's resources. Individual agent runs have execution bounds, and local history holds up to 200 sessions.

## Download and start

Get the installers from [GitHub Releases](https://github.com/ahpah-dev/closedcode/releases). The website shows downloads available in the latest published release.

| Platform | Download |
| --- | --- |
| Windows x64 | `ClosedCode-<version>-win-x64-setup.exe` or `-portable.exe` |
| macOS 13+ on Apple silicon | `ClosedCode-<version>-mac-arm64.dmg` or `.zip` |
| macOS 13+ on Intel | `ClosedCode-<version>-mac-x64.dmg` or `.zip` |

The app includes its interface, local companion, and a Node.js runtime with npm. You do not need to install Node.js, run a development server, or paste a pairing token to use the desktop app. Provider accounts, credentials, and model weights are not bundled.

Mac release jobs build only their requested architecture. Packaged verification checks that Electron, bundled Node, and the release target all match before an installer is published.

1. Install or open ClosedCode. On macOS, copy the app into Applications.
2. Choose **Connect project** and select your folder in the native directory picker.
3. Open **Model routing → Auto configure**. ClosedCode discovers usable models and prepares your routes. Enter your gateway API key once if OmniRoute requires it.
4. Pick an agent, choose Build or Plan mode, and send a task.

The release builds are unsigned and are not notarized. Windows SmartScreen and macOS Gatekeeper may show a warning. Every release includes `SHA256SUMS.txt` so you can verify the downloaded files.

## OmniRoute setup and fallback

Choose **Start OmniRoute** in setup. ClosedCode uses its bundled Node/npm runtime to launch the open source [OmniRoute](https://github.com/diegosouzapw/OmniRoute) package. The first setup may download it and requires an internet connection. Its dashboard is normally at `http://127.0.0.1:20128`.

Connect an eligible provider in the OmniRoute dashboard, then copy its endpoint API key into ClosedCode's routing settings. The default primary URL is `http://127.0.0.1:20128/v1`; the default model setting is `auto`. Installing a gateway alone does not create a provider account or grant model access.

Each route consists of an OpenAI-compatible base URL, a model, and an optional API key. You can configure a primary route and fallback routes. Failed connections, HTTP 429/408/5xx, and request timeouts move directly to the next eligible route. Authentication and missing-model failures explain the configuration problem and move to your next configured route. They are not retried. If every route is temporarily unavailable, the last eligible route gets one retry after 500 ms. The default provider request timeout is 45 seconds.

Completed tool rounds survive a route change. If a provider stream fails midway, ClosedCode removes that round's incomplete output before streaming its replacement. The successful replacement route stays selected for the rest of the run. Fallback does not remove provider rate limits or make a slow request instantaneous.

ClosedCode stops the OmniRoute process tree it launched when the app quits. It does not stop a gateway started independently.

## Free-only routing

**Free Only is enabled by default.** The companion checks live model catalogs before a route receives inference and verifies each fallback independently. It accepts:

- Direct models with explicit zero input/output pricing and no additional paid or unknown price component.
- An exact `:free` model ID advertised by the configured endpoint, without contradictory paid metadata.
- Downloaded local Ollama models verified through its local model inventory; cloud variants are excluded.

Paid models, unknown prices, discovery failures, non-chat models, and automatic/combo targets are blocked. A `free: true` label alone does not qualify. The `auto` setting resolves to a concrete verified free model, preferring advertised tool support. Catalog results are cached for 30 seconds per endpoint and credential.

For a localhost OmniRoute gateway, Free Only requires that ClosedCode started it. Managed startup disables `OMNIROUTE_EMERGENCY_FALLBACK` and `OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL`, so those internal fallbacks cannot silently change the selected route. An independently started gateway is excluded in this mode; stop it yourself and start it through ClosedCode setup. Local Ollama remains eligible as a fallback.

Pricing evidence comes from the endpoint you configure. Provider eligibility, free allowances, and model availability still apply. ClosedCode does not supply unlimited free hosted inference. Turning Free Only off permits your own paid providers; ClosedCode itself remains free.

For local inference, install [Ollama](https://ollama.com) and download a model that supports tools and fits your hardware. ClosedCode discovers downloaded models through the live catalog and checks advertised tool capabilities. There is no pinned Qwen 2.5 fallback: the default local model is `auto`. Existing default Qwen 2.5 fallback preferences migrate to discovery. No model weights are downloaded automatically.

Ollama must be running at `http://127.0.0.1:11434/v1`. Choose **Connect local Ollama** to discover and select an installed compatible model in one step.

## Automatic configuration and recovery

**Configure routes automatically before each run** is enabled by default. Preflight discovers each configured endpoint, repairs missing model IDs from its live catalog, excludes incompatible or unverified routes, and selects the first eligible route. **Auto configure** also saves the prepared settings and shows per-route diagnostics. Configuration does not import private Cline credentials or change a gateway started by another application. Gateway setup can still require provider sign-in and an endpoint key.

Temporary failures receive at most one response retry after all configured fallbacks are exhausted. Completed tool rounds survive retry and fallback; incomplete streamed text is discarded. Identical completed mutation requests reuse their result within the run. Repeated tool failures with the same arguments are stopped after two attempts and returned to the model for a changed approach. An external MCP call with a lost reply is never automatically resubmitted. These mechanisms reduce avoidable errors; they cannot guarantee error-free generated code or provider availability.

## MCP servers

Open **Plugins → MCP connections → Add server**. Save one server configuration, then choose **Connect server**. Saving does not execute a command. Supported transports are local stdio and Streamable HTTP; HTTPS is required for remote HTTP servers. The desktop includes its Node/npm runtime for Node and npx servers. Other server executables must be installed separately.

```json
{
  "name": "My local server",
  "transport": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/server.mjs"],
  "env": {}
}
```

For HTTP use `{"name":"Remote server","transport":"http","url":"https://your-server.example/mcp","headers":{"Authorization":"Bearer YOUR_TOKEN"}}`. Credentials are kept in private local `mcp.json` and omitted from list responses. Configurations survive restart; connect them explicitly again when reopening the app. Disconnect, disable, and delete controls are available for every server.

Discovered tools have isolated server namespaces. They are available only to the main Build agent with the MCP plugin enabled. Every external tool call pauses for approval of the server, tool and exact arguments. Plan mode and read-only subagents cannot invoke them. MCP servers run with their own permissions and can access resources outside your project. Redirects and automatic tool-call replay are blocked. Shutdown terminates owned local process trees. This release supports MCP tools; resources, prompts, sampling and interactive OAuth are not exposed. Configure static authentication headers when needed.

## Agents, plugins, and tools

| Agent | Personality and role |
| --- | --- |
| Atlas | Calm, pragmatic builder for implementation and refactoring |
| Nova | Curious explorer for codebase investigation and architecture |
| Sage | Thoughtful reviewer for correctness, maintainability, and edge cases |
| Echo | Precise debugger for tracing root causes and explaining fixes |

Choose **Agents → Create agent** to add your own teammate. Set a name, role, personality, description, color, and up to 8,000 characters of instructions. Custom profiles support editing, duplication, and deletion. They persist in the paired local engine’s private `agents.json` file and are cached on the device; profiles created offline sync when you connect a compatible engine. Upgrade the desktop or companion to 0.3.0 before running custom agents.

The conversation’s agent picker includes built-in and custom profiles with search, roles, animated avatars, and keyboard navigation. The model picker searches the live catalog, shows eligible choices, and provides a shortcut to route configuration. Escape dismisses a picker and returns focus to its trigger.

Saved custom personalities and instructions are included in actual provider requests.  They share the same selected workspace and respect the current mode and enabled tools.

**Build** mode can read and write project files. **Plan** mode investigates without modifying files or running commands. The project panel displays real files, and the Activity tab shows tool calls, subagent activity, route changes, and errors. Text attachments add context to a prompt; answers and tool events stream as the agent works. **Stop** cancels the active request.

Built-in plugin switches control real tools:

- **File Context:** list/read files, Build-mode file edits, and commands that require approval.
- **MCP servers:** connected external tools with per-call approval in Build mode.
- **Code Review:** read the current working-tree Git diff.
- **Subagents:** independent, bounded, read-only investigations. A parent run can delegate twice; children cannot delegate further or execute commands.

The built-in plugin switches and connected MCP tools form the available tool registry. Each main run permits at most 12 provider rounds and 24 tool calls. Tool calling depends on the selected model and provider.

Development commands pause for your approval of the exact program, arguments, and working directory. Supported programs are Node, npm/npx, Python, Git, Cargo, Go, and Bun; extra language toolchains must be installed separately. Git operations are read-only. Shells and arbitrary executable paths are prohibited. Commands have a 60-second timeout and a 64 KB output limit; rejected approvals start no process, and cancellation stops active commands.

File tools reject path traversal, escaping symlinks/junctions, Windows alternate streams, credential files, and ignored directories. File reads and writes are bounded to 512 KB. Approved code and dependency scripts run with your OS user's permissions; the companion is not an OS sandbox.

## Local history and privacy

The desktop UI, companion, project selection, and session history run locally. History is saved atomically in `companion/local.json` inside the app's user-data directory and survives restarts. Each session retains its title, agent, project, status, message IDs, and timestamps. History supports creating, reopening, updating, and deleting sessions.

The companion binds to loopback, requires its token for desktop API access, and accepts only the desktop UI's exact browser origin. Electron's renderer has Node integration disabled, context isolation enabled, and a restricted bridge for project selection and connection details.

Project files stay on your computer. Prompts, history, and file context selected by the agent go to the inference endpoint you configured. Provider API keys are not written into companion session state. The companion token grants access to your selected workspace and is private to the app; a standalone browser connection uses an explicit pairing token.

## Build from source

Use Node.js 24 and npm on Windows or macOS:

```sh
git clone https://github.com/ahpah-dev/closedcode.git
cd closedcode
npm ci
npm test
node --test desktop/*.test.mjs
npx tsc --noEmit
npm run desktop:dev
```

Build installers on the target operating system:

```sh
# Windows x64
npm run desktop:dist -- --win --x64

# macOS Apple silicon
npm run desktop:dist -- --mac --arm64

# macOS Intel
npm run desktop:dist -- --mac --x64
```

Outputs are written to `release/`. The build prepares the static React interface, downloads the pinned Node runtime with checksum verification, and packages Electron with the local companion. macOS DMG creation and native verification require a Mac; a cross-built ZIP is not a substitute for that verification.

The [desktop release workflow](.github/workflows/desktop-release.yml) builds Windows x64, macOS arm64, and macOS x64 on native GitHub runners. It runs tests and packaged runtime smoke checks, verifies all six installer assets, computes SHA256 checksums, and publishes a release when a matching `v<version>` tag is pushed. Manual dispatch also supports build-only runs.

## Standalone companion and optional web workspace

For a browser-based development workspace, run `npm run dev:all`, or double-click **Start ClosedCode.cmd** on Windows after installing dependencies. This starts the local web UI and companion and prints the workspace URL and pairing token. Ctrl+C stops them.

To run only the companion:

```sh
node companion/server.mjs
```

Its default URL is `http://127.0.0.1:47821`. Configuration variables are `CLOSED_CODE_PORT`, `CLOSED_CODE_WORKSPACE`, and `CLOSED_CODE_ORIGIN`. Standalone state defaults to the ignored `.closedcode/local.json` file. The token protects file tools, agent runs, approvals, and session endpoints. See [companion documentation](companion/README.md) for the coding API and SSE event format.

The full session API is compatible with the optional web backend:

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/sessions` | List saved sessions |
| POST | `/api/sessions` | Create a session from title, agent, project, and optional messages |
| GET | `/api/sessions/:id` | Read one session |
| PATCH | `/api/sessions/:id` | Update title, agent, project, status, or messages |
| DELETE | `/api/sessions/:id` | Delete one session |

The optional hosted web backend uses Vinext, Cloudflare Workers, Drizzle, and D1 with authenticated owner-scoped history. It is separate from desktop history; no hosted database or sign-in is needed for the desktop app.

## License

Original ClosedCode code is released under the [Unlicense](LICENSE). Take it, use it, modify it, rename it, redistribute it, or sell it for commercial or non-commercial purposes. Attribution to ClosedCode is not required for the original code. The software is provided as-is.

Third-party software retains its own license terms and notices. Those obligations still apply when redistributing dependencies or bundled runtimes. See [third-party notices](THIRD_PARTY_NOTICES.md) and [collected dependency licenses](THIRD_PARTY_LICENSES.txt).

ClosedCode is independent of OmniRoute, Ollama, Electron, Codex, OpenCode, and rNexa.

### Verify an existing OmniRoute gateway

An existing Cline-connected gateway can be reused without a restart. In **Model routing**, enter its endpoint and API key, then choose **Verify gateway**. The key needs OmniRoute management permission for the runtime settings check. **Enable strict free routing** disables Emergency Fallback for the entire gateway and verifies the effective setting; alternatively disable it in OmniRoute Settings → Feature flags and verify again. Every inference round rechecks the live safeguard. Free Only continues selecting verified zero-cost direct models and blocking paid, unknown and combo routes. Cline credentials are not imported automatically.
