export const PAD_LIMIT = 24_000;

export function projectPadKey(workspace) {
  return `closedcode.project-pad.v1:${encodeURIComponent(String(workspace || 'unpaired'))}`;
}

export function createReviewDiff(before, after) {
  const split = (value) => typeof value === 'string' && value ? value.replace(/\r\n/g, '\n').split('\n') : [];
  const oldLines = split(before), newLines = split(after);
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(oldLines.length, newLines.length) && oldLines[prefix] === newLines[prefix]) prefix++;
  while (suffix < Math.min(oldLines.length, newLines.length) - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
  const additions = newLines.length - prefix - suffix, deletions = oldLines.length - prefix - suffix;
  if (!additions && !deletions) return { diff: '', additions: 0, deletions: 0, truncated: false };
  const start = Math.max(0, prefix - 3), contextAfter = Math.min(suffix, 3), contextBefore = prefix - start;
  const lines = [`@@ -${oldLines.length ? start + 1 : 0},${contextBefore + deletions + contextAfter} +${newLines.length ? start + 1 : 0},${contextBefore + additions + contextAfter} @@`];
  let characters = lines.join('\n').length, truncated = false;
  const append = (line) => {
    if (lines.length >= 500 || characters + line.length > 60_000) { truncated = true; return false; }
    lines.push(line); characters += line.length + 1; return true;
  };
  for (let index = start; index < prefix; index++) if (!append(` ${oldLines[index]}`)) break;
  if (!truncated) for (let index = prefix; index < oldLines.length - suffix; index++) if (!append(`-${oldLines[index]}`)) break;
  if (!truncated) for (let index = prefix; index < newLines.length - suffix; index++) if (!append(`+${newLines[index]}`)) break;
  if (!truncated) for (let index = newLines.length - suffix; index < Math.min(newLines.length, newLines.length - suffix + 3); index++) if (!append(` ${newLines[index]}`)) break;
  if (truncated) lines.push('… Diff display truncated. Open the file to inspect the full change.');
  return { diff: lines.join('\n'), additions, deletions, truncated };
}

export function summarizeRun(events, running, waiting = false) {
  const source = Array.isArray(events) ? events : [];
  const lastError = [...source].reverse().find((event) => event.type === 'error');
  const complete = source.some((event) => event.type === 'done');
  const tools = [];
  let fallbacks = 0;
  for (let index = 0; index < source.length; index++) {
    const event = source[index];
    if (event.type === 'fallback') fallbacks++;
    if (event.type !== 'tool') continue;
    const matching = [...tools].reverse().find((item) => item.state === 'running' && item.name === event.name && item.subagent === event.subagent);
    if (event.state !== 'running' && matching) {
      Object.assign(matching, { ...event, args: event.args ?? matching.args, key: matching.key });
    } else {
      tools.push({ ...event, key: index });
    }
  }
  const commands = tools.filter((item) => item.name === 'run_command' && item.state === 'complete');
  const successfulCommands = commands.filter((item) => item.result && item.result.exitCode === 0 && !item.result.timedOut && !item.result.truncated).length;
  if (!running) for (const tool of tools) if (tool.state === 'running') tool.state = 'stopped';
  if (running && waiting) {
    const pendingTool = [...tools].reverse().find((tool) => tool.state === 'running');
    if (pendingTool) pendingTool.state = 'waiting';
  }
  return {
    state: running ? (waiting ? 'waiting' : 'working') : lastError ? (/stopped by you|cancelled/i.test(lastError.error || '') ? 'stopped' : 'error') : complete ? 'complete' : 'idle',
    error: lastError?.error || '',
    tools,
    reads: tools.filter((item) => ['list_files', 'read_file'].includes(item.name) && item.state === 'complete').length,
    writes: tools.filter((item) => item.name === 'write_file' && item.state === 'complete' && item.result?.written === true).length,
    commands: commands.length,
    successfulCommands,
    fallbacks,
  };
}
