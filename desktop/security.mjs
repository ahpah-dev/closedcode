import path from 'node:path';

const EXTERNAL_ORIGINS = new Set([
  'https://github.com', 'https://www.electronjs.org', 'https://nodejs.org',
  'https://omniroute.online', 'https://openrouter.ai', 'https://ollama.com',
  'http://127.0.0.1:20128', 'http://localhost:20128',
]);

export function externalUrlAllowed(input) {
  try {
    const url = new URL(input);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && EXTERNAL_ORIGINS.has(url.origin);
  } catch { return false; }
}

export function trustedFrame(event, webContents, origin) {
  if (event.sender !== webContents || event.senderFrame !== webContents.mainFrame) return false;
  try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}

export function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function contentPolicy(companionOrigin) {
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${companionOrigin}; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`;
}
