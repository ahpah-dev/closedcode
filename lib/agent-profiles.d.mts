export type AgentProfile = { id: string; name: string; role: string; color: 'sage' | 'violet' | 'amber' | 'blue'; personality: string; description: string; guidance: string; updatedAt: string };
export const MAX_CUSTOM_AGENTS: number;
export const AGENT_COLORS: AgentProfile['color'][];
export function validateAgentProfile(input: unknown): AgentProfile;
export function normalizeAgentProfiles(input: unknown): AgentProfile[];
