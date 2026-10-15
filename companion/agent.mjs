import { completion, routesFor } from './provider.mjs';
import { runApprovedCommand } from './commands.mjs';
import { enforceFreeRoute } from './models.mjs';
import { prepareRouting } from './routing.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const schema = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
const text = { type: 'string' };
export const TOOLS = [
  schema('list_files', 'List regular workspace files. Ignored folders and credentials are excluded.', { path: text }),
  schema('read_file', 'Read a UTF-8 text file within the selected workspace.', { path: text }, ['path']),
  schema('write_file', 'Create or replace a workspace text file. Available only in Build mode.', { path: text, content: text }, ['path', 'content']),
  schema('git_diff', 'Read the current working-tree Git diff.', {}),
  schema('run_command', 'Request explicit user approval before running a development command. Build mode only. No shell. Every call pauses until the user approves its exact program and arguments.', { program: text, args: { type: 'array', items: text } }, ['program', 'args']),
  schema('delegate', 'Ask an independent read-only subagent to inspect or review a focused task. Maximum two delegates.', { task: text, agent: text }, ['task']),
];

const PERSONALITIES = {
  nova: 'You are Nova: a curious explorer. Investigate code with evidence, surface useful discoveries and explain tradeoffs simply.',
  forge: 'You are Forge: a pragmatic builder. Prefer small working changes and verify assumptions by reading code.',
  echo: 'You are Echo: a precise debugger. Trace root causes and edge cases, report evidence and suggest concrete fixes.',
  orbit: 'You are Orbit: a curious architecture and research specialist. Explore structure and explain tradeoffs simply.',
  atlas: 'You are Atlas: a calm, pragmatic builder. Break complex work into clear steps grounded in the existing code and keep changes focused.',
  sage: 'You are Sage: a thoughtful reviewer. Inspect correctness, maintainability and edge cases, and explain concrete improvements.',
};

function toolset(mode, plugins, allowDelegate) {
  const enabled = Array.isArray(plugins) && plugins.every((item) => typeof item === 'string') ? new Set(plugins) : null;
  const disabled = new Set(Array.isArray(plugins) ? plugins.filter((item) => typeof item === 'object' && item.enabled === false).map((item) => item.id) : []);
  return TOOLS.filter((tool) => {
    const name = tool.function.name;
    if (enabled) {
      if (['list_files', 'read_file', 'write_file', 'run_command'].includes(name) && !enabled.has('file-context')) return false;
      if (name === 'git_diff' && !enabled.has('code-review')) return false;
      if (name === 'delegate' && !enabled.has('subagents')) return false;
    }
    if (['list_files', 'read_file', 'write_file', 'run_command'].includes(name) && disabled.has('file-context')) return false;
    if (['write_file', 'run_command'].includes(name) && mode !== 'build') return false;
    if (name === 'delegate' && (!allowDelegate || disabled.has('subagents') || disabled.has('agent-swarm'))) return false;
    if (name === 'git_diff' && (disabled.has('git') || disabled.has('git-context') || disabled.has('code-review'))) return false;
    return true;
  });
}

export async function executeTool(name, args, context) {
  const { workspace, mode, delegate } = context;
  if (name === 'list_files') return workspace.list(args.path || '.');
  if (name === 'read_file') return { path: args.path, content: await workspace.read(args.path) };
  if (name === 'write_file') {
    if (mode !== 'build') throw new Error('Plan mode is read-only. Switch to Build mode to edit files.');
    return context.changes ? context.changes.write(args.path, args.content) : workspace.write(args.path, args.content);
  }
  if (name === 'git_diff') return { diff: await workspace.diff() };
  if (name === 'run_command') {
    if (mode !== 'build') throw new Error('Plan mode is read-only. Commands require Build mode and explicit approval.');
    return runApprovedCommand(args, context);
  }
  if (name === 'delegate' && delegate) return { report: await delegate(args) };
  throw new Error(`Tool is not available: ${name}`);
}

export async function runAgent(body, workspace, emit, { signal, timeoutMs, maxRounds = 12, allowDelegate = true, routes = routesFor(body), fetchImpl, requestApproval, verifyGatewaySafeguards, mcp, agentProfiles = [], changes } = {}) {
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 32_000) throw new Error('Prompt must contain 1–32,000 characters.');
  const mode = body.mode === 'build' ? 'build' : 'plan';
  const requestedAgent = typeof body.agent === 'object' ? body.agent.name : body.agent;
  const profile = agentProfiles.find((item) => item.id === requestedAgent || item.name.toLowerCase() === String(requestedAgent || '').toLowerCase());
  if (String(requestedAgent).startsWith('custom_') && !profile) throw new Error('This custom agent is unavailable. Reconnect your companion or select another agent.');
  const agentName = profile?.name || requestedAgent;
  const personality = profile ? `You are ${profile.name}, a ${profile.role}.\nPersonality: ${profile.personality}\nYour custom instructions:\n${profile.guidance}` : PERSONALITIES[String(agentName || 'nova').toLowerCase()] || PERSONALITIES.nova;
  const definitions = toolset(mode, body.plugins, allowDelegate);
  const mcpEnabled = Array.isArray(body.plugins) && body.plugins.includes('mcp');
  const bindings = mode === 'build' && allowDelegate && mcpEnabled && mcp ? mcp.bindings() : new Map();
  definitions.push(...[...bindings.values()].map((binding) => binding.definition));
  if (body.routing?.autoConfigure === true) {
    emit({ type: 'status', text: 'Checking live model catalogs and preparing available routes…' });
    const prepared = await prepareRouting({ ...body.routing, primary: routes[0], fallbacks: routes.slice(1) }, { signal, fetchImpl, verifyGatewaySafeguards });
    for (const diagnostic of prepared.diagnostics) emit({ type: 'status', text: `${diagnostic.baseUrl}: ${diagnostic.message}` });
    if (!prepared.ready) throw new Error(`Automatic configuration could not find a usable route. ${prepared.diagnostics.map((item) => item.message).join(' ')}`);
    routes = prepared.routes;
  }
  const history = Array.isArray(body.history) ? body.history.slice(-30).filter((item) => ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map(({ role, content }) => ({ role, content: content.slice(0, 32_000) })) : [];
  const messages = [{ role: 'system', content: `${personality}\nYou are ClosedCode, a local coding agent working in ${workspace.root}. ${mode === 'build' ? 'Build mode: file edits are authorized by this run. Read relevant files before editing. Preserve unrelated changes. Development commands require explicit user approval for each exact program and argument array. Request relevant verification with run_command when the tool is available.' : 'Plan mode: investigate and propose a plan. You cannot modify files or execute commands.'}\nUse the provided tools for evidence. Never claim commands or tests ran unless the run_command result proves they ran. Credential reads and ignored folders are prohibited for file tools. Do not invent file contents or tool results. Stop when the request is handled and report actual changes and limitations. You may delegate at most two focused read-only investigations.` }, ...history, { role: 'user', content: body.prompt }];
  let routeIndex = 0, delegates = 0, toolCount = 0, totalText = '';
  const failedTools = new Map();
  const completedMutations = new Map();
  emit({ type: 'status', text: `${agentName || 'Nova'} is inspecting your workspace in ${mode} mode.`, mode });
  const delegate = async ({ task, agent = 'Echo' }) => {
    if (++delegates > 2) throw new Error('This run has reached its two-subagent limit.');
    if (typeof task !== 'string' || !task.trim() || task.length > 12_000) throw new Error('Subagent task must contain 1–12,000 characters.');
    const result = await runAgent({ ...body, prompt: task, agent, mode: 'plan', history: [] }, workspace, (event) => {
      if (event.type === 'status' || event.type === 'tool') emit({ ...event, subagent: agent });
    }, { signal, timeoutMs, maxRounds: 4, allowDelegate: false, routes: routes.slice(routeIndex), fetchImpl, verifyGatewaySafeguards, agentProfiles });
    return result.text;
  };
  for (let round = 0; round < maxRounds; round++) {
    if (signal?.aborted) throw new Error('Run cancelled.');
    let response;
    let retries = 0;
    const failures = [];
    let roundStarted = false;
    const emitDelta = (delta) => {
      if (delta && !roundStarted) {
        if (totalText) emit({ type: 'delta', text: '\n\n' });
        roundStarted = true;
      }
      emit({ type: 'delta', text: delta });
    };
    for (;;) {
      let route = routes[routeIndex];
      let streamedText = '';
      try {
        if (body.routing?.freeOnly === true) {
          const verified = await enforceFreeRoute(route, { signal, fetchImpl, requireTools: definitions.length > 0, verifyGatewaySafeguards });
          if (verified.model !== route.model) emit({ type: 'status', text: `Free Only selected ${verified.model}.`, model: verified.model });
          route = verified;
          routes[routeIndex] = verified;
        }
        response = await completion(route, messages, definitions, { signal, timeoutMs, fetchImpl, onDelta: (delta) => { streamedText += delta; emitDelta(delta); } });
        break;
      } catch (error) {
        if (streamedText) { emit({ type: 'reset', text: totalText }); roundStarted = false; }
        if (!error.fallback || signal?.aborted) throw error;
        failures.push(`${route.baseUrl}: ${error.message}`);
        if (routeIndex >= routes.length - 1) {
          if (error.retryable && retries++ < 1) {
            emit({ type: 'status', text: 'Temporary provider failure. Retrying this response once; completed tools will not be repeated.' });
            await delay(500, undefined, { signal });
            continue;
          }
          throw new Error(failures.join(' | '));
        }
        const next = routes[++routeIndex];
        emit({ type: 'fallback', from: route.baseUrl, to: next.baseUrl, model: next.model, reason: error.message });
      }
    }
    messages.push(response);
    if (response.content) totalText += (totalText ? '\n\n' : '') + response.content;
    if (!response.tool_calls?.length) {
      const result = { text: totalText, model: routes[routeIndex].model, provider: routes[routeIndex].baseUrl, ...(changes ? { runId: changes.id, changeCount: changes.summary().changeCount } : {}) };
      emit({ type: 'done', ...result });
      return result;
    }
    for (const call of response.tool_calls) {
      if (++toolCount > 24) throw new Error('Run reached the 24-tool limit. Ask for a smaller task.');
      const name = call.function?.name;
      let args = {}, result;
      try {
        args = JSON.parse(call.function?.arguments || '{}');
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
        if (!definitions.some((tool) => tool.function.name === name)) throw new Error('Tool is disabled for this run.');
        const fingerprint = `${name}:${JSON.stringify(args)}`;
        if ((failedTools.get(fingerprint) || 0) >= 2) throw new Error('This tool failed twice with the same arguments. Change the approach or stop and explain the blocker.');
        emit({ type: 'tool', name, args: name === 'write_file' ? { path: args.path, bytes: typeof args.content === 'string' ? Buffer.byteLength(args.content) : 0 } : args, state: 'running' });
        const mutation = name === 'write_file' || name === 'run_command' || bindings.has(name);
        if (mutation && completedMutations.has(fingerprint)) {
          result = completedMutations.get(fingerprint);
          emit({ type: 'status', text: 'Identical completed tool request detected. Reusing its result instead of repeating the action.' });
        } else {
          result = bindings.has(name)
            ? await mcp.call(bindings.get(name), args, { signal, requestApproval })
            : await executeTool(name, args, { workspace, mode, delegate: allowDelegate ? delegate : null, signal, requestApproval, changes });
          if (mutation) completedMutations.set(fingerprint, result);
        }
        emit({ type: 'tool', name, state: 'complete', result: name === 'read_file' ? { path: args.path, bytes: result.content.length } : name === 'git_diff' ? { bytes: result.diff.length } : result });
      } catch (error) {
        const fingerprint = `${name}:${JSON.stringify(args)}`;
        failedTools.set(fingerprint, (failedTools.get(fingerprint) || 0) + 1);
        result = { error: error.message };
        if (bindings.has(name)) completedMutations.set(fingerprint, result);
        emit({ type: 'tool', name, state: 'error', error: error.message });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 512 * 1024) });
    }
  }
  throw new Error('Run reached its agent loop limit. Review the changes and continue with a focused prompt.');
}
