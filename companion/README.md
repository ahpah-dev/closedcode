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

Default route: `http://127.0.0.1:20128/v1`, model `auto`. Default fallback: a separately installed local Ollama instance at `http://127.0.0.1:11434/v1`, model `auto`. Download a local model with tool support before using it; ClosedCode discovers installed models and their capabilities. Local inference can operate without per-request API fees; hosted providers may impose limits or charge fees. No provider credentials or model weights are bundled.

**Free Only** (`routing.freeOnly: true`) checks the configured provider's authenticated `/v1/models` catalog before every route can receive inference. It accepts explicit zero input/output pricing with no additional fee, or an exact `:free` direct-model suffix with no contradictory paid metadata. Labels like `free: true`, trial credits, missing prices, non-chat models and automatic/combo routes do not suffice. `auto` resolves to an explicit verified free model with tool support preferred. Every fallback is independently checked; unknown or paid fallbacks are skipped. Catalogs are cached for 30 seconds by endpoint and credential hash; failed discovery blocks that route. Local Ollama also checks `/api/tags` for a downloaded non-cloud model.

ClosedCode verifies the running OmniRoute gateway using `GET /api/settings/feature-flags` with your configured endpoint key. Verification requires management permission. The effective `OMNIROUTE_EMERGENCY_FALLBACK` flag must be disabled and apply without a restart; unknown, malformed, unauthorized or enabled settings block inference. Each inference round checks the live flag again. In **Model routing**, choose **Verify gateway**, or **Enable strict free routing** to disable only Emergency Fallback through the supported PUT endpoint and verify the result. This setting affects other clients of the same gateway. Existing gateways need no restart. ClosedCode resolves `auto` locally to a verified direct model and rejects combo entries, so the gateway’s automatic full-pool fallback is never invoked. Its own launcher still sets restrictive environment defaults, but those do not replace runtime verification because database overrides take precedence. Pricing evidence comes from your configured gateway/provider; account eligibility, quotas and availability still apply. Source: [OmniRoute runtime feature flags](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.52/src/app/api/settings/feature-flags/route.ts) and [emergency fallback](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.52/open-sse/services/emergencyFallback.ts).

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
| POST | `/api/omniroute/safeguards` | `{route:{baseUrl,model,apiKey},configure?:boolean}` → `{safeguards:{verified,reason}}`; explicit configure disables emergency fallback, then verifies live state |
| POST | `/api/models` | `{route:{baseUrl,model,apiKey},refresh?:true}` → `{models:[{id,free,reason,compatible,toolCalling?}],selected?,checkedAt,source,safeguards?}` |
| POST | `/api/approval` | `{id,approved:boolean}` → `{ok}`; pending command approval, once only |
| GET | `/api/session` | `{sessions}` |
| POST | `/api/session` | `{session:{id,title,agent,mode,messages:[{role,content}]}}` → `{ok,session}` |
| POST | `/api/run` | `{prompt,agent,mode,model,routing:{freeOnly,primary:{baseUrl,model,apiKey},fallbacks:[]},history:[{role,content}],plugins:[]}` → SSE |
| GET | `/api/changes` | `{runs:[{id,runId,workspace,status,outcome,createdAt,updatedAt,changeCount}]}`; current workspace, newest first |
| GET | `/api/changes/:runId` | `{run:{...summary,files:[{path,kind,before,after,beforeBytes,afterBytes,undone?}]}}`; `kind` is `created` or `modified` |
| POST | `/api/changes/:runId/keep` | `{}` → `{run}`; marks the direct file edits as kept without modifying files or creating a Git commit |
| POST | `/api/changes/:runId/undo` | `{}` → `{run}`; restores recorded direct file edits if they still match the checkpoint |

`/api/run` emits SSE events named `message`, each with JSON data. Types: `status` (`text`, `mode`), `delta` (`text`), `reset` (`text` replaces the accumulated assistant output), `tool` (`name`, `state`, `args` or `result`/`error`), `approval` (`id`, `program`, `args`, `workspace`), `fallback` (`from`, `to`, `model`, `reason`), `done` (`text`, `model`, `provider`) and `error` (`error`). Enabled plugin string IDs are `file-context` (list/read/write and approval-gated commands), `code-review` (Git diff) and `subagents` (delegate); an empty string array disables all tools. If plugins are omitted, core tools are enabled. Legacy disabled plugin objects `{id:"git-context"|"agent-swarm",enabled:false}` remain supported.

Studio adds `run` (`runId`, `mode`) and `changes` (`runId`, `status`, `outcome`, `changeCount`, timestamps) events. `changes.status` is `running` during edits and `pending` after a run with recorded edits; runs without edits finish as `kept`. Terminal `done` and `error` events include `runId` and `changeCount` when a checkpoint was created. The companion attempts checkpoint finalization before sending the terminal event; persistence failures are reported as errors.

Run the integration and security checks with:

```sh
node --test tests/companion*.mjs
```

## Automatic routing and MCP (0.2.0)

POST `/api/routing/prepare` with `{ routing }` returns prepared routing, a ready boolean, and safe per-endpoint diagnostics. Set `routing.autoConfigure: true` on `/api/run` for preflight before inference. Installed local model capabilities are discovered; the fallback defaults to `auto`.

GET/POST `/api/mcp/servers` lists/adds servers. POST `/api/mcp/servers/:id/connect` or `/disconnect` explicitly controls connections; PATCH with `{ enabled }` enables/disables, and DELETE removes. Configuration writes require JSON. All endpoints require the companion token and allowed origin. MCP configuration is stored separately from sessions; GET responses omit env/header values. Connections cannot be changed during an active run.

Enable plugin ID `mcp` for main Build runs. MCP approvals use the same `/api/approval` endpoint as commands, with SSE fields `{ type: "approval", kind: "mcp", id, server, tool, args, workspace }`. Calls use a 60-second timeout and are never automatically resubmitted on a lost response.

## Custom agents (0.3.0)

GET/POST `/api/agents` lists/creates custom profiles; PATCH/DELETE `/api/agents/:id` updates/removes them. JSON writes require the companion token and allowed origin. Profiles have an immutable `custom_<UUID>` ID, name, role, personality, description, color, instructions in `guidance`, and updatedAt. IDs and names are unique; built-in names are reserved. At most 24 profiles are stored atomically in private `agents.json`. Agent settings cannot be changed during a run. Send the saved profile ID as `/api/run`’s `agent` to use its actual instructions. Focused delegates can reference custom profiles by saved ID or unique name. Plan mode, tool permissions and approval requirements remain enforced.

## Studio change review (0.4.0)

Keep and Undo cover only direct agent `write_file` edits in the selected workspace. Changes made by approved commands, dependency scripts, MCP tools or other applications are outside this checkpoint. Edits are applied immediately; **Keep** accepts the review and does not create a Git commit. **Undo** restores the recorded original contents and removes files created by those direct writes. It does not remove directories created for them or reverse command/MCP side effects.

Review endpoints require the companion token and allowed origin. Keep/Undo require `Content-Type: application/json` and an empty `{}` body; callers cannot submit paths or snapshots. They return HTTP 409 while a coding run or another review action is active. Run IDs belong to the selected workspace. Status values are `running`, `pending`, `kept` and `undone`.

Undo checks every recorded file's contents and file identity before restoration, then checks again as each file is restored. A later edit, replacement, missing file or symbolic link blocks restoration with HTTP 409 and `{error,conflicts:[path]}`. Conflicting current files are preserved; do not expect Undo to merge newer edits. A race or filesystem failure during restoration can stop after some files were restored; the ledger records restored files so retrying skips them.

Before/after text snapshots are stored atomically in private `changes.json` alongside the companion's other state. Limits are 512 KiB per text file, 24 files and 8 MiB of combined snapshots per run, and at most 20 run records within a 64 MiB serialized history budget. The oldest inactive records, including pending reviews, may be evicted when limits are reached. Interrupted runs reload as pending when they contain edits. Use Git or another backup for durable project history.
