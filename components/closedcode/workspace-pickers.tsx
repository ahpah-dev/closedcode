"use client";

import { useState } from "react";
import { Laptop, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { GlassPicker, type PickerOption } from "./glass-picker";
import { AgentAvatar, companionRequest, type ConnectionConfig, type RoutingConfig } from "./panels";

type AgentChoice = { id: string; name: string; role: string; color: string; personality?: string; description?: string };
export function AgentPicker({ agents, value, onChange, onManage, disabled }: { agents: AgentChoice[]; value: string; onChange: (id: string) => void; onManage: () => void; disabled: boolean }) {
  const selected = agents.find((agent) => agent.id === value) || agents[0];
  return <GlassPicker label="Choose agent" value={value} options={agents.map((agent) => ({ value: agent.id, label: agent.name, description: agent.role, group: agent.id.startsWith("custom_") ? "YOUR CUSTOM AGENTS" : "BUILT-IN TEAM", badge: agent.id.startsWith("custom_") ? "CUSTOM" : undefined, icon: <AgentAvatar agent={agent.id} color={agent.color} size="small" /> }))} onChange={onChange} trigger={<><AgentAvatar agent={selected.id} color={selected.color} size="small" /><span>{selected.name}</span></>} className="cc-agent-picker-trigger" searchPlaceholder="Search agents…" onManage={onManage} manageLabel="Manage your agents" disabled={disabled} />;
}

type Model = { id: string; compatible: boolean; free: boolean; toolCalling?: boolean; reason?: string };
export function ModelPicker({ routing, connection, onChange, onManage, disabled }: { routing: RoutingConfig; connection: ConnectionConfig; onChange: (routing: RoutingConfig) => void; onManage: () => void; disabled: boolean }) {
  const [models, setModels] = useState<Model[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [source, setSource] = useState("");
  const key = `${routing.primary.baseUrl}\0${routing.primary.apiKey}`;
  async function discover() {
    setError("");
    if (!connection.connected) { setError("Connect your project to discover available models."); return; }
    setLoading(true);
    try {
      const result = await companionRequest<{ models: Model[]; safeguards?: { verified: boolean; reason: string } }>(connection, "/api/models", { method: "POST", body: { route: routing.primary }, timeout: 25000 });
      setModels(result.models); setSource(key);
      if (routing.freeOnly && result.safeguards?.verified === false) { setModels([]); setError(result.safeguards.reason); }
    } catch (e) { setError(e instanceof Error ? e.message : "Model discovery failed."); setModels([]); }
    finally { setLoading(false); }
  }
  const available = source === key ? models.filter((model) => model.compatible !== false && model.toolCalling !== false && (!routing.freeOnly || model.free)) : [];
  const options: PickerOption[] = [{ value: "auto", label: routing.freeOnly ? "Free Auto" : "Auto", description: "Discover an eligible model before each run", icon: <Sparkles size={17} />, group: "AUTOMATIC", badge: routing.freeOnly ? "FREE" : undefined }, ...available.map((model) => ({ value: model.id, label: model.id.split("/").pop() || model.id, description: model.id, icon: model.reason?.includes("Ollama") ? <Laptop size={17} /> : <ShieldCheck size={17} />, group: "LIVE MODEL CATALOG", badge: model.free ? "FREE" : "PROVIDER" }))];
  if (routing.primary.model !== "auto" && !options.some((option) => option.value === routing.primary.model)) options.push({ value: routing.primary.model, label: routing.primary.model.split("/").pop() || routing.primary.model, description: "Current choice · availability will be checked before inference", group: "CURRENT CHOICE" });
  return <GlassPicker label="Choose model" value={routing.primary.model} options={options} onChange={(model) => onChange({ ...routing, primary: { ...routing.primary, model } })} trigger={<><Zap size={13} /><span>{routing.primary.model === "auto" ? routing.freeOnly ? "Free Auto" : "Auto" : routing.primary.model.split("/").pop()}</span></>} className="cc-model-picker-trigger" searchPlaceholder="Search model IDs…" onOpen={discover} loading={loading} error={error} onManage={onManage} manageLabel="Configure routes & fallbacks" disabled={disabled} />;
}
