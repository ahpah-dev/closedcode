"use client";

import { useCallback, useEffect, useState } from "react";
import { Blocks, LoaderCircle, Plus, RefreshCw, Trash2, Unplug } from "lucide-react";
import { companionRequest, type ConnectionConfig } from "./panels";

type Server = { id: string; name: string; transport: string; command?: string; args?: string[]; url?: string; enabled: boolean; status: string; tools: { name: string; description: string }[]; error?: string; envKeys: string[]; headerNames: string[] };
const INITIAL = JSON.stringify({ name: "My MCP server", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/absolute/path/to/project"] }, null, 2);

export function McpPanel({ connection, enabled }: { connection: ConnectionConfig; enabled: boolean }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [config, setConfig] = useState(INITIAL);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const result = await companionRequest<{ servers: Server[] }>(connection, "/api/mcp/servers");
    setServers(result.servers);
  }, [connection]);
  useEffect(() => { let active = true; if (connection.connected) refresh().catch((e: Error) => { if (active) setError(e.message); }); return () => { active = false; }; }, [connection.connected, refresh]);
  async function action(id: string, operation: "connect" | "disconnect" | "delete" | "toggle") {
    setBusy(id); setError("");
    try {
      const server = servers.find((item) => item.id === id);
      await companionRequest(connection, `/api/mcp/servers/${id}${operation === "connect" || operation === "disconnect" ? `/${operation}` : ""}`, {
        method: operation === "delete" ? "DELETE" : operation === "toggle" ? "PATCH" : "POST",
        ...(operation !== "delete" ? { body: operation === "toggle" ? { enabled: !server?.enabled } : {} } : {}), timeout: 60000,
      });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "MCP operation failed."); await refresh().catch(() => {}); }
    finally { setBusy(""); }
  }
  async function add() {
    setBusy("add"); setError("");
    try {
      const input: unknown = JSON.parse(config);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Enter one MCP server configuration object.");
      await companionRequest(connection, "/api/mcp/servers", { method: "POST", body: input });
      setEditing(false); setConfig(INITIAL); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save MCP server."); }
    finally { setBusy(""); }
  }
  return <section className="ccp-mcp-section">
    <div className="ccp-section-line"><span>MCP CONNECTIONS</span><button className="ccp-text-button" disabled={!connection.connected || !!busy} onClick={() => { setEditing(!editing); setError(""); }}><Plus size={14} />Add server</button></div>
    <div className="ccp-subtle-note"><Blocks size={18} /><p>Connect local command servers or Streamable HTTP endpoints. Build mode asks you before each external tool call. Servers can access resources beyond your project; connect servers you trust.</p></div>
    {!connection.connected ? <p className="ccp-catalog-empty">Connect your project to configure MCP servers.</p> : null}
    {!enabled ? <p className="ccp-inline-note">Enable the MCP plugin above to make connected tools available to your agent.</p> : null}
    {error ? <div className="ccp-error" role="alert">{error}</div> : null}
    {editing ? <div className="ccp-route-card"><h2>Add an MCP server</h2><p className="ccp-card-description">Save a configuration, then review and connect it. Saving does not start a process. Replace the example folder with your project path.</p><label className="ccp-field"><span>Server configuration (JSON)</span><textarea className="ccp-mcp-json" aria-label="MCP server configuration" value={config} onChange={(event) => setConfig(event.target.value)} spellCheck={false} /></label><p className="ccp-helper-text">Local: command, args, optional env. HTTP: transport: &quot;http&quot;, url, optional headers with Authorization. Credentials stay in the private local engine configuration and are hidden after saving.</p><div className="ccp-mcp-actions"><button className="ccp-button ccp-button--secondary" disabled={!!busy} onClick={add}>{busy === "add" ? <LoaderCircle size={14} className="ccp-spin" /> : <Plus size={14} />}Save server</button><button className="ccp-text-button" onClick={() => setEditing(false)}>Cancel</button><button className="ccp-text-button" onClick={() => setConfig(JSON.stringify({ name: "Remote MCP", transport: "http", url: "https://your-server.example/mcp", headers: { Authorization: "Bearer YOUR_TOKEN" } }, null, 2))}>HTTP example</button></div></div> : null}
    <div className="ccp-mcp-list">{servers.map((server) => <article className="ccp-route-card" key={server.id}><div className="ccp-card-header"><div><Blocks size={18} /><h2>{server.name}</h2></div><span className="ccp-pill"><span className={`ccp-dot ${server.status === "connected" ? "" : "ccp-dot--neutral"}`} />{server.enabled ? server.status : "disabled"}</span></div><code className="ccp-mcp-address">{server.url || `${server.command} ${(server.args || []).map((arg) => JSON.stringify(arg)).join(" ")}`}</code><p className="ccp-helper-text">{server.transport === "http" ? "Streamable HTTP" : "Local process"} · {server.tools.length} tools{server.envKeys.length + server.headerNames.length ? " · private credentials configured" : ""}</p>{server.error ? <div className="ccp-error">{server.error}</div> : null}{server.tools.length ? <details><summary>Available tools</summary><ul className="ccp-mcp-tools">{server.tools.map((tool) => <li key={tool.name}><code>{tool.name}</code><span>{tool.description}</span></li>)}</ul></details> : null}<div className="ccp-mcp-actions"><button className="ccp-button ccp-button--secondary" disabled={!!busy || !server.enabled} onClick={() => action(server.id, server.status === "connected" ? "disconnect" : "connect")}>{busy === server.id ? <LoaderCircle className="ccp-spin" size={14} /> : server.status === "connected" ? <Unplug size={14} /> : <RefreshCw size={14} />}{server.status === "connected" ? "Disconnect" : "Connect server"}</button><button className="ccp-text-button" disabled={!!busy} onClick={() => action(server.id, "toggle")}>{server.enabled ? "Disable" : "Enable"}</button><button className="ccp-icon-button" aria-label={`Delete ${server.name}`} disabled={!!busy} onClick={() => action(server.id, "delete")}><Trash2 size={14} /></button></div></article>)}</div>
    {connection.connected && !servers.length && !editing ? <p className="ccp-catalog-empty">Your tools, connected. Add your first MCP server to get started.</p> : null}
  </section>;
}
