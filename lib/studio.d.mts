export const PAD_LIMIT: number;
export function projectPadKey(workspace: string): string;
export function createReviewDiff(before?: string | null, after?: string | null): { diff: string; additions: number; deletions: number; truncated: boolean };
export interface StudioAgentEvent {
  type: string; kind?: string; name?: string; state?: string; text?: string; error?: string; reason?: string;
  args?: Record<string, unknown> | string[]; result?: unknown; subagent?: string; from?: string; to?: string;
  model?: string; id?: string; server?: string; tool?: string; program?: string; workspace?: string; commandArgs?: string[];
}
export type StudioToolEvent = StudioAgentEvent & { key: number };
export function summarizeRun(events: StudioAgentEvent[], running: boolean, waiting?: boolean): {
  state: 'idle' | 'working' | 'waiting' | 'stopped' | 'error' | 'complete'; error: string; tools: StudioToolEvent[];
  reads: number; writes: number; commands: number; successfulCommands: number; fallbacks: number;
};
