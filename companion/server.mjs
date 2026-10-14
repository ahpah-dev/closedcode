import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Workspace } from './workspace.mjs';
import { runAgent } from './agent.mjs';
import { DEFAULT_PRIMARY } from './provider.mjs';
import { discoverModels } from './models.mjs';
import { trustedNodeExecutable } from './commands.mjs';
import { stopOwnedProcessTree } from './processes.mjs';
import { MAX_LOCAL_SESSIONS, MAX_SESSION_BODY_BYTES, createLocalSession, listLocalSessions, normalizeSavedSession, parseLocalSessionPayload, validateLocalSessionId } from './sessions.mjs';

const VERSION = '0.1.0';
const PRODUCTION_ORIGIN = 'https://closedcode-agent-workspace.vtbyx49kb2.chatgpt.site';
const DASHBOARD = 'http://127.0.0.1:20128';

export function originAllowed(origin, configuredOrigin = process.env.CLOSED_CODE_ORIGIN, strictOrigin = false) {
  if (!origin) return true; // CLI clients do not send an Origin header.
  if (strictOrigin) return typeof configuredOrigin === 'string' && origin === configuredOrigin;
  if (origin === configuredOrigin || origin === PRODUCTION_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port) >= 3000 && Number(url.port) <= 6000 && url.origin === origin;
  } catch { return false; }
}

function sameToken(candidate, token) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function bodyJson(req, strict = false) {
  if (strict && req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    req.resume();
    throw Object.assign(new Error('Content-Type must be application/json.'), { status: 415 });
  }
  const declared = req.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_SESSION_BODY_BYTES)) {
    req.resume();
    throw Object.assign(new Error('Request exceeds the 2 MB limit.'), { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_SESSION_BODY_BYTES) {
      req.resume();
      throw Object.assign(new Error('Request exceeds the 2 MB limit.'), { status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return body ? JSON.parse(body) : strict ? null : {};
  }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

async function npmCommand() {
  const nodeExecutable = trustedNodeExecutable();
  const candidates = [process.env.npm_execpath, path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(path.dirname(nodeExecutable), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return [nodeExecutable, [candidate, 'exec', '--yes', '--', 'omniroute']]; } catch {}
  }
  // This shell command is a constant: no prompt, route, path or other user input
  // is interpolated. npm.cmd requires cmd.exe on Windows.
  return process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'npm exec --yes -- omniroute']] : ['npm', ['exec', '--yes', '--', 'omniroute']];
}

function safeSession(session) {
  if (!session || typeof session !== 'object' || typeof session.id !== 'string' || session.id.length > 100) throw new Error('Session requires an id.');
  return {
    id: session.id,
    title: String(session.title || 'New session').slice(0, 200),
    agent: String(session.agent || 'Atlas').slice(0, 100),
    mode: session.mode === 'build' ? 'build' : 'plan',
    messages: Array.isArray(session.messages) ? session.messages.slice(-100).filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map(({ role, content }) => ({ role, content: content.slice(0, 64_000) })) : [],
    updatedAt: new Date().toISOString(),
  };
}

export async function createCompanion({ workspace: root = process.cwd(), stateDir = path.join(process.cwd(), '.closedcode'), token: givenToken, origin = process.env.CLOSED_CODE_ORIGIN, strictOrigin = false, providerTimeoutMs = 45_000 } = {}) {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const statePath = path.join(stateDir, 'local.json');
  let saved = {};
  try { saved = JSON.parse(await fs.readFile(statePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('ClosedCode local state could not be loaded; using a fresh state.'); }
  const token = givenToken || (typeof saved.token === 'string' ? saved.token : randomBytes(32).toString('hex'));
  const workspace = new Workspace(root);
  try { await workspace.select(saved.workspace || root); }
  catch { await workspace.select(root); }
  let sessions = Array.isArray(saved.sessions) ? saved.sessions.slice(-MAX_LOCAL_SESSIONS).map((item) => normalizeSavedSession(item, workspace.root)).filter(Boolean) : [];
  const legacyModes = new Map();
  for (const item of Array.isArray(saved.sessions) ? saved.sessions : []) {
    if (sessions.some((session) => session.id === item?.id) && ['build', 'plan'].includes(item.mode)) legacyModes.set(item.id, item.mode);
  }
  for (const [id, mode] of Object.entries(saved.legacySessionModes || {})) {
    if (sessions.some((session) => session.id === id) && ['build', 'plan'].includes(mode)) legacyModes.set(id, mode);
  }
  let activeRun = false, omniProcess = null, omniStarting = false, omniFailure = null, lastOmniAttempt = 0;
  let closing = false, closePromise;
  const pendingApprovals = new Map();
  let persistence = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify({ token, workspace: workspace.root, sessions, legacySessionModes: Object.fromEntries(legacyModes) }, null, 2);
    persistence = persistence.catch(() => {}).then(async () => {
      const temporary = `${statePath}.tmp`;
      await fs.writeFile(temporary, snapshot, { mode: 0o600 });
      await fs.rename(temporary, statePath);
    });
    return persistence;
  };
  await persist();
  const omniRunning = async () => {
    try {
      const response = await fetch(`${DASHBOARD}/api/health`, { signal: AbortSignal.timeout(900) });
      await response.body?.cancel().catch(() => {});
      // The dashboard may use a different health path. Any non-5xx HTTP
      // response still proves the local OmniRoute process is listening.
      return response.status < 500;
    } catch { return false; }
  };
  const bootstrap = async () => {
    if (closing) throw Object.assign(new Error('Companion is shutting down.'), { status: 503 });
    if (await omniRunning()) return { ok: true, status: 'running', dashboardUrl: DASHBOARD, safeguards: { verified: !!omniProcess, emergencyFallbackDisabled: !!omniProcess, freePoolFailOpenDisabled: !!omniProcess } };
    if (closing) throw Object.assign(new Error('Companion is shutting down.'), { status: 503 });
    if (omniStarting || omniProcess) return { ok: true, status: 'starting', dashboardUrl: DASHBOARD, safeguards: { verified: true, emergencyFallbackDisabled: true, freePoolFailOpenDisabled: true } };
    if (Date.now() - lastOmniAttempt < 15_000) throw Object.assign(new Error('OmniRoute setup was just attempted. Wait 15 seconds before retrying.'), { status: 429 });
    lastOmniAttempt = Date.now();
    omniStarting = true;
    omniFailure = null;
    try {
      const [command, args] = await npmCommand();
      if (closing) throw Object.assign(new Error('Companion is shutting down.'), { status: 503 });
      omniProcess = spawn(command, args, { cwd: stateDir, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OMNIROUTE_EMERGENCY_FALLBACK: 'false', OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL: 'false' } });
      // Forward diagnostics to the local terminal, never to the browser. npm
      // and the provider can print configuration information or credentials.
      omniProcess.stdout.on('data', (chunk) => process.stdout.write(chunk));
      omniProcess.stderr.on('data', (chunk) => process.stderr.write(chunk));
      omniProcess.on('error', (error) => { omniFailure = error.message; omniProcess = null; omniStarting = false; });
      omniProcess.on('close', (code) => { omniFailure = code ? `OmniRoute exited with code ${code}.` : null; omniProcess = null; omniStarting = false; });
      return { ok: true, status: 'starting', dashboardUrl: DASHBOARD, safeguards: { verified: true, emergencyFallbackDisabled: true, freePoolFailOpenDisabled: true } };
    } finally { omniStarting = false; }
  };
  const server = http.createServer(async (req, res) => {
    const originHeader = req.headers.origin;
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    try {
      if (!originAllowed(originHeader, origin, strictOrigin)) return json(403, { error: 'Origin is not allowed. Set CLOSED_CODE_ORIGIN to your deployed UI origin.' });
      const host = (req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) return json(403, { error: 'Companion accepts only localhost requests.' });
      if (originHeader) {
        res.setHeader('Access-Control-Allow-Origin', originHeader);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-ClosedCode-Token');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const url = new URL(req.url, 'http://127.0.0.1');
      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : req.headers['x-closedcode-token'];
      if (url.pathname === '/api/health' && req.method === 'GET' && (!strictOrigin || sameToken(bearer, token))) {
        const running = await omniRunning();
        return json(200, { ok: true, version: VERSION, workspace: workspace.root, omniroute: { baseUrl: DEFAULT_PRIMARY.baseUrl, dashboardUrl: DASHBOARD, status: running ? 'running' : omniProcess ? 'starting' : 'unknown', safeguards: { verified: !!omniProcess, emergencyFallbackDisabled: !!omniProcess, freePoolFailOpenDisabled: !!omniProcess }, ...(omniFailure ? { error: omniFailure } : {}) } });
      }
      if (url.pathname === '/api/pair' && req.method === 'POST') {
        const body = await bodyJson(req);
        if (!sameToken(body.token || bearer, token)) return json(401, { error: 'Pairing token is invalid.' });
        return json(200, { ok: true, workspace: workspace.root });
      }
      if (!sameToken(bearer, token)) return json(401, { error: 'Pair with the companion token before accessing this endpoint.' });
      if (url.pathname === '/api/sessions' && req.method === 'GET') return json(200, { sessions: listLocalSessions(sessions) });
      if (url.pathname === '/api/sessions' && req.method === 'POST') {
        if (sessions.length >= MAX_LOCAL_SESSIONS) return json(409, { error: `Local history is limited to ${MAX_LOCAL_SESSIONS} sessions. Delete a session before creating another.` });
        const session = createLocalSession(parseLocalSessionPayload(await bodyJson(req, true), 'create'));
        if (sessions.length >= MAX_LOCAL_SESSIONS) return json(409, { error: `Local history is limited to ${MAX_LOCAL_SESSIONS} sessions. Delete a session before creating another.` });
        sessions = [...sessions, session];
        await persist();
        return json(201, { session });
      }
      const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
      if (sessionMatch && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
        let id;
        try { id = validateLocalSessionId(decodeURIComponent(sessionMatch[1])); }
        catch { return json(404, { error: 'Session not found.' }); }
        const index = sessions.findIndex((item) => item.id === id);
        if (index < 0) return json(404, { error: 'Session not found.' });
        if (req.method === 'GET') return json(200, { session: sessions[index] });
        if (req.method === 'DELETE') {
          sessions = sessions.filter((item) => item.id !== id);
          legacyModes.delete(id);
          await persist();
          return json(200, { ok: true });
        }
        const payload = parseLocalSessionPayload(await bodyJson(req, true), 'patch');
        // Body reads yield to other requests. Re-check the current record instead
        // of relying on an index captured before an asynchronous body stream.
        const current = sessions.find((item) => item.id === id);
        if (!current) return json(404, { error: 'Session not found.' });
        const session = { ...current, ...payload, updatedAt: new Date().toISOString() };
        sessions = sessions.map((item) => item.id === id ? session : item);
        await persist();
        return json(200, { session });
      }
      if (url.pathname === '/api/files' && req.method === 'GET') return json(200, await workspace.list(url.searchParams.get('path') || '.'));
      if (url.pathname === '/api/file' && req.method === 'GET') {
        const file = url.searchParams.get('path');
        return json(200, { path: file, content: await workspace.read(file) });
      }
      if (url.pathname === '/api/workspace' && req.method === 'POST') {
        if (activeRun) return json(409, { error: 'Wait for the active run to finish before changing workspace.' });
        const body = await bodyJson(req);
        await workspace.select(body.path);
        await persist();
        return json(200, { ok: true, workspace: workspace.root });
      }
      if (url.pathname === '/api/omniroute' && req.method === 'POST') {
        await bodyJson(req);
        return json(200, await bootstrap());
      }
      if (url.pathname === '/api/session' && req.method === 'GET') return json(200, { sessions: sessions.map((session) => ({ ...session, mode: legacyModes.get(session.id) || 'plan' })) });
      if (url.pathname === '/api/session' && req.method === 'POST') {
        const body = await bodyJson(req);
        const legacy = safeSession(body.session || body);
        const previous = sessions.find((item) => item.id === legacy.id);
        const session = normalizeSavedSession({ ...previous, ...legacy, project: previous?.project || workspace.root }, workspace.root);
        if (!session) return json(400, { error: 'The legacy session is invalid.' });
        legacyModes.set(session.id, legacy.mode);
        sessions = [...sessions.filter((item) => item.id !== session.id), session].slice(-MAX_LOCAL_SESSIONS);
        await persist();
        return json(200, { ok: true, session: { ...session, mode: legacy.mode } });
      }
      if (url.pathname === '/api/approval' && req.method === 'POST') {
        const body = await bodyJson(req);
        if (typeof body.id !== 'string' || typeof body.approved !== 'boolean') return json(400, { error: 'Approval requires an id and a boolean approved value.' });
        const pending = pendingApprovals.get(body.id);
        if (!pending) return json(404, { error: 'Approval is unknown, expired, or already answered.' });
        pending.finish(body.approved);
        return json(200, { ok: true });
      }
      if (url.pathname === '/api/models' && req.method === 'POST') {
        const body = await bodyJson(req);
        try { return json(200, await discoverModels(body.route || {}, { refresh: body.refresh === true, gatewaySafeguardsVerified: !!omniProcess })); }
        catch (error) { return json(error.fallback ? 502 : 400, { error: error.message }); }
      }
      if (url.pathname === '/api/run' && req.method === 'POST') {
        if (activeRun) return json(409, { error: 'A coding run is already active. Wait for it to finish.' });
        const body = await bodyJson(req);
        if (typeof body.prompt !== 'string' || !body.prompt.trim()) return json(400, { error: 'A prompt is required.' });
        activeRun = true;
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
        res.flushHeaders();
        const emit = (event) => { if (!res.destroyed) res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`); };
        const requestApproval = (command) => new Promise((resolve, reject) => {
          if (controller.signal.aborted) return reject(new Error('Run cancelled.'));
          const id = randomBytes(16).toString('hex');
          const finish = (approved, error) => {
            clearTimeout(expiry);
            controller.signal.removeEventListener('abort', aborted);
            pendingApprovals.delete(id);
            error ? reject(error) : resolve(approved);
          };
          const aborted = () => finish(false, new Error('Run cancelled.'));
          const expiry = setTimeout(() => finish(false, new Error('Command approval expired after two minutes. Request it again if needed.')), 120_000);
          pendingApprovals.set(id, { finish });
          controller.signal.addEventListener('abort', aborted, { once: true });
          emit({ type: 'approval', id, ...command });
        });
        const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15_000);
        try { await runAgent(body, workspace, emit, { signal: controller.signal, timeoutMs: providerTimeoutMs, requestApproval, verifyGatewaySafeguards: () => !!omniProcess }); }
        catch (error) { emit({ type: 'error', error: error.message }); }
        finally { clearInterval(heartbeat); activeRun = false; res.end(); }
        return;
      }
      return json(404, { error: 'Endpoint not found.' });
    } catch (error) {
      if (!res.headersSent) json(error.status || (error.code === 'ENOENT' ? 404 : 400), { error: error.message });
      else res.end();
    }
  });
  server.requestTimeout = 0; // Agent responses use explicit provider timeouts.
  server.headersTimeout = 15_000;
  return {
    server, workspace, token, statePath,
    close: () => {
      if (closePromise) return closePromise;
      closing = true;
      server.closeAllConnections();
      closePromise = Promise.all([
        stopOwnedProcessTree(omniProcess),
        new Promise((resolve) => server.close(resolve)),
        persistence.catch(() => {}),
      ]).then(() => {});
      return closePromise;
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.CLOSED_CODE_PORT || 47821);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CLOSED_CODE_PORT must be between 1024 and 65535.');
  const companion = await createCompanion({ workspace: process.env.CLOSED_CODE_WORKSPACE || process.cwd() });
  companion.server.listen(port, '127.0.0.1', () => {
    console.log(`\nClosedCode companion ${VERSION}\nLocal URL: http://127.0.0.1:${port}\nWorkspace: ${companion.workspace.root}\nPairing token: ${companion.token}\n\nKeep this terminal open. Pairing token grants access to this workspace.\n`);
  });
  companion.server.on('error', (error) => { console.error(`Companion could not start: ${error.message}`); process.exitCode = 1; });
  let shuttingDown = false;
  const shutdown = async () => { if (shuttingDown) return; shuttingDown = true; await companion.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
