"use client";

import { useRef, useState, type FormEvent } from "react";
import { Dialog } from "radix-ui";
import { ArrowUpRight, Check, Copy, LoaderCircle, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { AgentAvatar } from "./panels";
import { GlassPicker } from "./glass-picker";
import { AGENT_COLORS, MAX_CUSTOM_AGENTS, validateAgentProfile, type AgentProfile } from "@/lib/agent-profiles.mjs";
import "./custom-agents.css";

const COLORS = { sage: "Sage green", violet: "Soft violet", amber: "Warm amber", blue: "Orbit blue" };
function freshAgent(): AgentProfile { return { id: `custom_${crypto.randomUUID()}`, name: "", role: "Custom coding partner", color: "violet", personality: "", description: "", guidance: "", updatedAt: new Date().toISOString() }; }

export function CustomAgents({ agents, selected, onSelect, onSave, onDelete }: { agents: AgentProfile[]; selected: string; onSelect: (id: string) => void; onSave: (profile: AgentProfile) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [draft, setDraft] = useState<AgentProfile | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [removing, setRemoving] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  function edit(profile?: AgentProfile) { returnFocus.current = document.activeElement as HTMLElement | null; setError(""); setDraft(profile ? { ...profile } : freshAgent()); }
  function duplicate(profile: AgentProfile) {
    let count = 1, name = `${profile.name.slice(0, 48)} copy`;
    while (agents.some((agent) => agent.name.toLowerCase() === name.toLowerCase())) name = `${profile.name.slice(0, 48)} copy ${++count}`;
    edit({ ...profile, id: `custom_${crypto.randomUUID()}`, name, updatedAt: new Date().toISOString() });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft) return; setBusy(true); setError("");
    try { const profile = validateAgentProfile({ ...draft, updatedAt: new Date().toISOString() }); if (agents.some((agent) => agent.id !== profile.id && agent.name.toLowerCase() === profile.name.toLowerCase())) throw new Error("Another agent already has this name."); await onSave(profile); setDraft(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save agent."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setError("");
    try { await onDelete(id); setRemoving(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete agent."); }
    finally { setBusy(false); }
  }
  return <section className="cc-custom-agents">
    <div className="ccp-section-line"><span>YOUR CUSTOM AGENTS</span><button type="button" className="ccp-button ccp-button--secondary" disabled={agents.length >= MAX_CUSTOM_AGENTS} onClick={() => edit()}><Plus size={14} />Create agent</button></div>
    {error && !draft ? <div className="ccp-error" role="alert">{error}</div> : null}
    {!agents.length ? <div className="cc-custom-empty"><span className="cc-custom-orb"><Sparkles size={25} /></span><div><h2>A personality of your own.</h2><p>Create a teammate with its own name, point of view, and instructions. A meticulous tester. A patient teacher. Whatever your project needs.</p><button className="ccp-text-button" type="button" onClick={() => edit()}>Create your first agent<ArrowUpRight size={13} /></button></div></div> : <div className="ccp-agents-grid">{agents.map((agent) => <article className={`ccp-agent-card cc-custom-card ${selected === agent.id ? "is-selected" : ""}`} key={agent.id}><div className="ccp-agent-top"><AgentAvatar agent={agent.id} color={agent.color} /><span className="ccp-pill">Custom</span></div><div className="ccp-agent-name"><h2>{agent.name}</h2><span>{agent.role}</span></div><p className="ccp-personality">{agent.personality || "Your own point of view."}</p><p className="ccp-agent-description">{agent.description || agent.guidance.slice(0, 150)}</p><button className={`ccp-button ccp-agent-select ${selected === agent.id ? "ccp-button--selected" : "ccp-button--secondary"}`} type="button" onClick={() => onSelect(agent.id)}>{selected === agent.id ? <><Check size={14} />Your active agent</> : <>Work with {agent.name}<ArrowUpRight size={14} /></>}</button><div className="cc-custom-actions"><button type="button" className="ccp-text-button" onClick={() => edit(agent)}><Pencil size={12} />Edit</button><button type="button" className="ccp-icon-button" aria-label={`Duplicate ${agent.name}`} disabled={agents.length >= MAX_CUSTOM_AGENTS} onClick={() => duplicate(agent)}><Copy size={13} /></button><button type="button" className="ccp-icon-button" aria-label={`Delete ${agent.name}`} onClick={() => setRemoving(agent.id)}><Trash2 size={13} /></button></div>{removing === agent.id ? <div className="cc-custom-delete"><p>Delete this profile? Previous conversations stay in your history.</p><button className="ccp-text-button" disabled={busy} onClick={() => remove(agent.id)}>Delete agent</button><button className="ccp-text-button" disabled={busy} onClick={() => setRemoving(null)}>Keep agent</button></div> : null}</article>)}</div>}
    <p className="ccp-helper-text cc-custom-storage">{agents.length}/{MAX_CUSTOM_AGENTS} custom agents · Stored on this device; syncs with your paired local engine.</p>
    <Dialog.Root open={!!draft} onOpenChange={(open) => { if (!open && !busy) setDraft(null); }}>
      <Dialog.Portal container={typeof document !== "undefined" ? document.querySelector<HTMLElement>(".closedcode") : undefined}>
        <Dialog.Overlay className="cc-agent-editor-overlay" />
        <Dialog.Content className="cc-agent-editor cc-panels" onCloseAutoFocus={(event) => { event.preventDefault(); const target = returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLElement>(".cc-custom-agents button:not(:disabled)"); target?.focus(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
          <div className="cc-agent-editor-heading"><div><span className="ccp-eyebrow">A NEW PERSPECTIVE</span><Dialog.Title>{draft && agents.some((agent) => agent.id === draft.id) ? "Shape your agent." : "Meet your next teammate."}</Dialog.Title><Dialog.Description>Give your agent a name, a personality, and a clear way to work.</Dialog.Description></div><Dialog.Close className="ccp-icon-button" aria-label="Close agent editor" disabled={busy}><X size={19} /></Dialog.Close></div>
          {draft ? <form onSubmit={save}><div className="cc-agent-editor-preview"><AgentAvatar agent={draft.id} color={draft.color} /><div><strong>{draft.name || "Your new agent"}</strong><span>{draft.role || "Custom coding partner"}</span></div><span className="ccp-pill">Yours to shape</span></div><div className="cc-agent-editor-fields"><label className="ccp-field"><span>Name</span><input autoFocus required maxLength={60} placeholder="e.g. Lyra" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="ccp-field"><span>Role</span><input maxLength={100} placeholder="e.g. The test engineer" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></label><label className="ccp-field cc-agent-editor-wide"><span>Personality</span><input maxLength={1000} placeholder="Methodical, encouraging, and curious about edge cases." value={draft.personality} onChange={(event) => setDraft({ ...draft, personality: event.target.value })} /></label><label className="ccp-field cc-agent-editor-wide"><span>Short description <small>optional</small></span><input maxLength={500} placeholder="Helps you ship with confidence by finding the tests that matter." value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><div className="ccp-field cc-agent-editor-wide"><span>Agent color</span><GlassPicker label="Choose agent color" value={draft.color} options={AGENT_COLORS.map((color) => ({ value: color, label: COLORS[color], icon: <span className={`cc-color-swatch cc-color-${color}`} /> }))} onChange={(color) => setDraft({ ...draft, color: color as AgentProfile["color"] })} trigger={<><span className={`cc-color-swatch cc-color-${draft.color}`} />{COLORS[draft.color]}</>} className="cc-color-trigger" searchable={false} /></div><label className="ccp-field cc-agent-editor-wide"><span>Instructions <small>{draft.guidance.length.toLocaleString()}/8,000</small></span><textarea required maxLength={8000} rows={6} placeholder="Explain how this agent should investigate, reason, write code, and report results…" value={draft.guidance} onChange={(event) => setDraft({ ...draft, guidance: event.target.value })} /></label></div><p className="ccp-helper-text">These instructions are sent to your selected model. Build and Plan permissions, free-only routing, and tool approvals still apply.</p>{error ? <div className="ccp-error" role="alert">{error}</div> : null}<div className="cc-agent-editor-footer"><Dialog.Close className="ccp-button ccp-button--secondary" disabled={busy}>Cancel</Dialog.Close><button className="ccp-button ccp-button--primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={14} className="ccp-spin" /> : <Check size={14} />}Save agent</button></div></form> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
