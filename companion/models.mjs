import { createHash } from 'node:crypto';
import { normalizeRoute, DEFAULT_PRIMARY, ProviderError } from './provider.mjs';

const catalogs = new Map();
const TTL = 30_000;
const loopback = (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
const localOllama = (url) => loopback(url) && url.port === '11434' && url.pathname.replace(/\/$/, '') === '/v1';
export const isOmniRoute = (route) => { const url = new URL(route.baseUrl); return loopback(url) && url.port === '20128'; };
const GATEWAY_SAFEGUARD_REASON = 'Restart OmniRoute through ClosedCode setup to verify free-only safeguards.';
const automatic = (id) => /^auto(?:$|[/:])/i.test(id);
const numeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;

function priceEvidence(pricing) {
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) return { zero: false, conflict: false };
  const nonPrice = new Set(['currency', 'unit', 'discount', 'multiplier', 'coefficient', 'threshold', 'prompt_tokens_threshold']);
  let conflict = false;
  const check = (value, depth = 0) => {
    if (depth > 6) { conflict = true; return; }
    if (Array.isArray(value)) { value.forEach((item) => check(item, depth + 1)); return; }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (!nonPrice.has(key) && !['free', 'isFree', 'is_free'].includes(key)) check(item, depth + 1);
      }
    } else if (typeof value !== 'boolean' && value != null) {
      const price = numeric(value);
      if (price === null || price !== 0) conflict = true;
    }
  };
  check(pricing);
  const input = numeric(pricing.input ?? pricing.prompt);
  const output = numeric(pricing.output ?? pricing.completion);
  return { zero: input === 0 && output === 0 && !conflict, conflict };
}

function modelRecord(entry, isLocal, localNames) {
  const id = entry.id;
  const endpoints = entry.supported_endpoints;
  const chat = (!entry.type || entry.type === 'chat') && (!Array.isArray(endpoints) || endpoints.includes('chat') || endpoints.includes('chat/completions')) && (!Array.isArray(entry.output_modalities) || entry.output_modalities.includes('text'));
  const toolCalling = typeof entry.capabilities?.tool_calling === 'boolean' ? entry.capabilities.tool_calling : typeof entry.supportsTools === 'boolean' ? entry.supportsTools : undefined;
  const record = { id, free: false, reason: 'Pricing is unknown; Free Only blocks this model.', compatible: chat, ...(toolCalling !== undefined ? { toolCalling } : {}) };
  if (!chat) return { ...record, reason: 'This catalog entry is not compatible with chat completions.' };
  if (automatic(id) || entry.owned_by === 'combo') return { ...record, reason: 'Automatic and combo routes can include paid targets; select a verified direct model.' };
  if (isLocal) {
    if (/:cloud$|-cloud$/i.test(id) || !localNames.has(id)) return { ...record, reason: 'Model is not verified as a downloaded local Ollama model.' };
    return { ...record, free: true, reason: 'Downloaded local Ollama inference; no provider token fees.' };
  }
  if ([entry, entry.pricing].some((source) => source && ['free', 'isFree', 'is_free'].some((key) => source[key] === false))) return { ...record, reason: 'Catalog explicitly marks this model as paid.' };
  const evidence = priceEvidence(entry.pricing);
  if (evidence.conflict) return { ...record, reason: 'Catalog contains paid or unknown price components.' };
  if (id.endsWith(':free')) return { ...record, free: true, reason: 'Exact :free model alias listed by the configured gateway.' };
  if (evidence.zero) return { ...record, free: true, reason: 'Catalog verifies zero input/output pricing and no additional fees.' };
  return record;
}

async function jsonRequest(url, route, { signal, timeoutMs = 8000, fetchImpl = fetch, body } = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let response;
  try {
    response = await fetchImpl(url, { signal: abort, headers: { ...(route.apiKey ? { Authorization: `Bearer ${route.apiKey}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`HTTP ${response.status}${[401, 403].includes(response.status) ? ': enter this gateway’s API key in Model routing; Cline credentials are not shared automatically' : ''}`); }
    const input = await response.text();
    if (input.length > 4 * 1024 * 1024) throw new Error('Catalog exceeded its size limit');
    return JSON.parse(input);
  } catch (error) {
    if (signal?.aborted) throw new ProviderError('Run cancelled.');
    throw new ProviderError(deadline.aborted ? 'Free-model catalog timed out; inference is blocked.' : `Free-model catalog could not be verified (${error.message}); inference is blocked.`, true);
  }
}

export async function discoverModels(input, { refresh = false, signal, timeoutMs, fetchImpl, gatewaySafeguardsVerified = false } = {}) {
  const route = normalizeRoute(input, DEFAULT_PRIMARY);
  const key = createHash('sha256').update(`${route.baseUrl}\0${route.apiKey}`).digest('hex');
  let catalog = catalogs.get(key);
  if (!refresh && catalog && Date.now() - catalog.timestamp < TTL) {
    return summarize(catalog, route, gatewaySafeguardsVerified);
  }
  const base = new URL(route.baseUrl);
  const isLocal = localOllama(base);
  const modelsUrl = new URL(`${route.baseUrl}/models`);
  if (!isLocal) modelsUrl.searchParams.set('configuredOnly', 'true');
  const options = { signal, timeoutMs, fetchImpl };
  const response = await jsonRequest(modelsUrl.href, route, options);
  const entries = Array.isArray(response.data) ? response.data.filter((entry) => entry && typeof entry.id === 'string').slice(0, 10_000) : [];
  if (!Array.isArray(response.data)) throw new ProviderError('Model catalog is not OpenAI-compatible; free pricing cannot be verified.', true);
  const localNames = new Set();
  if (isLocal) {
    const tags = await jsonRequest(new URL('/api/tags', base).href, route, options);
    for (const model of tags.models || []) {
      if (typeof model.name === 'string' && model.size > 0 && !model.remote_host && !model.remote_model && !/:cloud$|-cloud$/i.test(model.name)) {
        localNames.add(model.name);
        if (typeof model.model === 'string') localNames.add(model.model);
      }
    }
    const pending = entries.filter((entry) => localNames.has(entry.id)).slice(0, 32);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (cursor < pending.length) {
        const entry = pending[cursor++];
        try {
          const info = await jsonRequest(new URL('/api/show', base).href, route, { ...options, timeoutMs: Math.min(timeoutMs || 8000, 2000), body: { model: entry.id } });
          if (Array.isArray(info.capabilities)) entry.capabilities = { ...entry.capabilities, tool_calling: info.capabilities.includes('tools') };
        } catch (error) { if (signal?.aborted) throw error; }
      }
    }));
  } else if (loopback(base) && base.port === '20128' && entries.some((entry) => !entry.pricing)) {
    // OmniRoute's management pricing endpoint is optional. Inference-only keys
    // may lack its manage scope; absence never creates free-price evidence.
    try {
      const pricing = await jsonRequest(new URL('/api/pricing', base).href, route, options);
      for (const entry of entries) {
        if (entry.pricing) continue;
        const owner = entry.owned_by;
        const model = entry.root || entry.id.slice(entry.id.indexOf('/') + 1);
        if (owner && pricing[owner]?.[model]) entry.pricing = pricing[owner][model];
      }
    } catch (error) { if (signal?.aborted) throw error; }
  }
  const models = entries.map((entry) => modelRecord(entry, isLocal, localNames));
  // Conflicting duplicate IDs are blocked rather than silently trusting one row.
  const deduped = new Map();
  for (const record of models) {
    const existing = deduped.get(record.id);
    if (!existing) deduped.set(record.id, record);
    else if (!record.free || !existing.free) deduped.set(record.id, { ...record, free: false, reason: 'Catalog entries conflict or do not all verify zero cost.' });
  }
  catalog = { models: [...deduped.values()], timestamp: Date.now(), source: modelsUrl.href };
  if (catalogs.size >= 100) catalogs.delete(catalogs.keys().next().value);
  catalogs.set(key, catalog);
  return summarize(catalog, route, gatewaySafeguardsVerified);
}

function summarize(catalog, route, gatewaySafeguardsVerified) {
  const eligible = catalog.models.filter((model) => model.free && model.compatible);
  const selected = automatic(route.model) || route.model === 'auto' ? eligible.find((model) => model.toolCalling === true)?.id || eligible[0]?.id : eligible.find((model) => model.id === route.model)?.id;
  return { models: catalog.models, ...(selected ? { selected } : {}), checkedAt: new Date(catalog.timestamp).toISOString(), source: catalog.source, ...(isOmniRoute(route) ? { safeguards: { verified: gatewaySafeguardsVerified, reason: gatewaySafeguardsVerified ? 'Gateway was started by ClosedCode with internal emergency fallback and free-pool fail-open disabled.' : GATEWAY_SAFEGUARD_REASON } } : {}) };
}

export async function enforceFreeRoute(route, { requireTools = false, verifyGatewaySafeguards, ...options } = {}) {
  const gatewaySafeguardsVerified = typeof verifyGatewaySafeguards === 'function' && verifyGatewaySafeguards(route) === true;
  if (isOmniRoute(route) && !gatewaySafeguardsVerified) throw new ProviderError(GATEWAY_SAFEGUARD_REASON, true);
  const catalog = await discoverModels(route, { ...options, gatewaySafeguardsVerified });
  const eligible = catalog.models.filter((model) => model.free && model.compatible && (!requireTools || model.toolCalling !== false));
  const selected = automatic(route.model) ? eligible.find((model) => model.toolCalling === true) || eligible[0] : eligible.find((model) => model.id === route.model);
  if (!selected) {
    const chosen = catalog.models.find((model) => model.id === route.model);
    const reason = chosen?.toolCalling === false && requireTools ? 'This model does not support agent tool calls.' : chosen?.reason;
    const missing = !automatic(route.model) && !chosen ? 'This model ID is absent from the live catalog. Use Auto configure to select an available model.' : 'No verified free compatible model is available. Connect a zero-priced model or download a tool-capable local Ollama model.';
    throw new ProviderError(`Free Only blocked ${route.model}: ${reason || missing}`, true);
  }
  return { ...route, model: selected.id };
}
