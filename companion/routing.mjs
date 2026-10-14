import { routesFor, ProviderError } from './provider.mjs';
import { discoverModels, enforceFreeRoute } from './models.mjs';

// Discovery performs no inference, model downloads, credential scraping or
// changes to another application's gateway. Every prepared route stays free.
export async function prepareRouting(routing = {}, options = {}) {
  const candidates = routesFor({ routing: { ...routing, fallbacks: routing.autoFallback === false ? [] : routing.fallbacks } });
  const routes = [], diagnostics = [];
  for (const route of candidates) {
    if (options.signal?.aborted) throw new ProviderError('Run cancelled.');
    try {
      const catalog = await discoverModels(route, { ...options, refresh: true });
      const requested = catalog.models.find((model) => model.id === route.model);
      // Repair a stale/missing choice, but never silently replace a listed paid
      // model with permission to charge. Enforcement still checks every call.
      const candidate = !requested ? { ...route, model: 'auto' } : route;
      const selected = routing.freeOnly !== false
        ? await enforceFreeRoute(candidate, { ...options, requireTools: true })
        : { ...candidate, model: candidate.model === 'auto' ? catalog.models.find((model) => model.compatible && model.toolCalling !== false)?.id || '' : candidate.model };
      if (!selected.model || selected.model === 'auto') throw new ProviderError('No compatible model is installed or configured.');
      if (!routes.some((item) => item.baseUrl === selected.baseUrl && item.model === selected.model)) routes.push(selected);
      diagnostics.push({ baseUrl: route.baseUrl, ready: true, model: selected.model, message: `Selected ${selected.model}${selected.model !== route.model ? ' from the live catalog' : ''}.` });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      diagnostics.push({ baseUrl: route.baseUrl, ready: false, message: error.message });
    }
  }
  return { ready: routes.length > 0, routes, diagnostics, routing: routes.length ? { ...routing, primary: routes[0], fallbacks: routes.slice(1), autoConfigure: true, freeOnly: routing.freeOnly !== false } : routing };
}
