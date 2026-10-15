"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, Blocks, Check, CheckCircle2,
  ChevronDown, Code2, Copy, ExternalLink, Eye, EyeOff, FileSearch,
  Fingerprint, FolderOpen, GitBranch, KeyRound, Laptop, LoaderCircle,
  Monitor, Moon, Network, Plus, Radio, RefreshCw, Settings2, ShieldCheck,
  Sparkles, Sun, Terminal, Trash2, Users, X, Zap,
  type LucideIcon,
} from "lucide-react";
import "./panels.css";
import "./connection-flow.css";
import { McpPanel } from "./mcp-panel";
import { CustomAgents } from "./custom-agents";
import type { AgentProfile } from "@/lib/agent-profiles.mjs";

export type ProviderRoute = { baseUrl: string; model: string; apiKey: string };
export type RoutingConfig = {
  primary: ProviderRoute;
  fallbacks: ProviderRoute[];
  autoFallback: boolean;
  freeOnly: boolean;
  autoConfigure?: boolean;
};
export type ConnectionConfig = {
  baseUrl: string;
  token: string;
  connected: boolean;
  workspace: string;
};

export const BUILT_IN_AGENTS = [
  {
    id: "atlas", name: "Atlas", role: "The builder", color: "sage",
    personality: "Calm. Capable. Always moving forward.",
    description: "Turns a good idea into working software. Atlas connects the pieces and keeps the whole project in view.",
    specialty: "Full-stack implementation", icon: Code2,
    guidance: "Build complete, maintainable solutions. Read the project before editing, make focused changes, and verify the result. Explain decisions clearly and keep moving until the task is complete.",
    tags: ["Build", "Refactor", "Ship"],
  },
  {
    id: "nova", name: "Nova", role: "The explorer", color: "violet",
    personality: "Curious by nature. Thoughtful by design.",
    description: "Finds the way through an unfamiliar codebase. Nova follows the interesting questions before making a plan.",
    specialty: "Research & architecture", icon: FileSearch,
    guidance: "Explore the codebase systematically. Find the relevant files, trace dependencies, compare approaches, and produce a practical plan grounded in the project. Be curious, concise, and honest about uncertainty.",
    tags: ["Explore", "Plan", "Understand"],
  },
  {
    id: "sage", name: "Sage", role: "The reviewer", color: "amber",
    personality: "A sharp eye. A steady perspective.",
    description: "Makes good code better. Sage looks closely at correctness, edge cases, and the things a test might miss.",
    specialty: "Code quality & review", icon: ShieldCheck,
    guidance: "Review for concrete correctness, security, and maintainability issues. Inspect the surrounding code, prioritize actionable findings, cite affected files, and distinguish verified problems from assumptions.",
    tags: ["Review", "Validate", "Improve"],
  },
  {
    id: "echo", name: "Echo", role: "The debugger", color: "blue",
    personality: "Patient with problems. Precise with fixes.",
    description: "Gets to the root of an unexpected behavior. Echo reproduces, investigates, and fixes with a light touch.",
    specialty: "Debugging & diagnostics", icon: Terminal,
    guidance: "Reproduce the failure and identify its root cause before changing code. Use available logs and tests, make the smallest effective fix, verify it, and explain what failed and why the fix works.",
    tags: ["Diagnose", "Debug", "Test"],
  },
] as const;

export function AgentAvatar({ agent, color, size = "large" }: { agent: string; color?: string; size?: "small" | "large" }) {
  const definition = BUILT_IN_AGENTS.find((item) => item.id === agent) || BUILT_IN_AGENTS[0];
  return (
    <span className={`ccp-avatar ${agent.startsWith("custom_") ? "ccp-avatar--custom" : ""} ccp-avatar--${color || definition.color} ccp-avatar--${size}`} aria-hidden="true">
      <span className="ccp-avatar-orbit" />
      <span className="ccp-avatar-body"><span className="ccp-avatar-eye" /><span className="ccp-avatar-eye" /><span className="ccp-avatar-mouth" /></span>
      <span className="ccp-avatar-spark ccp-avatar-spark--one" /><span className="ccp-avatar-spark ccp-avatar-spark--two" />
    </span>
  );
}

function PanelHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="ccp-heading">
      <div><div className="ccp-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>
      {action ? <div className="ccp-heading-action">{action}</div> : null}
    </div>
  );
}

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: () => void; label: string }) {
  return <button type="button" className={`ccp-toggle ${enabled ? "is-on" : ""}`} role="switch" aria-checked={enabled} aria-label={label} onClick={onChange}><span /></button>;
}

export function AgentsPanel({ selectedAgent, onSelect, customAgents, onSave, onDelete }: { selectedAgent: string; onSelect: (id: string) => void; customAgents: AgentProfile[]; onSave: (profile: AgentProfile) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [inspect, setInspect] = useState<string | null>(null);
  return (
    <div className="cc-panels">
      <PanelHeading eyebrow="A LITTLE PERSONALITY. A LOT OF CAPABILITY." title="Meet your team." description="Different perspectives. One shared goal: help you build something great." action={<span className="ccp-pill"><span className="ccp-dot" />4 built-in agents</span>} />
      <div className="ccp-agents-grid">
        {BUILT_IN_AGENTS.map((agent) => {
          const active = selectedAgent === agent.id;
          const Icon = agent.icon;
          return (
            <article className={`ccp-agent-card ccp-agent-card--${agent.color} ${active ? "is-selected" : ""}`} key={agent.id}>
              <div className="ccp-agent-top"><AgentAvatar agent={agent.id} />{active ? <span className="ccp-selected"><Check size={12} />Selected</span> : <span className="ccp-agent-number">0{BUILT_IN_AGENTS.indexOf(agent) + 1}</span>}</div>
              <div className="ccp-agent-name"><h2>{agent.name}</h2><span>{agent.role}</span></div>
              <p className="ccp-personality">{agent.personality}</p>
              <p className="ccp-agent-description">{agent.description}</p>
              <div className="ccp-agent-specialty"><Icon size={15} />{agent.specialty}</div>
              <div className="ccp-tags">{agent.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <button className={`ccp-button ccp-agent-select ${active ? "ccp-button--selected" : "ccp-button--secondary"}`} type="button" onClick={() => onSelect(agent.id)}>{active ? <><Check size={15} />Your active agent</> : <>Work with {agent.name}<ArrowUpRight size={15} /></>}</button>
              <button className="ccp-guidance-toggle" type="button" aria-expanded={inspect === agent.id} onClick={() => setInspect(inspect === agent.id ? null : agent.id)}>Agent approach<ChevronDown size={13} className={inspect === agent.id ? "is-open" : ""} /></button>
              {inspect === agent.id ? <div className="ccp-agent-guidance">{agent.guidance}<span>This built-in preset shapes the agent’s approach to your tasks.</span></div> : null}
            </article>
          );
        })}
      </div>
      <div className="ccp-team-note"><div className="ccp-note-symbol"><Users size={20} /></div><div><h3>Better together.</h3><p>Enable subagents in Plugins to let your active agent delegate focused work to another member of the team.</p></div><div className="ccp-mini-team">{BUILT_IN_AGENTS.map((agent) => <AgentAvatar key={agent.id} agent={agent.id} size="small" />)}</div></div>
      <CustomAgents agents={customAgents} selected={selectedAgent} onSelect={onSelect} onSave={onSave} onDelete={onDelete} />
    </div>
  );
}

const PLUGINS: { id: string; name: string; subtitle: string; description: string; icon: LucideIcon; color: string; capabilities: string[] }[] = [
  { id: "mcp", name: "MCP servers", subtitle: "Connect the tools you work with", description: "Give Build agents access to connected MCP tools. Every external tool call asks for your approval.", icon: Network, color: "blue", capabilities: ["Local & HTTP servers", "Approve every tool call"] },
  { id: "file-context", name: "File context", subtitle: "A little context goes a long way", description: "Give your agent tools to list, read, search, and edit files inside your selected project folder.", icon: FolderOpen, color: "sage", capabilities: ["Read & search files", "Workspace-scoped edits"] },
  { id: "code-review", name: "Code review", subtitle: "A second pair of eyes", description: "Let your agent inspect the current Git diff and review changes before you wrap up a task.", icon: GitBranch, color: "violet", capabilities: ["Inspect Git diffs", "Review uncommitted changes"] },
  { id: "subagents", name: "Subagents", subtitle: "Divide the work. Multiply the focus.", description: "Allow up to two focused, read-only investigations by another agent for exploration, review, or debugging. Subagents use your configured model routes.", icon: Users, color: "amber", capabilities: ["Delegate investigations", "Specialized perspectives"] },
];

export function PluginsPanel({ enabled, onToggle, connection }: { enabled: string[]; onToggle: (id: string) => void; connection: ConnectionConfig }) {
  return (
    <div className="cc-panels">
      <PanelHeading eyebrow="SMALL TOOLS. BIG POSSIBILITIES." title="Make it your own." description="Give your agents the right tools for the way you work." action={<span className="ccp-pill"><Blocks size={13} />{enabled.filter((id) => PLUGINS.some((plugin) => plugin.id === id)).length} of {PLUGINS.length} enabled</span>} />
      <div className="ccp-section-line"><span>BUILT-IN PLUGINS</span><span>Included with ClosedCode</span></div>
      <div className="ccp-plugins-list">
        {PLUGINS.map((plugin) => {
          const active = enabled.includes(plugin.id);
          const Icon = plugin.icon;
          return (
            <article className={`ccp-plugin-card ${active ? "is-enabled" : ""}`} key={plugin.id}>
              <div className={`ccp-plugin-icon ccp-icon--${plugin.color}`}><Icon size={23} strokeWidth={1.6} /></div>
              <div className="ccp-plugin-content"><div className="ccp-plugin-title"><h2>{plugin.name}</h2><span className="ccp-included">Built-in</span></div><span className="ccp-plugin-subtitle">{plugin.subtitle}</span><p>{plugin.description}</p><div className="ccp-plugin-capabilities">{plugin.capabilities.map((capability) => <span key={capability}><Check size={12} />{capability}</span>)}</div></div>
              <div className="ccp-plugin-control"><Toggle enabled={active} onChange={() => onToggle(plugin.id)} label={`${active ? "Disable" : "Enable"} ${plugin.name}`} /><span>{active ? "Enabled" : "Disabled"}</span></div>
            </article>
          );
        })}
      </div>
      <div className="ccp-subtle-note"><ShieldCheck size={17} /><p>These tools run through your local companion. File access stays within your chosen workspace. Plan mode reads and investigates; Build mode allows file edits.</p></div>
      <McpPanel connection={connection} enabled={enabled.includes("mcp")} />
    </div>
  );
}

type GatewaySafeguards = { verified: boolean; emergencyFallbackDisabled?: boolean; directModelsOnly?: boolean; reason?: string; code?: string; inferenceAuth?: "missing" | "accepted" | "rejected" | "unknown"; managementAuth?: "accepted" | "rejected" };
type CompanionHealth = { ok: boolean; version?: string; workspace?: string; omniroute?: { baseUrl?: string; dashboardUrl?: string; status?: string; safeguards?: GatewaySafeguards } };

export async function companionRequest<T>(connection: ConnectionConfig, path: string, options: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T> {
  let baseUrl: URL;
  try { baseUrl = new URL(connection.baseUrl); } catch { throw new Error("Enter a valid companion URL, such as http://127.0.0.1:47821."); }
  if (!["http:", "https:"].includes(baseUrl.protocol)) throw new Error("The companion URL must start with http:// or https://.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 12000);
  try {
    const response = await fetch(`${connection.baseUrl.replace(/\/$/, "")}${path}`, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
    const raw: unknown = await response.json().catch(() => ({}));
    const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (!response.ok || data.ok === false || data.error) throw new Error(typeof data.error === "string" ? data.error : `Companion returned HTTP ${response.status}.`);
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("The companion took too long to respond. Check that it is running and try again.");
    if (error instanceof TypeError) throw new Error("Could not reach the local companion. Start it, check the URL, and allow this site’s origin in its configuration.");
    throw error;
  } finally { clearTimeout(timeout); }
}

function RouteFields({ route, onChange, label, disabled = false, hideKey = false }: { route: ProviderRoute; onChange: (value: ProviderRoute) => void; label: string; disabled?: boolean; hideKey?: boolean }) {
  const [showKey, setShowKey] = useState(false);
  return <div className="ccp-route-fields"><label className="ccp-field ccp-field--wide"><span>OpenAI-compatible endpoint</span><input disabled={disabled} aria-label={`${label} endpoint`} type="url" value={route.baseUrl} placeholder="http://127.0.0.1:20128/v1" onChange={(event) => onChange({ ...route, baseUrl: event.target.value })} spellCheck={false} /></label><label className="ccp-field"><span>Model ID</span><input disabled={disabled} aria-label={`${label} model`} value={route.model} placeholder="Select a verified model below" onChange={(event) => onChange({ ...route, model: event.target.value })} spellCheck={false} /></label>{hideKey ? null : <label className="ccp-field"><span>API key <small>if required</small></span><span className="ccp-input-with-button"><input disabled={disabled} aria-label={`${label} API key`} type={showKey ? "text" : "password"} value={route.apiKey} placeholder="Your provider or gateway key" onChange={(event) => onChange({ ...route, apiKey: event.target.value })} spellCheck={false} autoComplete="off" /><button type="button" aria-label={`${showKey ? "Hide" : "Show"} ${label.toLowerCase()} API key`} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>}</div>;
}

export function isOmniRouteUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "20128";
  } catch {
    return false;
  }
}

type DiscoveredModel = { id: string; free: boolean; reason?: string; compatible?: boolean; toolCalling?: boolean };

function GatewayReadiness({ connected, hasKey, safeguards, modelReady, model }: { connected: boolean; hasKey: boolean; safeguards: GatewaySafeguards | null; modelReady: boolean; model?: string }) {
  const steps = [
    { name: "Gateway key", detail: safeguards?.inferenceAuth === "accepted" ? "Model access confirmed" : safeguards?.inferenceAuth === "rejected" ? "Key was not accepted" : hasKey ? "Key saved · check access" : "Add your OmniRoute key", complete: safeguards?.managementAuth === "accepted" || safeguards?.inferenceAuth === "accepted" },
    { name: "Free-only safeguard", detail: safeguards?.verified ? "Live fallback policy verified" : safeguards?.code === "management_permission_required" ? "Key needs manage permission" : connected ? "Verify the running gateway" : "Pair your local engine first", complete: safeguards?.verified === true },
    { name: "Coding model", detail: modelReady ? model || "Compatible model selected" : "Discover a compatible model", complete: modelReady },
  ];
  return <ol className="ccp-gateway-checklist" aria-label="Gateway readiness">{steps.map((step, index) => <li className={step.complete ? "is-complete" : ""} key={step.name}><span className="ccp-gateway-check-number">{step.complete ? <Check size={13} /> : index + 1}</span><div><strong>{step.name}</strong><span>{step.detail}</span></div></li>)}</ol>;
}

function GatewayKeyHelp() {
  return <details className="ccp-gateway-key-help"><summary><KeyRound size={13} />Where do I get this key?<ChevronDown size={12} /></summary><ol><li>Open your OmniRoute dashboard and create a dedicated ClosedCode gateway key.</li><li>Give it <code>manage</code> permission so ClosedCode can read and verify the fallback setting.</li><li>Paste that key here. Credentials saved in Cline are not imported.</li></ol></details>;
}

function eligibleModel(models: DiscoveredModel[], freeOnly: boolean, current: string) {
  const eligible = models.filter((model) => model.compatible !== false && model.toolCalling !== false && (!freeOnly || model.free === true));
  return eligible.find((model) => model.id === current) || eligible.find((model) => model.toolCalling === true) || eligible[0];
}

export function RoutingPanel({ routing, onChange, connection, onSetup }: { routing: RoutingConfig; onChange: (value: RoutingConfig) => void; connection: ConnectionConfig; onConnectionChange: (value: ConnectionConfig) => void; onSetup: () => void }) {
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<CompanionHealth | null>(null);
  const [probeError, setProbeError] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [catalog, setCatalog] = useState<DiscoveredModel[]>([]);
  const [catalogSource, setCatalogSource] = useState<ProviderRoute | null>(null);
  const [catalogSafeguards, setCatalogSafeguards] = useState<GatewaySafeguards | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [verifyingGateway, setVerifyingGateway] = useState(false);
  const [gatewayResult, setGatewayResult] = useState<GatewaySafeguards | null>(null);
  const [diagnostics, setDiagnostics] = useState<{ baseUrl: string; ready: boolean; message: string }[]>([]);
  const isOmni = isOmniRouteUrl(routing.primary.baseUrl);
  const [omniKey, setOmniKey] = useState(isOmni ? routing.primary.apiKey : "");
  const [showOmniKey, setShowOmniKey] = useState(false);
  const [omniSettingUp, setOmniSettingUp] = useState(false);
  const [omniSuccessMessage, setOmniSuccessMessage] = useState("");
  const gatewaySource = useRef<ProviderRoute | null>(null);
  const latestRouting = useRef(routing);
  useEffect(() => { latestRouting.current = routing; }, [routing]);
  useEffect(() => {
    if (gatewaySource.current?.baseUrl !== routing.primary.baseUrl || gatewaySource.current?.apiKey !== routing.primary.apiKey) {
      setGatewayResult(null); setCatalogSafeguards(null); setOmniSuccessMessage("");
    }
  }, [routing.primary.baseUrl, routing.primary.apiKey]);
  useEffect(() => {
    if (isOmniRouteUrl(routing.primary.baseUrl)) {
      setOmniKey(routing.primary.apiKey);
    }
  }, [routing.primary.baseUrl, routing.primary.apiKey]);

  async function setupOmniRoute() {
    setOmniSettingUp(true); setCatalogError(""); setGatewayResult(null); setOmniSuccessMessage("");
    const source = routing.primary;
    const key = omniKey.trim();
    const targetRoute: ProviderRoute = {
      baseUrl: isOmni ? source.baseUrl : "http://127.0.0.1:20128/v1",
      model: isOmni ? source.model || "auto" : "auto",
      apiKey: key,
    };
    try {
      const startRes = await companionRequest<{ ok: boolean; status: string; dashboardUrl?: string }>(
        connection,
        "/api/omniroute",
        { method: "POST", body: { apiKey: key, configure: false }, timeout: 35000 }
      );
      let running = startRes.status === "running";
      if (!running) {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1200));
          try {
            const healthRes = await companionRequest<CompanionHealth>(connection, "/api/health", { timeout: 2500 });
            if (healthRes.omniroute?.status === "running") { running = true; break; }
          } catch {}
        }
      }
      if (!running) {
        setCatalogError("OmniRoute is taking a little time to start. Wait a few moments, or check its terminal.");
        return;
      }

      const safeRes = await companionRequest<{ safeguards: GatewaySafeguards }>(
        connection,
        "/api/omniroute/safeguards",
        { method: "POST", body: { route: targetRoute, configure: true }, timeout: 15000 }
      );
      if (latestRouting.current.primary.baseUrl !== source.baseUrl || latestRouting.current.primary.apiKey !== source.apiKey) return;
      gatewaySource.current = targetRoute;
      setGatewayResult(safeRes.safeguards);
      setCatalogSafeguards(safeRes.safeguards);

      if (!safeRes.safeguards.verified) {
        return;
      }

      const catalogRes = await companionRequest<{ models: DiscoveredModel[]; selected?: string }>(
        connection,
        "/api/models",
        { method: "POST", body: { route: targetRoute, refresh: true }, timeout: 25000 }
      );
      if (latestRouting.current.primary.baseUrl !== source.baseUrl || latestRouting.current.primary.apiKey !== source.apiKey) return;
      const models = Array.isArray(catalogRes.models) ? catalogRes.models : [];
      setCatalog(models); setCatalogSource(targetRoute);
      const selected = eligibleModel(models, routing.freeOnly, targetRoute.model);
      const chosenModel = selected?.id || "auto";

      onChange({
        ...latestRouting.current,
        primary: { ...targetRoute, model: chosenModel },
      });
      setOmniSuccessMessage(selected
        ? `Gateway verified. ${chosenModel} is selected and ready for the next run.`
        : "Gateway verified. Connect a compatible zero-cost model in OmniRoute, then discover models below."
      );
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "OmniRoute setup failed.");
    } finally {
      setOmniSettingUp(false);
    }
  }

  async function verifyGateway(configure = false) {
    setVerifyingGateway(true); setCatalogError("");
    const route = routing.primary;
    try {
      const data = await companionRequest<{ safeguards: GatewaySafeguards }>(connection, "/api/omniroute/safeguards", { method: "POST", body: { route, configure }, timeout: 15000 });
      if (latestRouting.current.primary.baseUrl !== route.baseUrl || latestRouting.current.primary.apiKey !== route.apiKey) return;
      gatewaySource.current = route;
      setGatewayResult(data.safeguards);
      setCatalogSafeguards(data.safeguards);
      if (data.safeguards.verified) await discoverModels();
    } catch (error) { setCatalogError(error instanceof Error ? error.message : "Gateway verification failed."); }
    finally { setVerifyingGateway(false); }
  }

  async function autoConfigure(local = false) {
    setPreparing(true); setCatalogError(""); setDiagnostics([]);
    const input = local ? { ...routing, primary: { baseUrl: "http://127.0.0.1:11434/v1", model: "auto", apiKey: "" }, fallbacks: [] } : routing;
    try {
      const data = await companionRequest<{ ready: boolean; routing: RoutingConfig; diagnostics: { baseUrl: string; ready: boolean; message: string }[] }>(connection, "/api/routing/prepare", { method: "POST", body: { routing: input }, timeout: 60000 });
      setDiagnostics(data.diagnostics);
      if (data.ready && latestRouting.current === routing) { onChange(data.routing); setCatalogSource(null); }
      else if (!data.ready) setCatalogError("No usable route found. Follow the diagnostics below, then configure again.");
    } catch (error) { setCatalogError(error instanceof Error ? error.message : "Automatic configuration failed."); }
    finally { setPreparing(false); }
  }

  async function checkHealth() {
    setChecking(true); setProbeError(""); setHealth(null);
    try {
      const data = await companionRequest<CompanionHealth>(connection, "/api/health");
      if (!data.ok) throw new Error("The companion did not report a healthy status.");
      setHealth(data); setCheckedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (error) { setProbeError(error instanceof Error ? error.message : "Connection check failed."); }
    finally { setChecking(false); }
  }

  async function discoverModels() {
    setDiscovering(true); setCatalogError(""); setModelSearch("");
    try {
      const source = routing.primary;
      const data = await companionRequest<{ models: DiscoveredModel[]; selected?: string; safeguards?: GatewaySafeguards }>(connection, "/api/models", { method: "POST", body: { route: source, refresh: true }, timeout: 25000 });
      if (latestRouting.current.primary.baseUrl !== source.baseUrl || latestRouting.current.primary.apiKey !== source.apiKey) return;
      if (!Array.isArray(data.models)) throw new Error("The companion did not return a model catalog.");
      const models = data.models.filter((model) => typeof model.id === "string");
      setCatalog(models); setCatalogSource(routing.primary);
      gatewaySource.current = source; setCatalogSafeguards(data.safeguards || null);
      const suggested = models.find((model) => model.id === data.selected && model.free === true && model.compatible !== false && model.toolCalling !== false);
      const firstEligible = eligibleModel(models, routing.freeOnly, "");
      const current = latestRouting.current;
      const sourceStillSelected = current.primary.baseUrl === routing.primary.baseUrl && current.primary.apiKey === routing.primary.apiKey;
      if (sourceStillSelected && !(current.freeOnly && data.safeguards?.verified === false) && (suggested || (!current.primary.model || current.primary.model === "auto"))) {
        const selected = suggested || firstEligible;
        if (selected) onChange({ ...current, primary: { ...current.primary, model: selected.id } });
      }
    } catch (error) { setCatalogError(error instanceof Error ? error.message : "Model discovery failed."); setCatalogSource(null); }
    finally { setDiscovering(false); }
  }

  const catalogCurrent = catalogSource?.baseUrl === routing.primary.baseUrl && catalogSource?.apiKey === routing.primary.apiKey;
  const availableModels = catalogCurrent ? catalog : [];
  const freeModels = availableModels.filter((model) => model.free === true && model.compatible !== false && model.toolCalling !== false);
  const visibleModels = (routing.freeOnly ? freeModels : availableModels).filter((model) => model.id.toLowerCase().includes(modelSearch.toLowerCase()));
  const gatewayBlocked = routing.freeOnly && catalogCurrent && catalogSafeguards?.verified === false;
  const selectedVerified = !gatewayBlocked && availableModels.some((model) => model.id === routing.primary.model && model.free === true && model.compatible !== false && model.toolCalling !== false);
  const selectedReady = !gatewayBlocked && availableModels.some((model) => model.id === routing.primary.model && model.compatible !== false && model.toolCalling !== false && (!routing.freeOnly || model.free === true));
  const configured = routing.primary.baseUrl.trim() !== "" && routing.primary.model.trim() !== "";
  return (
    <div className="cc-panels">
      <PanelHeading eyebrow="MODEL ROUTING" title="One gateway. Zero-cost routes." description="Discover verified free models and keep your coding agent moving." action={<button type="button" className="ccp-button ccp-button--secondary" onClick={onSetup}><Settings2 size={15} />Set up companion</button>} />
      <section className="ccp-route-card ccp-auto-config"><div className="ccp-card-header"><div><Sparkles size={18} /><h2>Ready when you are.</h2></div><Toggle label="Configure routes automatically before each run" enabled={routing.autoConfigure !== false} onChange={() => onChange({ ...routing, autoConfigure: routing.autoConfigure === false })} /></div><p className="ccp-card-description">Discover installed models, repair missing model IDs, and verify routes before a run. Temporary provider failures get one retry; completed actions are preserved.</p><button className="ccp-button ccp-button--secondary" disabled={preparing || !connection.connected} onClick={() => autoConfigure()}>{preparing ? <LoaderCircle size={14} className="ccp-spin" /> : <Sparkles size={14} />}{preparing ? "Configuring…" : "Auto configure"}</button>{diagnostics.map((item, index) => <p className={item.ready ? "ccp-inline-note" : "ccp-error"} key={index}><strong>{item.baseUrl}</strong> · {item.message}</p>)}</section>
      <section className={`ccp-free-mode ${routing.freeOnly ? "is-protected" : ""}`}><div className="ccp-free-mode-icon"><ShieldCheck size={21} /></div><div><h2>Free models only<span>{routing.freeOnly ? "Protected" : "Off"}</span></h2><p>{routing.freeOnly ? "Only verified zero-cost models or local inference. Paid and unverified routes are blocked, including fallbacks." : "Provider-priced models are allowed. Usage charges depend on your provider account."}</p></div><Toggle label="Free models only" enabled={routing.freeOnly} onChange={() => onChange({ ...routing, freeOnly: !routing.freeOnly, primary: { ...routing.primary, model: !routing.freeOnly && routing.primary.model === "auto" ? "" : routing.primary.model } })} /></section>
      <section className="ccp-route-card ccp-omniroute-card">
        <div className="ccp-card-header">
          <div><Network size={18} /><h2>Connect your models</h2></div>
          <span className="ccp-pill"><span className={`ccp-dot ${isOmni && catalogSafeguards?.verified && selectedReady ? "" : isOmni ? "ccp-dot--amber" : "ccp-dot--neutral"}`} />{isOmni && catalogSafeguards?.verified && selectedReady ? "Ready to code" : isOmni ? "Setup in progress" : "OmniRoute"}</span>
        </div>
        <p className="ccp-card-description">Your gateway, your key, your models. Check each connection once and let the agent handle routing during a run.</p>
        <GatewayReadiness connected={connection.connected} hasKey={Boolean(omniKey.trim())} safeguards={isOmni ? gatewayResult || catalogSafeguards : null} modelReady={isOmni && selectedReady} model={routing.primary.model} />
        <div className="ccp-route-fields ccp-gateway-key-field">
          <label className="ccp-field ccp-field--wide"><span>OmniRoute gateway key <small>{omniKey.trim() ? "Saved on this device" : "Required to verify this gateway"}</small></span><span className="ccp-input-with-button"><input disabled={omniSettingUp || discovering || verifyingGateway} aria-label="OmniRoute API key" type={showOmniKey ? "text" : "password"} value={omniKey} placeholder="Paste the key from your OmniRoute dashboard" onChange={(e) => { setOmniKey(e.target.value); setOmniSuccessMessage(""); if (isOmni) onChange({ ...routing, primary: { ...routing.primary, apiKey: e.target.value } }); }} spellCheck={false} autoComplete="off" /><button type="button" aria-label={showOmniKey ? "Hide OmniRoute API key" : "Show OmniRoute API key"} onClick={() => setShowOmniKey(!showOmniKey)}>{showOmniKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
        </div>
        <GatewayKeyHelp />
        <div className="ccp-setup-router-actions">
          <button type="button" className="ccp-button ccp-button--primary" disabled={omniSettingUp || verifyingGateway || !connection.connected} onClick={() => setupOmniRoute()}>{omniSettingUp ? <LoaderCircle size={14} className="ccp-spin" /> : <Zap size={14} />}{omniSettingUp ? "Connecting and checking…" : "Connect & enable free routing"}</button>
          {isOmni ? <button type="button" className="ccp-button ccp-button--secondary" disabled={verifyingGateway || omniSettingUp || !connection.connected} onClick={() => verifyGateway()}>{verifyingGateway ? <LoaderCircle size={14} className="ccp-spin" /> : <ShieldCheck size={14} />}{verifyingGateway ? "Checking…" : "Verify gateway"}</button> : null}
          <a className="ccp-text-button" href="http://127.0.0.1:20128" target="_blank" rel="noreferrer">Open OmniRoute dashboard<ExternalLink size={13} /></a>
        </div>
        <p className="ccp-gateway-action-note">Connect disables OmniRoute’s Emergency Fallback for this gateway, including other clients. Verify only checks its current setting.</p>
        {!connection.connected ? <p className="ccp-gateway-next"><Fingerprint size={14} />Pair your local engine in setup to connect this gateway.</p> : null}
        {omniSuccessMessage ? <p className="ccp-inline-note" role="status"><CheckCircle2 size={13} />{omniSuccessMessage}</p> : null}
        {gatewayResult && !omniSuccessMessage ? <div className={`ccp-gateway-diagnostic ${gatewayResult.verified ? "is-ready" : ""}`} role="status"><ShieldCheck size={16} /><div><strong>{gatewayResult.verified ? "Gateway safeguard verified" : gatewayResult.code === "management_permission_required" ? "Model key accepted · one permission needed" : gatewayResult.code === "invalid_key" ? "Check your gateway key" : gatewayResult.code === "missing_key" ? "Add your gateway key" : "Free-only runs are waiting"}</strong><p>{gatewayResult.reason}</p></div></div> : null}
      </section>
      <div className="ccp-route-flow" aria-label={`Requests use your primary model${routing.autoFallback ? " and then configured fallback models" : " only"}`}><span><Code2 size={17} />Your agent</span><ArrowRight size={17} /><span className="is-gateway"><Network size={17} />OmniRoute</span><ArrowRight size={17} /><span><Sparkles size={17} />Primary model</span>{routing.autoFallback ? <><ArrowRight size={17} /><span className="is-fallback"><GitBranch size={16} />Fallbacks<span className="ccp-count">{routing.fallbacks.length}</span></span></> : null}</div>
      <div className="ccp-routing-columns"><div className="ccp-routing-main">
        <section className="ccp-route-card"><div className="ccp-card-header"><div><span className="ccp-step-badge">01</span><h2>Primary route</h2></div><span className="ccp-text-status"><span className={`ccp-dot ${configured && (!routing.freeOnly || selectedVerified) ? "" : "ccp-dot--neutral"}`} />{!configured ? "Select a model" : routing.freeOnly ? selectedVerified ? "Verified free" : gatewayBlocked ? "Gateway blocked" : "Verification pending" : "Configured"}</span></div><p className="ccp-card-description">Your agent’s first choice for every request.{isOmni ? " The gateway key above is used for this route." : " Connect your provider or gateway below."}</p><RouteFields route={routing.primary} label="Primary" disabled={discovering || omniSettingUp || verifyingGateway} hideKey={isOmni} onChange={(primary) => onChange({ ...routing, primary })} />
          <div className="ccp-model-catalog"><div className="ccp-catalog-header"><span><Sparkles size={14} />{routing.freeOnly ? "Verified free models" : "Available models"}</span><button type="button" className="ccp-button ccp-button--secondary" disabled={discovering || !routing.primary.baseUrl.trim()} onClick={discoverModels}>{discovering ? <LoaderCircle size={13} className="ccp-spin" /> : <RefreshCw size={13} />}{discovering ? "Discovering…" : "Discover models"}</button></div>
            {catalogError ? <div className="ccp-error" role="alert">{catalogError}</div> : null}{gatewayBlocked ? <div className="ccp-gateway-warning"><ShieldCheck size={13} /><span>{catalogSafeguards?.reason || "Verify the running gateway using the controls above. A restart is not required."}</span></div> : null}
            {catalogCurrent ? <><label className="ccp-catalog-search"><span className="ccp-sr-only">Search model catalog</span><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search model IDs…" spellCheck={false} /></label><div className="ccp-catalog-models">{visibleModels.map((model) => <button key={model.id} type="button" className={`ccp-catalog-model ${routing.primary.model === model.id ? "is-selected" : ""}`} disabled={gatewayBlocked || model.compatible === false || model.toolCalling === false || (routing.freeOnly && model.free !== true)} onClick={() => onChange({ ...routing, primary: { ...routing.primary, model: model.id } })}><span><code>{model.id}</code><small>{model.reason || (model.free ? "Verified zero-cost" : "Zero cost not verified")}</small></span><span className="ccp-model-price">{model.free ? "FREE" : "UNVERIFIED"}</span>{routing.primary.model === model.id ? <Check size={14} /> : <ArrowUpRight size={14} />}</button>)}</div>{!visibleModels.length ? <p className="ccp-catalog-empty">{modelSearch ? "No matching models in this catalog." : routing.freeOnly ? "No verified zero-cost models were returned. Connect a supported provider account or use installed local models." : "No models were returned by this endpoint."}</p> : null}<p className="ccp-catalog-note">{freeModels.length} verified free of {availableModels.length} discovered.{routing.freeOnly && availableModels.length > freeModels.length ? ` ${availableModels.length - freeModels.length} paid or unverified models hidden.` : ""} Availability and account limits can change.</p></> : <p className="ccp-catalog-empty">Discover the live catalog through your paired companion. Model pricing is checked again before a request; an unqualified “auto” route is never considered free.</p>}
          </div>
        </section>
        <section className="ccp-route-card"><div className="ccp-card-header"><div><span className="ccp-step-badge">02</span><h2>Instant fallback</h2></div><Toggle label="Automatic fallback" enabled={routing.autoFallback} onChange={() => onChange({ ...routing, autoFallback: !routing.autoFallback })} /></div><p className="ccp-card-description">Try the next route when a provider is unavailable, rate limited, or unable to respond. Fallback starts after the provider reports a failure.</p>
          {routing.fallbacks.length ? <div className={`ccp-fallback-list ${routing.autoFallback ? "" : "is-disabled"}`}>{routing.fallbacks.map((fallback, index) => <div className="ccp-fallback-item" key={index}><div className="ccp-fallback-header"><span><GitBranch size={14} />Fallback {index + 1}</span><button type="button" className="ccp-icon-button" aria-label={`Remove fallback ${index + 1}`} onClick={() => onChange({ ...routing, fallbacks: routing.fallbacks.filter((_, itemIndex) => index !== itemIndex) })}><Trash2 size={14} /></button></div><RouteFields route={fallback} label={`Fallback ${index + 1}`} onChange={(value) => onChange({ ...routing, fallbacks: routing.fallbacks.map((item, itemIndex) => itemIndex === index ? value : item) })} /></div>)}</div> : <div className="ccp-empty-fallback"><GitBranch size={20} /><span>A backup gives your agent somewhere to go.</span></div>}
          <button type="button" className="ccp-add-route" onClick={() => onChange({ ...routing, fallbacks: [...routing.fallbacks, { baseUrl: "http://127.0.0.1:11434/v1", model: "auto", apiKey: "" }] })}><Plus size={15} />Add fallback route</button>
          {routing.freeOnly ? <p className="ccp-inline-note"><ShieldCheck size={12} />Every fallback must also pass the zero-cost check. No paid route will be used.</p> : null}
          {!routing.autoFallback ? <p className="ccp-inline-note">Automatic fallback is off. Your primary route will handle requests on its own.</p> : null}
        </section>
      </div><aside className="ccp-routing-aside"><section className="ccp-free-card"><div className="ccp-aside-icon"><Zap size={21} /></div><span className="ccp-eyebrow">FREE BY DEFAULT</span><h2>Your code.<br />Your compute.</h2><p>Choose a verified free provider model, or connect Ollama to discover models already installed on your computer.</p><div style={{ display: "flex", flexDirection: "column", gap: 8 }}><button type="button" className="ccp-button ccp-button--primary" disabled={omniSettingUp || !connection.connected} onClick={() => setupOmniRoute()}><Zap size={15} />Connect OmniRoute<ArrowUpRight size={14} /></button><button type="button" className="ccp-button ccp-button--secondary" disabled={preparing || !connection.connected} onClick={() => autoConfigure(true)}><Laptop size={15} />Connect local Ollama<ArrowUpRight size={14} /></button></div><span className="ccp-helper-text">Local inference uses your hardware. Hosted models can require a provider account and have usage limits; your account does not guarantee free access.</span></section>
        <section className="ccp-health-card"><div className="ccp-health-heading"><Radio size={17} /><h3>Companion health</h3></div><p>Check the local service that connects your agents to your workspace.</p><code>{connection.baseUrl || "http://127.0.0.1:47821"}</code><button type="button" className="ccp-button ccp-button--secondary" disabled={checking} onClick={checkHealth}>{checking ? <LoaderCircle size={14} className="ccp-spin" /> : <RefreshCw size={14} />}{checking ? "Checking…" : "Check connection"}</button>{health ? <div className="ccp-health-result" role="status"><CheckCircle2 size={15} /><div>Companion reachable<span>Checked at {checkedAt} · v{health.version || "unknown"}</span><span>OmniRoute: {health.omniroute?.status === "running" ? "running" : "not confirmed"}</span></div></div> : null}{health?.omniroute?.status === "running" && health.omniroute.safeguards?.verified !== true ? <div className="ccp-gateway-warning"><ShieldCheck size={13} /><span>Use Verify gateway in Model routing to check the running gateway with your configured API key.</span></div> : null}{probeError ? <div className="ccp-error" role="alert">{probeError}</div> : null}{health && !connection.connected ? <button type="button" className="ccp-text-button" onClick={onSetup}>Pair this companion<ArrowRight size={13} /></button> : null}</section>
        <div className="ccp-local-note"><KeyRound size={15} /><p>Endpoint and model preferences are saved in this browser. Your local companion uses the configured API keys for requests.</p></div>
      </aside></div>
    </div>
  );
}

export function SettingsPanel({ connection, onConnectionChange, theme, onThemeChange, onSetup }: { connection: ConnectionConfig; onConnectionChange: (value: ConnectionConfig) => void; theme: string; onThemeChange: (value: string) => void; onSetup: () => void }) {
  const [showToken, setShowToken] = useState(false);
  const desktop = typeof window !== "undefined" && !!window.closedcodeDesktop;
  const themes = [{ id: "light", name: "Light", icon: Sun }, { id: "dark", name: "Dark", icon: Moon }, { id: "system", name: "System", icon: Monitor }];
  const connectionFields = <div className="ccp-connection-fields"><label className="ccp-field"><span>{desktop ? "Desktop engine URL" : "Companion URL"}</span><input type="url" readOnly={desktop} value={connection.baseUrl} onChange={(event) => onConnectionChange({ ...connection, baseUrl: event.target.value, connected: false })} placeholder="http://127.0.0.1:47821" spellCheck={false} /></label><label className="ccp-field"><span>{desktop ? "Engine authentication token" : "Pairing token"}</span><span className="ccp-input-with-button"><input type={showToken ? "text" : "password"} readOnly={desktop} value={connection.token} onChange={(event) => onConnectionChange({ ...connection, token: event.target.value, connected: false })} placeholder="Token from your companion terminal" autoComplete="off" spellCheck={false} /><button type="button" aria-label={showToken ? "Hide pairing token" : "Show pairing token"} onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label></div>;
  return <div className="cc-panels"><PanelHeading eyebrow="YOUR SPACE. YOUR PREFERENCES." title="A workspace that feels like you." description="A few thoughtful choices to make ClosedCode your own." />
    <div className="ccp-settings-grid"><section className="ccp-settings-card"><div className="ccp-settings-title"><Sun size={18} /><h2>Appearance</h2></div><p>Choose the light you like to work in.</p><div className="ccp-theme-options" role="group" aria-label="Color theme">{themes.map((option) => { const Icon = option.icon; return <button type="button" key={option.id} className={`ccp-theme-choice ${theme === option.id ? "is-selected" : ""}`} aria-pressed={theme === option.id} onClick={() => onThemeChange(option.id)}><span className={`ccp-theme-preview ccp-theme-preview--${option.id}`}><span /><span /><span /></span><span><Icon size={14} />{option.name}{theme === option.id ? <Check size={12} /> : null}</span></button>; })}</div></section>
      <section className="ccp-settings-card"><div className="ccp-settings-title"><Fingerprint size={18} /><h2>Local companion</h2><span className={`ccp-connection-label ${connection.connected ? "is-connected" : ""}`}><span className="ccp-dot" />{connection.connected ? "Paired" : "Not paired"}</span></div><p>{desktop ? "Your local engine starts automatically with the app." : "The bridge between your browser and your project."}</p>{desktop ? <details className="ccp-advanced-connection"><summary>Advanced connection details<ChevronDown size={12} /></summary>{connectionFields}</details> : connectionFields}<div className="ccp-workspace-setting"><FolderOpen size={15} /><div><span>Selected workspace</span><code>{connection.workspace || "No workspace selected"}</code></div></div><button type="button" className="ccp-button ccp-button--secondary" onClick={onSetup}><Settings2 size={14} />{desktop ? "Manage project" : connection.connected ? "Manage connection" : "Set up companion"}<ArrowRight size={14} /></button></section>
      <section className="ccp-settings-card ccp-about-card"><div className="ccp-about-mark">c<span>c</span><i /></div><div><div className="ccp-settings-title"><h2>ClosedCode</h2><span className="ccp-included">v0.4.1</span></div><p>An open source coding workspace.<br />Built for the things you want to build.</p></div><div className="ccp-about-facts"><span><Code2 size={14} />Open source</span><span><Laptop size={14} />Local companion</span><span><Network size={14} />OmniRoute support</span></div></section>
      <section className="ccp-settings-card ccp-privacy-card"><div className="ccp-settings-title"><ShieldCheck size={18} /><h2>Your workspace, thoughtfully connected.</h2></div><p>Your project files are accessed through a companion running on your computer. The model route you choose receives the context used for AI requests. This browser saves your preferences and connection settings.</p><div><span><Check size={13} />Choose your provider</span><span><Check size={13} />Choose your project</span><span><Check size={13} />Control editing with modes</span></div></section>
    </div>
  </div>;
}

export function SetupModal({ onClose, connection, onConnectionChange, freeOnly = true, routing, onRoutingChange }: { onClose: () => void; connection: ConnectionConfig; onConnectionChange: (value: ConnectionConfig) => void; freeOnly?: boolean; routing?: RoutingConfig; onRoutingChange?: (value: RoutingConfig) => void }) {
  const desktop = typeof window !== "undefined" && !!window.closedcodeDesktop;
  const [draft, setDraft] = useState(connection);
  const [busy, setBusy] = useState<"pair" | "workspace" | "omniroute" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paired, setPaired] = useState(connection.connected);
  const [workspaceSaved, setWorkspaceSaved] = useState(connection.connected && Boolean(connection.workspace));
  const [routerStatus, setRouterStatus] = useState("");
  const [dashboardUrl, setDashboardUrl] = useState("http://127.0.0.1:20128");
  const [safeguards, setSafeguards] = useState<GatewaySafeguards | null>(null);
  const [omniKey, setOmniKey] = useState(routing && isOmniRouteUrl(routing.primary.baseUrl) ? routing.primary.apiKey : "");
  const [showOmniKey, setShowOmniKey] = useState(false);
  const [omniConfigured, setOmniConfigured] = useState(false);
  const [omniSelectedModel, setOmniSelectedModel] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!draft.token) return;
    companionRequest<CompanionHealth>(draft, "/api/health").then((data) => {
      if (data.omniroute?.status === "running") {
        setRouterStatus("running");
        if (data.omniroute.dashboardUrl) setDashboardUrl(data.omniroute.dashboardUrl);
      }
    }).catch(() => {});
  }, [draft.baseUrl, draft.token]);

  useEffect(() => {
    if (!desktop || !window.closedcodeDesktop) return;
    let active = true;
    window.closedcodeDesktop.getConnection().then((value) => {
      if (!active) return;
      const next = { baseUrl: value.baseUrl, token: value.token, workspace: value.workspace, connected: true };
      setDraft(next); setPaired(true); onConnectionChange(next);
    }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "The desktop engine could not connect. Restart ClosedCode."); });
    return () => { active = false; };
  }, [desktop, onConnectionChange]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href], summary, [tabindex='0']")).filter((element) => element.offsetParent !== null);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, []);

  function editConnection(value: Partial<ConnectionConfig>) {
    setDraft((current) => ({ ...current, ...value, connected: false }));
    setPaired(false); setWorkspaceSaved(false); setRouterStatus(""); setSafeguards(null); setOmniConfigured(false); setNotice(""); setError("");
  }

  async function pair() {
    if (!draft.token.trim()) { setError("Copy the pairing token printed by your companion and paste it here."); return; }
    setBusy("pair"); setError(""); setNotice("");
    try {
      const data = await companionRequest<{ ok: boolean; workspace?: string }>(draft, "/api/pair", { method: "POST", body: { token: draft.token } });
      const next = { ...draft, connected: true, workspace: data.workspace || draft.workspace };
      setDraft(next); setPaired(true); onConnectionChange(next); setNotice("Companion paired. Your local workspace tools are ready.");
    } catch (failure) { setPaired(false); setError(failure instanceof Error ? failure.message : "Pairing failed."); onConnectionChange({ ...draft, connected: false }); }
    finally { setBusy(null); }
  }

  async function saveWorkspace() {
    const path = draft.workspace.trim();
    if (!path || !/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path)) { setError("Enter the full absolute path to your project folder, such as C:\\Projects\\my-app or /home/you/my-app."); return; }
    setBusy("workspace"); setError(""); setNotice("");
    try {
      const data = await companionRequest<{ ok: boolean; workspace: string }>(draft, "/api/workspace", { method: "POST", body: { path } });
      const next = { ...draft, connected: true, workspace: data.workspace || path };
      setDraft(next); setWorkspaceSaved(true); onConnectionChange(next); setNotice("Workspace selected. Your agent can now work inside this folder.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not select workspace."); }
    finally { setBusy(null); }
  }

  async function chooseDirectory() {
    if (!window.closedcodeDesktop) return;
    setBusy("workspace"); setError(""); setNotice("");
    try {
      const result = await window.closedcodeDesktop.chooseDirectory();
      if (result.cancelled || !result.workspace) return;
      const next = { ...draft, workspace: result.workspace, connected: true };
      setDraft(next); setPaired(true); setWorkspaceSaved(true); onConnectionChange(next);
      setNotice("Project selected. Your agents can now work inside this folder.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not choose a project folder."); }
    finally { setBusy(null); }
  }

  async function setupOmniRoute() {
    setBusy("omniroute"); setError(""); setNotice(""); setOmniConfigured(false); setSafeguards(null);
    const key = omniKey.trim();
    const targetRoute: ProviderRoute = {
      baseUrl: "http://127.0.0.1:20128/v1",
      model: routing && isOmniRouteUrl(routing.primary.baseUrl) ? routing.primary.model || "auto" : "auto",
      apiKey: key,
    };
    if (onRoutingChange && routing) onRoutingChange({ ...routing, primary: targetRoute });
    try {
      setNotice("Connecting to OmniRoute gateway…");
      const startRes = await companionRequest<{ ok: boolean; status: string; dashboardUrl?: string; safeguards?: GatewaySafeguards }>(
        draft,
        "/api/omniroute",
        { method: "POST", body: { apiKey: key, configure: false }, timeout: 35000 }
      );
      if (startRes.dashboardUrl) setDashboardUrl(startRes.dashboardUrl);
      let running = startRes.status === "running";
      if (!running) {
        setNotice("Starting OmniRoute gateway… please wait a few seconds.");
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1200));
          try {
            const health = await companionRequest<CompanionHealth>(draft, "/api/health", { timeout: 2500 });
            if (health.omniroute?.status === "running") {
              running = true;
              if (health.omniroute.dashboardUrl) setDashboardUrl(health.omniroute.dashboardUrl);
              break;
            }
          } catch {}
        }
      }
      if (!running) {
        setRouterStatus("starting");
        setNotice("OmniRoute startup requested. Open its dashboard once ready, then try connecting again.");
        return;
      }
      setRouterStatus("running");

      setNotice("Configuring gateway safeguards…");
      let safeResult: GatewaySafeguards | null = null;
      try {
        const safeData = await companionRequest<{ safeguards: GatewaySafeguards }>(
          draft,
          "/api/omniroute/safeguards",
          { method: "POST", body: { route: targetRoute, configure: true }, timeout: 15000 }
        );
        safeResult = safeData.safeguards;
        setSafeguards(safeData.safeguards);
      } catch (safeErr) {
        const msg = safeErr instanceof Error ? safeErr.message : "Gateway verification failed.";
        setNotice(""); setError(msg);
        return;
      }
      if (!safeResult?.verified) {
        setNotice(""); setError(safeResult?.reason || "OmniRoute safeguards could not be verified.");
        return;
      }

      setNotice("Discovering models…");
      const catalogData = await companionRequest<{ models: DiscoveredModel[] }>(draft, "/api/models", { method: "POST", body: { route: targetRoute, refresh: true }, timeout: 25000 });
      const selected = eligibleModel(Array.isArray(catalogData.models) ? catalogData.models : [], freeOnly, targetRoute.model);
      const chosenModel = selected?.id || "auto";

      if (onRoutingChange && routing) {
        onRoutingChange({ ...routing, primary: { ...targetRoute, model: chosenModel } });
      }
      setOmniSelectedModel(chosenModel);
      setOmniConfigured(Boolean(selected));
      setNotice(selected
        ? `Ready to code with ${chosenModel}. The gateway and selected model are verified.`
        : `Gateway verified. No compatible ${freeOnly ? "zero-cost " : ""}coding model was returned. Connect one in the OmniRoute dashboard, then check again.`
      );
    } catch (failure) {
      setNotice("");
      setError(failure instanceof Error ? failure.message : "OmniRoute setup could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  async function copyCommand() {
    try { await navigator.clipboard.writeText("npm run companion"); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError("Clipboard access is unavailable. Select and copy the command from the code block."); }
  }

  return <div className="ccp-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="cc-panels ccp-setup-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="ccp-setup-title" aria-describedby="ccp-setup-description"><button className="ccp-modal-close ccp-icon-button" type="button" aria-label="Close setup" onClick={onClose}><X size={20} /></button>
    <div className="ccp-setup-intro"><div className="ccp-setup-symbol"><Fingerprint size={28} strokeWidth={1.5} /></div><span className="ccp-eyebrow">A FEW STEPS. THEN YOU’RE OFF.</span><h1 id="ccp-setup-title">Bring your workspace to life.</h1><p id="ccp-setup-description">{desktop ? "Your local engine is built in. Choose a project folder and connect your models with OmniRoute." : "Pair a local companion, choose a project, and connect your models with OmniRoute."}</p></div><div className="ccp-setup-cost-note"><ShieldCheck size={16} /><div><strong>{freeOnly ? "Free models only is enabled" : "Provider-priced routes are enabled"}</strong><p>{freeOnly ? "Select a verified zero-cost model in Routing. Unknown pricing and paid fallbacks are blocked." : "Your selected provider may charge for usage. Enable Free models only in Routing to block paid and unverified models."}</p></div></div>
    <div className="ccp-setup-steps">{!desktop ? <section className={`ccp-setup-step ${paired ? "is-complete" : ""}`}><span className="ccp-setup-number">{paired ? <Check size={14} /> : "1"}</span><div className="ccp-setup-step-content"><h2>Start your companion</h2><p>From the ClosedCode source folder, run this command. Keep the terminal open and copy the pairing token it prints.</p><div className="ccp-command"><Terminal size={14} /><code>npm run companion</code><button type="button" aria-label="Copy companion command" onClick={copyCommand}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div><form onSubmit={(event) => { event.preventDefault(); void pair(); }}><label className="ccp-field"><span>Companion URL</span><input type="url" required disabled={busy !== null} value={draft.baseUrl} placeholder="http://127.0.0.1:47821" onChange={(event) => editConnection({ baseUrl: event.target.value })} spellCheck={false} /></label><label className="ccp-field"><span>Pairing token</span><span className="ccp-input-with-button"><input type={showToken ? "text" : "password"} required disabled={busy !== null} value={draft.token} placeholder="Paste the token from your terminal" onChange={(event) => editConnection({ token: event.target.value })} autoComplete="off" spellCheck={false} /><button type="button" aria-label={showToken ? "Hide pairing token" : "Show pairing token"} onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label><button type="submit" className="ccp-button ccp-button--primary" disabled={busy !== null}>{busy === "pair" ? <LoaderCircle size={14} className="ccp-spin" /> : paired ? <Check size={14} /> : <Fingerprint size={14} />}{busy === "pair" ? "Pairing…" : paired ? "Paired · check again" : "Pair companion"}<ArrowRight size={14} /></button></form></div></section> : <div className="ccp-desktop-engine-state"><span className={`ccp-dot ${paired ? "" : "ccp-dot--neutral"}`} /><span>{paired ? "Built-in local engine connected" : "Connecting to your built-in local engine…"}</span></div>}
      <section className={`ccp-setup-step ${workspaceSaved ? "is-complete" : ""}`}><span className="ccp-setup-number">{workspaceSaved ? <Check size={14} /> : desktop ? "1" : "2"}</span><div className="ccp-setup-step-content"><h2>Choose your project</h2><p>{desktop ? "Browse to the folder you want your agents to work in." : "Enter the full path to an existing folder on the computer running your companion."}</p>{desktop ? <><button className="ccp-button ccp-button--primary ccp-native-folder-button" type="button" onClick={chooseDirectory} disabled={!paired || busy !== null}>{busy === "workspace" ? <LoaderCircle className="ccp-spin" size={14} /> : <FolderOpen size={14} />}Choose project folder<ArrowRight size={14} /></button>{draft.workspace ? <div className="ccp-selected-project-path"><FolderOpen size={13} /><code>{draft.workspace}</code></div> : null}</> : null}{desktop ? <details className="ccp-advanced-connection"><summary>Enter a path manually<ChevronDown size={12} /></summary><form onSubmit={(event) => { event.preventDefault(); void saveWorkspace(); }}><label className="ccp-field"><span>Absolute project path</span><input value={draft.workspace} required disabled={busy !== null} placeholder="C:\Projects\my-app or /home/you/my-app" onChange={(event) => { setDraft({ ...draft, workspace: event.target.value }); setWorkspaceSaved(false); }} spellCheck={false} /></label><button type="submit" className="ccp-button ccp-button--secondary" disabled={!paired || busy !== null}>{busy === "workspace" ? <LoaderCircle size={14} className="ccp-spin" /> : <FolderOpen size={14} />}{busy === "workspace" ? "Selecting…" : workspaceSaved ? "Workspace selected" : "Select workspace"}</button></form></details> : <form onSubmit={(event) => { event.preventDefault(); void saveWorkspace(); }}><label className="ccp-field"><span>Absolute project path</span><input value={draft.workspace} required disabled={busy !== null} placeholder="C:\Projects\my-app or /home/you/my-app" onChange={(event) => { setDraft({ ...draft, workspace: event.target.value }); setWorkspaceSaved(false); }} spellCheck={false} /></label><button type="submit" className="ccp-button ccp-button--secondary" disabled={!paired || busy !== null}>{busy === "workspace" ? <LoaderCircle size={14} className="ccp-spin" /> : <FolderOpen size={14} />}{busy === "workspace" ? "Selecting…" : workspaceSaved ? "Workspace selected" : "Select workspace"}</button></form>}</div></section>
      <section className={`ccp-setup-step ${omniConfigured ? "is-complete" : ""}`}>
        <span className="ccp-setup-number">{omniConfigured ? <Check size={14} /> : desktop ? "2" : "3"}</span>
        <div className="ccp-setup-step-content">
          <h2>Connect your coding models</h2>
          <p>Use a dedicated OmniRoute gateway key. We will verify the live fallback policy and choose a compatible {freeOnly ? "zero-cost " : ""}model.</p>
          <GatewayReadiness connected={paired} hasKey={Boolean(omniKey.trim())} safeguards={safeguards} modelReady={omniConfigured} model={omniSelectedModel} />
          <label className="ccp-field ccp-gateway-key-field"><span>OmniRoute gateway key <small>Manage permission is needed for safeguard verification</small></span><span className="ccp-input-with-button"><input aria-label="Setup OmniRoute API key" type={showOmniKey ? "text" : "password"} value={omniKey} disabled={busy !== null} placeholder="Paste the key from your OmniRoute dashboard" onChange={(e) => { setOmniKey(e.target.value); setSafeguards(null); setOmniConfigured(false); setError(""); setNotice(""); }} spellCheck={false} autoComplete="off" /><button type="button" aria-label={showOmniKey ? "Hide setup OmniRoute API key" : "Show setup OmniRoute API key"} onClick={() => setShowOmniKey(!showOmniKey)}>{showOmniKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
          <GatewayKeyHelp />
          <div className="ccp-setup-router-actions"><button type="button" className="ccp-button ccp-button--primary" onClick={setupOmniRoute} disabled={!paired || busy !== null}>{busy === "omniroute" ? <LoaderCircle size={14} className="ccp-spin" /> : <Zap size={14} />}{busy === "omniroute" ? "Connecting and checking…" : omniConfigured ? "Check connection again" : "Connect & enable free routing"}</button>{dashboardUrl ? <a className="ccp-text-button" href={dashboardUrl} target="_blank" rel="noreferrer">Open dashboard<ExternalLink size={13} /></a> : null}</div>
          <p className="ccp-gateway-action-note">Connect disables OmniRoute’s Emergency Fallback for this gateway, including other clients.</p>
          {routerStatus ? <span className="ccp-router-state"><span className={`ccp-dot ${routerStatus === "running" ? "" : "ccp-dot--amber"}`} />{routerStatus === "running" ? "Gateway running at 127.0.0.1:20128" : "Gateway starting · check again when ready"}</span> : null}
        </div>
      </section></div>
    <div className="ccp-setup-feedback" aria-live="polite">{error ? <div className="ccp-error" role="alert">{error}</div> : null}{notice ? <div className="ccp-success"><CheckCircle2 size={16} /><span>{notice}</span></div> : null}</div><div className="ccp-setup-footer"><span><ShieldCheck size={14} />Runs on your computer. Built for your projects.</span><button type="button" className={`ccp-button ${paired ? "ccp-button--primary" : "ccp-button--secondary"}`} onClick={onClose}>{paired ? "Back to workspace" : "Set up later"}<ArrowRight size={14} /></button></div>
  </div></div>;
}
