import { createHmac } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// OmniRoute No-Auth & Zero-Cost providers that work via synthetic no-auth or free tiers
export const OMNIROUTE_ALWAYS_FREE_PROVIDERS = new Set([
  'opencode', 'oc',
  'pollinations', 'pol',
  'duckduckgo-web', 'ddgw',
  'cloudflare-playground', 'cfp',
  'uncloseai', 'unc',
  'aihorde', 'horde',
  'routeway',
  'kilo-gateway', 'kilocode', 'kc',
  'llm7',
  'bazaarlink',
  'api-airforce',
  'nara',
  'xkiro',
  'agnes', 'agnes-cn',
  'ainative',
  'aion',
  'sealion',
  'navy',
  'openference', 'of',
  'ovhcloud', 'ovh',
]);

// OmniRoute Free OAuth / CLI / Subscription-Quota providers from FREE_MODEL_BUDGETS
export const OMNIROUTE_FREE_OAUTH_PROVIDERS = new Set([
  'qoder', 'if',
  'antigravity', 'agy', 'ag',
  'kiro', 'kr',
  'amazon-q', 'aq',
  'gemini-cli', 'gc',
  'github', 'gh',
  'cline', 'cl',
  'cursor', 'cu',
  'codex', 'cx',
  'claude', 'cc',
  'kimi-coding', 'kmc',
]);

// Provider-specific free-tier model matchers aligned with OmniRoute's freeModelCatalog
const PROVIDER_FREE_MODEL_PATTERNS = {
  'opencode-zen': (model) => /(?:^|\/)(?:big-pickle|gpt-5-nano|.*-free|.*:free)$/i.test(model),
  groq: (model) => /(?:llama|qwen|deepseek|kimi|gpt-oss|compound|allam|gemma|mixtral)/i.test(model),
  gemini: (model) => /(?:gemini-[123](?:\.\d+)?-flash|gemma-3)/i.test(model),
  sambanova: (model) => /(?:llama|deepseek|qwen|qwq)/i.test(model),
  mistral: (model) => /(?:codestral|devstral|mistral-(?:small|medium|large|nemo|tiny)|open-mistral|pixtral|ministral)/i.test(model),
  'cloudflare-ai': (model) => model.startsWith('@cf/') || /(?:llama|qwen|mistral|deepseek|gemma)/i.test(model),
  cf: (model) => model.startsWith('@cf/') || /(?:llama|qwen|mistral|deepseek|gemma)/i.test(model),
  glm: (model) => /glm-(?:4(?:\.\d+)?|z1)-flash/i.test(model),
  'glm-cn': (model) => /glm-(?:4(?:\.\d+)?|z1)-flash/i.test(model),
  zai: (model) => /glm-(?:4(?:\.\d+)?|z1)-flash/i.test(model),
  siliconflow: (model) => /(?:Qwen2\.5-(?:7B|Coder-7B)|Qwen3-8B|DeepSeek-R1-Distill-Qwen-7B|glm-4-9b|internlm2_5-7b)/i.test(model),
  'ollama-cloud': () => true,
  ollamacloud: () => true,
  cerebras: (model) => /(?:llama|qwen|gpt-oss|deepseek)/i.test(model),
  openrouter: (model) => model.endsWith(':free') || model.endsWith('-free'),
  or: (model) => model.endsWith(':free') || model.endsWith('-free'),
  nvidia: (model) => /(?:llama|qwen|deepseek|mistral|nemotron|gemma)/i.test(model),
  nvidia_nim: (model) => /(?:llama|qwen|deepseek|mistral|nemotron|gemma)/i.test(model),
  nv: (model) => /(?:llama|qwen|deepseek|mistral|nemotron|gemma)/i.test(model),
};

// Built-in OmniRoute No-Auth Free models that route immediately via OmniRoute's
// synthetic "noauth" connection even before any provider key or OAuth login is added.
export const DEFAULT_OMNIROUTE_NOAUTH_FREE_MODELS = [
  {
    id: 'opencode/qwen3.6-plus-free',
    root: 'qwen3.6-plus-free',
    owned_by: 'opencode',
    capabilities: { tool_calling: true },
    supportsTools: true,
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'opencode/minimax-m2.5-free',
    root: 'minimax-m2.5-free',
    owned_by: 'opencode',
    capabilities: { tool_calling: true },
    supportsTools: true,
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'opencode/big-pickle',
    root: 'big-pickle',
    owned_by: 'opencode',
    capabilities: { tool_calling: true },
    supportsTools: true,
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'opencode/gpt-5-nano',
    root: 'gpt-5-nano',
    owned_by: 'opencode',
    capabilities: { tool_calling: true },
    supportsTools: true,
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'opencode/nemotron-3-super-free',
    root: 'nemotron-3-super-free',
    owned_by: 'opencode',
    capabilities: { tool_calling: true },
    supportsTools: true,
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'opencode/mimo-v2-pro-free',
    root: 'mimo-v2-pro-free',
    owned_by: 'opencode',
    capabilities: { tool_calling: true },
    supportsTools: true,
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'routeway/devstral-2512:free',
    root: 'devstral-2512:free',
    owned_by: 'routeway',
    capabilities: { tool_calling: true },
    supportsTools: true,
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'kilo-gateway/minimax/minimax-m2.5:free',
    root: 'minimax/minimax-m2.5:free',
    owned_by: 'kilo-gateway',
    capabilities: { tool_calling: true },
    supportsTools: true,
    pricing: { input: 0, output: 0 },
  },
];

function splitProviderAndModel(entry) {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
  const slashIndex = id.indexOf('/');
  const prefix = slashIndex > 0 ? id.slice(0, slashIndex).toLowerCase() : '';
  const root = (typeof entry?.root === 'string' && entry.root.trim())
    ? entry.root.trim()
    : (slashIndex > 0 ? id.slice(slashIndex + 1) : id);
  const owner = typeof entry?.owned_by === 'string' ? entry.owned_by.trim().toLowerCase() : '';
  return { id, prefix, owner, root };
}

export function inferOmniRouteToolSupport(entry) {
  if (typeof entry?.capabilities?.tool_calling === 'boolean') return entry.capabilities.tool_calling;
  if (typeof entry?.supportsTools === 'boolean') return entry.supportsTools;
  const { id, prefix, owner, root } = splitProviderAndModel(entry);
  if (/embed|rerank|whisper|tts|speech|moderation|dall-e|flux|sdxl|stable-diffusion/i.test(id)) return false;
  if (OMNIROUTE_ALWAYS_FREE_PROVIDERS.has(owner) || OMNIROUTE_ALWAYS_FREE_PROVIDERS.has(prefix)) return true;
  if (OMNIROUTE_FREE_OAUTH_PROVIDERS.has(owner) || OMNIROUTE_FREE_OAUTH_PROVIDERS.has(prefix)) return true;
  if (PROVIDER_FREE_MODEL_PATTERNS[owner] || PROVIDER_FREE_MODEL_PATTERNS[prefix]) return true;
  if (/(?:coder|claude|gpt|gemini|qwen|deepseek|llama-3\.[123]|llama-4|mistral|codestral|devstral|minimax|glm|kimi|nemotron|big-pickle)/i.test(root)) {
    return true;
  }
  return undefined;
}

export function classifyOmniRouteFreeModel(entry, freeCatalogMap = null) {
  if (!entry || typeof entry.id !== 'string') return null;
  const { id, prefix, owner, root } = splitProviderAndModel(entry);
  const lowerId = id.toLowerCase();
  const lowerRoot = root.toLowerCase();

  if (freeCatalogMap instanceof Map) {
    const matched = freeCatalogMap.get(lowerId)
      || (owner ? freeCatalogMap.get(`${owner}/${lowerRoot}`) : null)
      || (prefix ? freeCatalogMap.get(`${prefix}/${lowerRoot}`) : null)
      || freeCatalogMap.get(lowerRoot);
    if (matched) {
      return {
        free: true,
        toolCalling: inferOmniRouteToolSupport(entry) ?? true,
        reason: `Verified by OmniRoute Free catalog (${matched.provider || owner || prefix || 'free'} · ${matched.freeType || 'free tier'}).`,
      };
    }
  }

  if (lowerId.endsWith(':free') || lowerId.endsWith('-free') || lowerRoot.endsWith(':free') || lowerRoot.endsWith('-free')) {
    return {
      free: true,
      toolCalling: inferOmniRouteToolSupport(entry),
      reason: 'Verified free OmniRoute model variant (:free / -free).',
    };
  }

  for (const tag of [owner, prefix].filter(Boolean)) {
    if (OMNIROUTE_ALWAYS_FREE_PROVIDERS.has(tag)) {
      return {
        free: true,
        toolCalling: inferOmniRouteToolSupport(entry) ?? true,
        reason: `Verified OmniRoute zero-cost no-auth provider (${tag}).`,
      };
    }
    if (OMNIROUTE_FREE_OAUTH_PROVIDERS.has(tag)) {
      return {
        free: true,
        toolCalling: inferOmniRouteToolSupport(entry) ?? true,
        reason: `Verified OmniRoute free OAuth/CLI provider quota (${tag}).`,
      };
    }
    const matcher = PROVIDER_FREE_MODEL_PATTERNS[tag];
    if (matcher && (matcher(root) || matcher(id))) {
      return {
        free: true,
        toolCalling: inferOmniRouteToolSupport(entry) ?? true,
        reason: `Verified OmniRoute free-tier model for provider (${tag}).`,
      };
    }
  }

  return null;
}

export function scoreOmniRouteFreeModel(record) {
  if (!record?.free || !record?.compatible) return -1;
  const id = String(record.id || '').toLowerCase();
  let score = record.toolCalling === true ? 500 : record.toolCalling === false ? -100 : 250;
  if (id.startsWith('opencode/')) score += 120;
  if (id.includes('qwen3.6-plus-free') || id.includes('qwen3-coder')) score += 95;
  else if (id.includes('claude-sonnet') || id.includes('claude-4')) score += 92;
  else if (id.includes('minimax-m2.5') || id.includes('minimax-m3')) score += 88;
  else if (id.includes('gemini-2.5-flash') || id.includes('gemini-3')) score += 85;
  else if (id.includes('codestral') || id.includes('devstral') || id.includes('coder')) score += 82;
  else if (id.includes('big-pickle')) score += 80;
  else if (id.includes('gpt-5-nano') || id.includes('gpt-oss-120b') || id.includes('gpt-4o')) score += 75;
  else if (id.includes('llama-3.3-70b') || id.includes('qwen3-32b') || id.includes('nemotron-3-super')) score += 70;
  else if (id.endsWith(':free') || id.endsWith('-free')) score += 60;
  return score;
}

export function buildFreeCatalogMap(payload) {
  const map = new Map();
  const list = Array.isArray(payload?.models) ? payload.models : Array.isArray(payload?.data) ? payload.data : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (item.freeType === 'discontinued') continue;
    const modelId = typeof item.modelId === 'string' ? item.modelId.trim() : typeof item.id === 'string' ? item.id.trim() : '';
    if (!modelId) continue;
    const provider = typeof item.provider === 'string' ? item.provider.trim().toLowerCase() : '';
    const info = { provider, freeType: item.freeType || 'free' };
    map.set(modelId.toLowerCase(), info);
    if (provider) map.set(`${provider}/${modelId.toLowerCase()}`, info);
    if (Array.isArray(item.providers)) {
      for (const p of item.providers) {
        if (typeof p === 'string' && p.trim()) map.set(`${p.trim().toLowerCase()}/${modelId.toLowerCase()}`, info);
      }
    }
  }
  return map;
}

export function signOmniRouteLoopbackToken(secret) {
  if (typeof secret !== 'string' || !secret.trim()) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ authenticated: true, iat: now, exp: now + 3600 })).toString('base64url');
  const signature = createHmac('sha256', Buffer.from(secret.trim(), 'utf8')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export async function mintLocalOmniRouteCookie(explicitSecret) {
  if (typeof explicitSecret === 'string' && explicitSecret.trim()) {
    return signOmniRouteLoopbackToken(explicitSecret);
  }
  const candidates = [
    process.env.DATA_DIR ? path.join(process.env.DATA_DIR, '.env') : null,
    path.join(os.homedir(), '.omniroute', '.env'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'omniroute', '.env') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.omniroute', '.env') : null,
  ].filter(Boolean);

  for (const envPath of candidates) {
    try {
      const content = await fs.readFile(envPath, 'utf8');
      const match = /^\s*JWT_SECRET\s*=\s*([^\r\n#]+)/m.exec(content);
      if (match?.[1]) {
        const secret = match[1].trim().replace(/^['"]|['"]$/g, '');
        const token = signOmniRouteLoopbackToken(secret);
        if (token) return token;
      }
    } catch {}
  }
  return null;
}
