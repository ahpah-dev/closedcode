import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { serveDesktop, listenLocal } from './static-server.mjs';
import { externalUrlAllowed, trustedFrame } from './security.mjs';

app.setName('ClosedCode');
app.setAppUserModelId('com.closedcode.app');
const { createCompanion } = await import(app.isPackaged ? '../desktop-engine/server.mjs' : '../companion/server.mjs');
const smoke = process.argv.includes('--desktop-smoke');
const argument = (name) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
if (smoke && argument('--desktop-smoke-state')) {
  const state = path.resolve(argument('--desktop-smoke-state'));
  await fs.mkdir(state, { recursive: true });
  app.setPath('userData', state);
}
const developmentRoot = fileURLToPath(new URL('../', import.meta.url));
const runtimeRoot = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(developmentRoot, 'desktop', 'resources', 'runtime');
const nodeExecutable = path.join(runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'bin/node');
const npmCli = path.join(runtimeRoot, process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js');
const uiRoot = path.join(app.getAppPath(), 'desktop-ui-dist');
const preload = fileURLToPath(new URL('./preload.cjs', import.meta.url));
const singleInstance = app.requestSingleInstanceLock();
let window, companion, ui, connection, quitting = false;
const execFileAsync = promisify(execFile);

function authorized(event) {
  if (!window || !ui || !trustedFrame(event, window.webContents, ui.origin)) throw new Error('Desktop bridge request refused.');
}

async function shutdown() {
  if (quitting) return;
  quitting = true;
  await Promise.allSettled([companion?.close(), ui?.close()]);
  app.quit();
}

function createWindow() {
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(developmentRoot, 'public', 'desktop-icons', 'icon.png');
  window = new BrowserWindow({
    title: 'ClosedCode', width: 1460, height: 930, minWidth: 1000, minHeight: 700,
    backgroundColor: '#0a1019', show: false, autoHideMenuBar: process.platform !== 'darwin',
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (externalUrlAllowed(url)) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  const preventRemote = (event, url) => {
    try { if (new URL(url).origin === ui.origin) return; } catch {}
    event.preventDefault();
    if (externalUrlAllowed(url)) void shell.openExternal(url).catch(() => {});
  };
  contents.on('will-navigate', preventRemote);
  contents.on('will-redirect', (event, url) => { if (!url.startsWith(`${ui.origin}/`)) event.preventDefault(); });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => { if (!smoke) window.show(); });
  window.on('closed', () => { window = undefined; });
  return window.loadURL(ui.origin);
}

async function smokeChecks() {
  const deadline = Date.now() + 30_000;
  let rendered;
  while (Date.now() < deadline) {
    rendered = await window.webContents.executeJavaScript(`({title:document.title,bridge:!!window.closedcodeDesktop,rendererNodeAvailable:typeof require!=='undefined'||typeof process!=='undefined',workspace:!!document.querySelector('.closedcode')})`);
    if (rendered.workspace && rendered.bridge) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const bridge = await window.webContents.executeJavaScript('window.closedcodeDesktop.getConnection().then(({desktop})=>({desktop}))');
  const headers = { Authorization: `Bearer ${companion.token}`, 'Content-Type': 'application/json' };
  const health = await fetch(`${connection.baseUrl}/api/health`, { headers });
  const files = await fetch(`${connection.baseUrl}/api/files`, { headers });
  const fileData = await files.json();
  const create = await fetch(`${connection.baseUrl}/api/sessions`, { method: 'POST', headers, body: JSON.stringify({ title: 'Desktop smoke check', agent: 'atlas', project: 'Bundled runtime', messages: [] }) });
  const created = await create.json();
  const history = await fetch(`${connection.baseUrl}/api/sessions`, { headers });
  if (created.session?.id) await fetch(`${connection.baseUrl}/api/sessions/${created.session.id}`, { method: 'DELETE', headers });
  const runtime = await execFileAsync(nodeExecutable, ['--version'], { windowsHide: true, timeout: 10_000 });
  const npm = await execFileAsync(nodeExecutable, [npmCli, '--version'], { windowsHide: true, timeout: 10_000 });
  const customProfile = { id: `custom_${randomUUID()}`, name: 'Desktop smoke agent', role: 'Verifier', color: 'violet', personality: 'Methodical.', guidance: 'Verify actual behavior.', updatedAt: new Date().toISOString() };
  const profileCreated = await fetch(`${connection.baseUrl}/api/agents`, { method: 'POST', headers, body: JSON.stringify(customProfile) });
  const profileData = await profileCreated.json();
  const customAgentsVerified = profileCreated.ok && profileData.agents?.some((agent) => agent.id === customProfile.id && agent.guidance === customProfile.guidance);
  if (customAgentsVerified) await fetch(`${connection.baseUrl}/api/agents/${customProfile.id}`, { method: 'DELETE', headers });
  const fixture = path.join(companion.workspace.root, 'mcp-smoke.mjs');
  await fs.writeFile(fixture, `import readline from 'node:readline'; const lines=readline.createInterface({input:process.stdin}); lines.on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;const result=r.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'packaged-smoke',version:'1'}}:r.method==='tools/list'?{tools:[{name:'check',inputSchema:{type:'object',properties:{}}}]}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});lines.on('close',()=>process.exit(0));`);
  const added = await fetch(`${connection.baseUrl}/api/mcp/servers`, { method: 'POST', headers, body: JSON.stringify({ name: 'Packaged MCP smoke', command: 'node', args: [fixture] }) });
  const addedData = await added.json(); let mcpVerified = false;
  if (addedData.server?.id) {
    const url = `${connection.baseUrl}/api/mcp/servers/${addedData.server.id}`;
    try {
      const connected = await fetch(`${url}/connect`, { method: 'POST', headers, body: '{}' });
      const data = await connected.json();
      mcpVerified = connected.ok && data.servers?.some((server) => server.id === addedData.server.id && server.status === 'connected' && server.tools.some((tool) => tool.name === 'check'));
    } finally { await fetch(url, { method: 'DELETE', headers }); }
  }
  await fs.unlink(fixture);
  const result = { ok: !!rendered.workspace && !!rendered.bridge && bridge.desktop === true && health.ok && files.ok && create.ok && history.ok && mcpVerified && customAgentsVerified && !rendered.rendererNodeAvailable, packaged: app.isPackaged, version: app.getVersion(), uiLoaded: !!rendered.workspace, bridge: bridge.desktop === true, rendererNodeAvailable: !!rendered.rendererNodeAvailable, healthStatus: health.status, historyStatus: history.status, mcpVerified, customAgentsVerified, fileCount: fileData.files?.length || 0, nodeVersion: runtime.stdout.trim(), npmVersion: npm.stdout.trim() };
  const screenshot = argument('--desktop-smoke-screenshot');
  if (screenshot) {
    await fs.mkdir(path.dirname(path.resolve(screenshot)), { recursive: true });
    const preview = await window.webContents.capturePage();
    await fs.writeFile(path.resolve(screenshot), preview.toPNG());
  }
  const report = argument('--desktop-smoke-output');
  if (report) await fs.writeFile(path.resolve(report), JSON.stringify(result, null, 2));
  if (!result.ok) throw new Error('Bundled desktop runtime smoke verification failed.');
}

if (!singleInstance) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', (event) => { if (!quitting) { event.preventDefault(); void shutdown(); } });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') void shutdown(); });
  app.on('activate', () => { if (!window && connection) createWindow(); });

  // Electron waits for ESM entry evaluation before firing ready. Register the
  // asynchronous bootstrap instead of awaiting readiness at module top level.
  void app.whenReady().then(async () => {
  try {
    await Promise.all([fs.access(nodeExecutable), fs.access(npmCli), fs.access(path.join(uiRoot, 'index.html'))]);
    // Node/npm are bundled, and only main supplies these trusted runtime paths.
    process.env.CLOSED_CODE_NODE_EXECUTABLE = nodeExecutable;
    process.env.npm_execpath = npmCli;
    process.env.PATH = `${path.dirname(nodeExecutable)}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
    const stateRoot = app.getPath('userData');
    const initialWorkspace = path.join(stateRoot, 'workspace');
    await fs.mkdir(initialWorkspace, { recursive: true });
    const welcomeFile = path.join(initialWorkspace, 'README.md');
    try { await fs.writeFile(welcomeFile, '# ClosedCode workspace\n\nChoose your project with Connect project. Your desktop agent and session history run locally.\n', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    ui = await serveDesktop(uiRoot);
    companion = await createCompanion({ workspace: initialWorkspace, stateDir: path.join(stateRoot, 'companion'), origin: ui.origin, strictOrigin: true });
    const port = await listenLocal(companion.server);
    const baseUrl = `http://127.0.0.1:${port}`;
    ui.setCompanionOrigin(baseUrl);
    const getConnection = () => ({ baseUrl, token: companion.token, workspace: companion.workspace.root, desktop: true });
    connection = getConnection();
    ipcMain.handle('closedcode:get-connection', (event) => { authorized(event); return getConnection(); });
    ipcMain.handle('closedcode:get-version', (event) => { authorized(event); return app.getVersion(); });
    const chooseProject = async () => {
      const choice = await dialog.showOpenDialog(window, { title: 'Choose your coding project', defaultPath: companion.workspace.root, properties: ['openDirectory', 'createDirectory'] });
      if (choice.canceled || !choice.filePaths[0]) return { workspace: companion.workspace.root, cancelled: true };
      const response = await fetch(`${baseUrl}/api/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${companion.token}` }, body: JSON.stringify({ path: choice.filePaths[0] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Project selection failed.');
      return { workspace: data.workspace };
    };
    ipcMain.handle('closedcode:choose-directory', async (event) => { authorized(event); return chooseProject(); });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents === window?.webContents && permission === 'clipboard-sanitized-write' && contents.getURL().startsWith(`${ui.origin}/`));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => contents === window?.webContents && permission === 'clipboard-sanitized-write' && requestingOrigin === ui.origin);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try { const origin = new URL(details.url).origin; allowed = origin === ui.origin || origin === baseUrl; } catch {}
      callback({ cancel: !allowed });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'ClosedCode', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { label: 'File', submenu: [{ label: 'Choose project…', click: async () => { try { const result = await chooseProject(); if (!result.cancelled && window) window.webContents.reload(); } catch (error) { dialog.showErrorBox('Project selection failed', error.message); } } }, { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    ]));
    await createWindow();
    if (smoke) { await smokeChecks(); await shutdown(); }
  } catch (error) {
    if (smoke) {
      const report = argument('--desktop-smoke-output');
      if (report) await fs.writeFile(path.resolve(report), JSON.stringify({ ok: false, error: error.message, packaged: app.isPackaged }));
      console.error(`Desktop smoke check failed: ${error.message}`);
      process.exitCode = 1;
    } else dialog.showErrorBox('ClosedCode could not start', `${error.message}\n\nReinstall the desktop package if its bundled runtime or UI files are missing.`);
    await shutdown();
  }
  });
}
