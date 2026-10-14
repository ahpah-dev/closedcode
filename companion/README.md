# ClosedCode local companion

The companion is a real local Node.js coding-agent backend. It connects the ClosedCode web workspace to files on your computer and to OpenAI-compatible inference providers. It uses Node built-ins and the official MCP client SDK, and binds to `127.0.0.1`; it does not send your files to the hosted UI server.

## Start and pair

Install Node.js 22.22.2 or later (required by current OmniRoute). From the ClosedCode repository folder, install dependencies with `npm ci`, then run:

```sh
node companion/server.mjs
```

Keep the terminal open. Copy the printed pairing token into ClosedCode's Connect companion dialog. The default companion URL is `http://127.0.0.1:47821`. The token is a local password: anyone possessing it can read allowed files and start Build mode edits in your selected workspace. Each startup prints the saved token once. Your browser may request permission to access the local network; allow it for the ClosedCode UI.

For the complete local app, install project dependencies with `npm install` once, then double-click **Start ClosedCode.cmd** on Windows or run `npm run dev:all`. The launcher prepares local session storage, starts both companion and web preview, and prints the workspace URL. It only runs local D1 migrations; an ignored local copy makes the initial schema idempotent for previews created before the migration ledger. Tracked migrations are preserved. Ctrl+C stops both services. Missing dependencies and occupied ports are reported without auto-installing packages or OmniRoute.

Use the setup dialog to select an absolute workspace folder path. A folder is explicitly selected by the user; the agent cannot change its own workspace. Requests from the hosted ClosedCode origin and local previews (`localhost` or `127.0.0.1`, ports 3000–6000) are allowed. Set `CLOSED_CODE_ORIGIN` to permit a different exact deployed origin. `CLOSED_CODE_PORT` changes the companion port; `CLOSED_CODE_WORKSPACE` chooses the initial workspace.

## OmniRoute and fallback

Click **Set up OmniRoute** in ClosedCode to explicitly run `npm exec --yes -- omniroute`. npm downloads the open-source package if required; startup needs network access and can take a little time. Open its dashboard at `http://127.0.0.1:20128`, configure an eligible provider connection, and copy the API key from Dashboard → Endpoints into ClosedCode's routing settings. Installation alone does not provide an inference account or model. OmniRoute must have a working configured connection and any required key before `auto` can serve requests.

Default route: `http://127.0.0.1:20128/v1`, model `auto`. Default fallback: a separately installed local Ollama instance at `http://127.0.0.1:11434/v1`, model `qwen2.5-coder:7b`. Download that model with `ollama pull qwen2.5-coder:7b` before using it. Local inference can operate without per-request API fees; hosted providers may impose limits or charge fees. No provider credentials or model weights are bundled.

**Free Only** (`routing.freeOnly: true`) checks the configured provider's authenticated `/v1/models` catalog before every route can receive inference. It accepts explicit zero input/output pricing with no additional fee, or an exact `:free` direct-model suffix with no contradictory paid metadata. Labels like `free: true`, trial credits, missing prices, non-chat models and automatic/combo routes do not suffice. `auto` resolves to an explicit verified free model with tool support preferred. Every fallback is independently checked; unknown or paid fallbacks are skipped. Catalogs are cached for 30 seconds by endpoint and credential hash; failed discovery blocks that route. Local Ollama also checks `/api/tags` for a downloaded non-cloud model.

ClosedCode starts its OmniRoute child with `OMNIROUTE_EMERGENCY_FALLBACK=false` and `OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL=false`. Existing independently started gateways at port 20128 have unverified internal fallback behavior, so Free Only excludes them. Stop that existing process yourself, then start OmniRoute through ClosedCode setup to verify the safeguards. ClosedCode does not kill a gateway it did not start. Pricing evidence comes from your configured gateway/provider; account eligibility, quotas and provider availability still apply. Current source references: [OmniRoute catalog](https://github.com/diegosouzapw/OmniRoute/blob/main/src/app/api/v1/models/catalog.ts), [pricing metadata](https://github.com/diegosouzapw/OmniRoute/blob/main/src/lib/modelMetadataRegistry.ts), and [strict zero-cost routing](https://github.com/diegosouzapw/OmniRoute/blob/main/docs/routing/STRICT_ZERO_COST.md).

Failed connections, request timeouts, HTTP 429, 408 and 5xx switch directly to the next route; the agent keeps that route for the remainder of the run. HTTP 401/403 are surfaced as configuration errors. A stream that fails after partial output emits a `reset` event containing only previously completed text, followed by `fallback`, so the UI replaces incomplete output before streaming the replacement. Provider keys are sent only in request headers to the provider URL you configured, and are never written into companion state.

## Actual agent capabilities

- Atlas builds calmly, Nova explores, Sage reviews, and Echo debugs. Their guidance is included in real provider requests.
- `list_files`, `read_file` and `git_diff` supply real local context.
- `write_file` creates/replaces UTF-8 files in **Build** mode only. **Plan** mode and delegated agents are read-only.
- `delegate` makes an independent provider call with its own bounded tool loop. A parent run can delegate twice; children cannot delegate further.
- Each run allows at most 12 provider rounds and 24 tool calls. Individual provider requests time out after 45 seconds. One coding run is active at a time.
- File reads/writes are limited to 512 KB. Traversal, absolute file paths, symbolic links and Windows junctions are rejected. Credentials (`.env`, private keys), `.git`, dependencies, build outputs and companion state are excluded.
- `run_command` requests your approval for its exact executable, argument array and working directory before each command. Build mode and File Context are required. Allowed programs: Node, npm/npx, Python, Git, Cargo, Go and Bun. Git operations are read-only; shells, executable paths and shell interpolation are prohibited. npm/npx use their Node CLI directly on Windows.
- Commands time out after 60 seconds, capture at most 64 KB combined stdout/stderr and stop on cancellation. Approval expires after two minutes; rejecting an approval starts no process. Subagents cannot run commands. File tools are workspace scoped; user-approved code and dependency scripts can affect other files accessible to your OS account, so inspect the displayed command before approving it.

State is stored under `.closedcode/local.json`: pairing token, selected workspace and sanitized sessions. File edits affect your selected folder. Use version control and inspect the diff before committing. Stop the companion with Ctrl+C.

## API

JSON errors use `{ "error": "message" }`. Send `Authorization: Bearer <pairing-token>` (or `X-ClosedCode-Token`) for every endpoint except public health and pairing.

| Method | Path | Request / response |
| --- | --- | --- |
| GET | `/api/health` | `{ok,version,workspace,omniroute:{baseUrl,dashboardUrl,status}}` |
| POST | `/api/pair` | `{token}` → `{ok,workspace}` |
| GET | `/api/files` | `{files:[{path,size}],truncated}`; optional relative folder `?path=` |
| GET | `/api/file?path=src/index.ts` | `{path,content}` |
| POST | `/api/workspace` | `{path:"absolute folder"}` → `{ok,workspace}` |
| POST | `/api/omniroute` | `{}` → `{ok,status:"starting"\|"running",dashboardUrl}` |
| POST | `/api/models` | `{route:{baseUrl,model,apiKey},refresh?:true}` → `{models:[{id,free,reason,compatible,toolCalling?}],selected?,checkedAt,source,safeguards?}` |
| POST | `/api/approval` | `{id,approved:boolean}` → `{ok}`; pending command approval, once only |
| GET | `/api/session` | `{sessions}` |
| POST | `/api/session` | `{session:{id,title,agent,mode,messages:[{role,content}]}}` → `{ok,session}` |
| POST | `/api/run` | `{prompt,agent,mode,model,routing:{freeOnly,primary:{baseUrl,model,apiKey},fallbacks:[]},history:[{role,content}],plugins:[]}` → SSE |

`/api/run` emits SSE events named `message`, each with JSON data. Types: `status` (`text`, `mode`), `delta` (`text`), `reset` (`text` replaces the accumulated assistant output), `tool` (`name`, `state`, `args` or `result`/`error`), `approval` (`id`, `program`, `args`, `workspace`), `fallback` (`from`, `to`, `model`, `reason`), `done` (`text`, `model`, `provider`) and `error` (`error`). Enabled plugin string IDs are `file-context` (list/read/write and approval-gated commands), `code-review` (Git diff) and `subagents` (delegate); an empty string array disables all tools. If plugins are omitted, core tools are enabled. Legacy disabled plugin objects `{id:"git-context"|"agent-swarm",enabled:false}` remain supported.

Run the integration and security checks with:

```sh
node --test tests/companion*.mjs
```

## Automatic routing and MCP (0.2.0)

POST `/api/routing/prepare` with `{ routing }` returns prepared routing, a ready boolean, and safe per-endpoint diagnostics. Set `routing.autoConfigure: true` on `/api/run` for preflight before inference. Installed local model capabilities are discovered; the fallback defaults to `auto`.

GET/POST `/api/mcp/servers` lists/adds servers. POST `/api/mcp/servers/:id/connect` or `/disconnect` explicitly controls connections; PATCH with `{ enabled }` enables/disables, and DELETE removes. Configuration writes require JSON. All endpoints require the companion token and allowed origin. MCP configuration is stored separately from sessions; GET responses omit env/header values. Connections cannot be changed during an active run.

Enable plugin ID `mcp` for main Build runs. MCP approvals use the same `/api/approval` endpoint as commands, with SSE fields `{ type: "approval", kind: "mcp", id, server, tool, args, workspace }`. Calls use a 60-second timeout and are never automatically resubmitted on a lost response.
