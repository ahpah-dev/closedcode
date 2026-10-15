// Preview launches use a separate capability from ordinary external links.
// Only explicit development servers on loopback and unprivileged ports qualify.
export function localPreviewUrl(input, blockedOrigins = []) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Enter a local development URL such as http://localhost:5173.');
  if (/[\\\s]/.test(input.trim()) || !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{1,5}(?:[/?#]|$)/i.test(input.trim())) throw new Error('Enter an explicit loopback development URL such as http://localhost:5173.');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a complete local development URL, including http:// and its port.'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || !url.port || Number(url.port) < 1024 || [20128, 11434].includes(Number(url.port)) || blockedOrigins.includes(url.origin)) {
    throw new Error('Preview opens a local project server on localhost, 127.0.0.1, or [::1], using HTTP and a development port.');
  }
  return url.href;
}
