export const DEFAULT_PRIMARY = { baseUrl: 'http://127.0.0.1:20128/v1', model: 'auto' };
export const DEFAULT_FALLBACK = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b' };

export class ProviderError extends Error {
  constructor(message, fallback = false) { super(message); this.fallback = fallback; }
}

export function normalizeRoute(route = {}, fallback = DEFAULT_PRIMARY) {
  const url = new URL(route.baseUrl || fallback.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Provider URL must use HTTP or HTTPS without URL credentials, query strings or fragments.');
  return { baseUrl: url.href.replace(/\/$/, ''), model: String(route.model || fallback.model), apiKey: typeof route.apiKey === 'string' ? route.apiKey : '' };
}

export function routesFor(body) {
  const primary = normalizeRoute(body.routing?.primary, DEFAULT_PRIMARY);
  if (body.model && body.model !== 'auto') primary.model = String(body.model);
  const fallbacks = Array.isArray(body.routing?.fallbacks) ? body.routing.fallbacks.slice(0, 4).map((route) => normalizeRoute(route, DEFAULT_FALLBACK)) : [DEFAULT_FALLBACK];
  return [primary, ...fallbacks].filter((route, index, routes) => routes.findIndex((item) => item.baseUrl === route.baseUrl && item.model === route.model) === index);
}

export async function completion(route, messages, toolDefinitions, { signal, timeoutMs = 45_000, onDelta = () => {}, fetchImpl = fetch } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(`${route.baseUrl}/chat/completions`, {
      method: 'POST', signal: combined,
      headers: { 'Content-Type': 'application/json', ...(route.apiKey ? { Authorization: `Bearer ${route.apiKey}` } : {}) },
      body: JSON.stringify({ model: route.model, messages, stream: true, ...(toolDefinitions.length ? { tools: toolDefinitions, tool_choice: 'auto' } : {}) }),
    });
  } catch (error) {
    if (signal?.aborted) throw new ProviderError('Run cancelled.');
    throw new ProviderError(timeout.aborted ? 'Provider timed out.' : `Provider connection failed: ${error.message}`, true);
  }
  if (!response.ok) {
    // Error bodies may contain provider secrets; report only HTTP status.
    await response.body?.cancel().catch(() => {});
    throw new ProviderError(`Provider returned HTTP ${response.status}.`, response.status === 429 || response.status >= 500 || response.status === 408);
  }
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
    let json;
    try { json = await response.json(); }
    catch (error) {
      if (signal?.aborted) throw new ProviderError('Run cancelled.');
      throw new ProviderError(timeout.aborted ? 'Provider response timed out.' : 'Provider returned an invalid or interrupted response.', true);
    }
    const message = json.choices?.[0]?.message;
    if (!message) throw new ProviderError('Provider returned no assistant response.', true);
    if (message.content) onDelta(message.content);
    return { role: 'assistant', content: message.content || '', ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  }
  let content = '', pending = '', finished = false;
  const calls = new Map();
  const decoder = new TextDecoder();
  const accept = (block) => {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { finished = true; continue; }
      if (!data) continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      if (json.error) throw new ProviderError('Provider stream returned an error.', true);
      const choice = json.choices?.[0];
      if (choice?.finish_reason) finished = true;
      const delta = choice?.delta;
      if (typeof delta?.content === 'string') { content += delta.content; onDelta(delta.content); }
      for (const item of delta?.tool_calls || []) {
        const key = item.index ?? calls.size;
        const previous = calls.get(key) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (item.id) previous.id = item.id;
        if (item.function?.name) previous.function.name += item.function.name;
        if (item.function?.arguments) previous.function.arguments += item.function.arguments;
        if (previous.function.arguments.length > 512 * 1024 || calls.size > 24) throw new ProviderError('Provider tool arguments exceeded the output limit.');
        calls.set(key, previous);
      }
    }
  };
  try {
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true }).replaceAll('\r\n', '\n');
      if (pending.length > 2 * 1024 * 1024 || content.length > 2 * 1024 * 1024) throw new ProviderError('Provider response exceeded the output limit.');
      let split;
      while ((split = pending.indexOf('\n\n')) >= 0) {
        accept(pending.slice(0, split));
        pending = pending.slice(split + 2);
      }
    }
    if (pending.trim()) accept(pending);
  } catch (error) {
    if (signal?.aborted) throw new ProviderError('Run cancelled.');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(timeout.aborted ? 'Provider stream timed out.' : 'Provider stream disconnected.', true);
  }
  if (!finished && !content && !calls.size) throw new ProviderError('Provider stream ended without a response.', true);
  if (!finished) throw new ProviderError('Provider stream ended before completion.', true);
  return { role: 'assistant', content, ...(calls.size ? { tool_calls: [...calls.values()] } : {}) };
}
