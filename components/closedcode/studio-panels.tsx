'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, ChevronDown, Circle, CircleAlert, Clock3, Code2, Copy, ExternalLink, FileCode2, FilePenLine, GitCompareArrows, Globe2, LoaderCircle, NotebookPen, RotateCcw, ScanLine, Terminal, Workflow } from 'lucide-react';
import { PAD_LIMIT, projectPadKey, summarizeRun, type StudioAgentEvent, type StudioToolEvent } from '@/lib/studio.mjs';
import { localPreviewUrl } from '@/lib/preview-url.mjs';
import './studio-panels.css';

export type { StudioAgentEvent } from '@/lib/studio.mjs';
export type StudioChangedFile = { path: string; status: 'added' | 'modified' | 'deleted'; additions?: number; deletions?: number; diff?: string; reviewable?: boolean; reason?: string };
export type StudioChangeReview = { runId: string; state: 'pending' | 'kept' | 'undone' | 'conflict'; files: StudioChangedFile[]; summary?: string; conflicts?: string[] };
type SaveState = 'saved' | 'saving' | 'error';

const TOOL_LABELS: Record<string, string> = { read_file: 'Read file', list_files: 'Explore project', write_file: 'Update file', git_diff: 'Inspect changes', run_command: 'Run command', delegate: 'Ask a subagent' };
const asObject = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const displayValue = (value: unknown, limit = 18_000) => {
  if (value === undefined || value === null) return '';
  try { const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); return text.length > limit ? `${text.slice(0, limit)}\n… Output display truncated.` : text; } catch { return 'Output is unavailable.'; }
};

function ToolLogItem({ event }: { event: StudioToolEvent }) {
  const args = asObject(event.args), result = asObject(event.result);
  const commandFailed = event.name === 'run_command' && event.state === 'complete' && (result.exitCode !== 0 || result.timedOut === true || result.truncated === true);
  const failed = event.state === 'error' || commandFailed;
  const active = event.state === 'running';
  const waiting = event.state === 'waiting', stopped = event.state === 'stopped';
  const path = typeof args.path === 'string' ? args.path : typeof result.path === 'string' ? result.path : '';
  const title = TOOL_LABELS[event.name || ''] || event.tool || (event.name?.startsWith('mcp_') ? 'Call external tool' : event.name) || 'Agent tool';
  let description = path || (event.name === 'delegate' ? String(args.agent || 'Read-only review') : event.subagent ? `Working with ${event.subagent}` : '');
  if (event.name === 'run_command') {
    const program = args.program || result.program || '';
    const argv = Array.isArray(args.args) ? args.args : Array.isArray(result.args) ? result.args : [];
    description = `${program} ${argv.map(String).join(' ')}`.trim();
  }
  const details = event.error || (event.name === 'run_command' ? [result.stdout, result.stderr].filter(Boolean).join('\n') : event.result);
  return <li className={`ccs-tool ${active ? 'is-active' : ''} ${failed ? 'is-error' : ''}`}>
    <span className="ccs-tool-mark" aria-hidden="true">{active ? <LoaderCircle className="ccs-spin" size={13}/> : failed ? <CircleAlert size={13}/> : waiting || stopped ? <Clock3 size={13}/> : <Check size={13}/>}</span>
    <div className="ccs-tool-body"><div className="ccs-tool-title"><strong>{title}</strong><span>{active ? 'In progress' : waiting ? 'Awaiting approval' : stopped ? 'Stopped' : failed ? 'Needs attention' : event.state === 'complete' ? 'Done' : event.state || 'Update'}</span></div>
      {description ? <p title={description}>{description}</p> : null}
      {event.subagent ? <span className="ccs-subagent">{event.subagent}</span> : null}
      {event.name === 'run_command' && event.state === 'complete' ? <span className={`ccs-exit-code ${commandFailed ? 'is-error' : ''}`}>{result.timedOut ? 'Timed out' : result.truncated ? 'Output limit reached' : typeof result.exitCode === 'number' ? `Exit code ${result.exitCode}` : 'Process ended'}</span> : null}
      {details ? <details className="ccs-output"><summary>{event.name === 'run_command' ? 'Command output' : event.error ? 'Error details' : 'Tool result'}<ChevronDown size={11}/></summary><pre>{displayValue(details)}</pre></details> : null}
    </div>
  </li>;
}

export function TaskProgressPanel({ events, running, waitingForApproval = false, status = '', agentName = 'Your agent' }: { events: StudioAgentEvent[]; running: boolean; waitingForApproval?: boolean; status?: string; agentName?: string }) {
  const [expanded, setExpanded] = useState(false);
  const run = summarizeRun(events, running, waitingForApproval);
  const lastStatus = [...events].reverse().find((event) => event.type === 'status')?.text;
  const labels = { idle: 'Ready for your next idea', working: `${agentName} is working`, waiting: 'Your approval is needed', stopped: 'Run stopped', error: 'Let’s get this back on track', complete: 'Ready for your review' };
  const detail = run.state === 'waiting' ? 'Review the requested command or external tool in the conversation to continue.' : run.state === 'error' || run.state === 'stopped' ? run.error : run.state === 'complete' ? 'Review the response, actual file changes, and command output before continuing.' : status || lastStatus || 'Describe what you want to make. Your agent’s work will appear here.';
  const visibleTools = expanded ? run.tools : run.tools.slice(-7);
  const recentFallback = [...events].reverse().find((event) => event.type === 'fallback');
  return <section className={`cc-studio ccs-progress is-${run.state}`} aria-label="Task progress">
    <div className="ccs-panel-heading"><span className="ccs-eyebrow"><ScanLine size={12}/>LIVE WORKSPACE</span><span className={`ccs-state-dot ${run.state}`} aria-label={run.state}/></div>
    <div className="ccs-progress-intro"><span className={`ccs-orb ${running ? 'is-working' : ''}`} aria-hidden="true">{run.state === 'complete' ? <Check size={20}/> : run.state === 'waiting' ? <Clock3 size={20}/> : run.state === 'error' ? <CircleAlert size={20}/> : <Code2 size={20}/>}</span><h3 aria-live="polite">{labels[run.state]}</h3><p>{detail}</p></div>
    <div className="ccs-progress-stats" aria-label="Observed activity"><div><ScanLine size={13}/><strong>{run.reads}</strong><span>Reads</span></div><div><FilePenLine size={13}/><strong>{run.writes}</strong><span>Edits</span></div><div><Terminal size={13}/><strong>{run.commands}</strong><span>Commands</span></div></div>
    {recentFallback ? <div className="ccs-route-note"><Workflow size={12}/><span>Route switched{recentFallback.model ? ` to ${recentFallback.model}` : ''}<small>{recentFallback.reason || 'The next configured route was selected.'}</small></span></div> : null}
    {run.tools.length ? <><div className="ccs-section-heading"><span>WORK LOG</span><span>{run.tools.length} {run.tools.length === 1 ? 'tool call' : 'tool calls'}</span></div><ol className="ccs-tool-log">{visibleTools.map((event) => <ToolLogItem key={event.key} event={event}/>)}</ol>{run.tools.length > 7 ? <button className="ccs-text-button ccs-expand" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show recent activity' : `Show all ${run.tools.length} tool calls`}<ChevronDown size={12} className={expanded ? 'is-reversed' : ''}/></button> : null}</> : <div className="ccs-quiet-note"><Circle size={9}/>Your agent’s work will appear here.</div>}
    {run.commands ? <p className="ccs-footnote">{run.successfulCommands} {run.successfulCommands === 1 ? 'command exited' : 'commands exited'} with code 0. Open output to inspect what ran.</p> : null}
  </section>;
}

export function ChangeReviewPanel({ review, loading = false, running = false, busy = null, error = '', onRefresh, onKeep, onUndo, onOpenFile }: { review: StudioChangeReview | null; loading?: boolean; running?: boolean; busy?: 'keep' | 'undo' | null; error?: string; onRefresh: () => void; onKeep: () => void | Promise<void>; onUndo: () => void | Promise<void>; onOpenFile?: (path: string) => void }) {
  const [confirmUndo, setConfirmUndo] = useState(false);
  const disabled = loading || running || !!busy;
  const pending = review?.state === 'pending';
  const additions = review?.files.reduce((sum, file) => sum + (file.additions || 0), 0) || 0;
  const deletions = review?.files.reduce((sum, file) => sum + (file.deletions || 0), 0) || 0;
  const allReviewable = !!review?.files.length && review.files.every((file) => file.reviewable !== false);
  useEffect(() => { setConfirmUndo(false); }, [review?.runId, review?.state]);
  return <section className="cc-studio ccs-review" aria-label="Review file changes">
    <div className="ccs-panel-heading"><span className="ccs-eyebrow"><GitCompareArrows size={12}/>CHANGE REVIEW</span><button className="ccs-icon-button" aria-label="Refresh changes" disabled={disabled} onClick={onRefresh}><RotateCcw size={13} className={loading ? 'ccs-spin' : ''}/></button></div>
    {loading && !review ? <div className="ccs-empty"><LoaderCircle className="ccs-spin" size={23}/><h3>Reading your changes</h3><p>Comparing direct agent file edits with their saved checkpoint.</p></div> : !review || !review.files.length ? <div className="ccs-empty"><GitCompareArrows size={25}/><h3>A clear view of your edits.</h3><p>Direct file edits from your agent appear here for review. Changes made by commands or MCP tools are excluded.</p><span className="ccs-empty-chip">Your project, in your hands</span></div> : <>
      <div className="ccs-review-summary"><div><h3>{review.files.length} {review.files.length === 1 ? 'file changed' : 'files changed'}</h3><p>{review.summary || 'Review direct file edits captured for this run.'}</p></div><span className="ccs-line-stats"><span>+{additions}</span><span>−{deletions}</span></span></div>
      <div className="ccs-review-files">{review.files.map((file) => <details key={file.path} className="ccs-file-diff" open={review.files.length === 1}><summary><FileCode2 size={13}/><span title={file.path}>{file.path}</span><span className={`ccs-file-kind is-${file.status}`}>{file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}</span><ChevronDown size={12}/></summary><div className="ccs-file-toolbar"><span>{file.status === 'added' ? 'New file' : file.status === 'deleted' ? 'Deleted file' : 'Updated file'}</span>{onOpenFile && file.status !== 'deleted' ? <button className="ccs-text-button" onClick={() => onOpenFile(file.path)}>Open file<ArrowUpRight size={11}/></button> : null}</div>{file.diff ? <pre className="ccs-diff" tabIndex={0} aria-label={`Diff for ${file.path}`}><code>{file.diff.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'is-added' : line.startsWith('-') && !line.startsWith('---') ? 'is-deleted' : line.startsWith('@@') ? 'is-hunk' : ''}>{line || ' '}<br/></span>)}</code></pre> : <p className="ccs-diff-unavailable">{file.reason || 'A text diff is unavailable for this file.'}</p>}{file.reviewable === false ? <p className="ccs-file-warning"><CircleAlert size={12}/>{file.reason || 'This file cannot be restored automatically.'}</p> : null}</details>)}</div>
      {review.state === 'conflict' || review.conflicts?.length ? <div className="ccs-warning" role="alert"><CircleAlert size={15}/><div><strong>Some files changed again.</strong><p>Refresh the review before undoing. Your newer edits have been preserved.</p>{review.conflicts?.length ? <ul>{review.conflicts.map((path) => <li key={path}>{path}</li>)}</ul> : null}</div></div> : null}
      {review.state === 'kept' || review.state === 'undone' ? <div className="ccs-resolved"><Check size={14}/>{review.state === 'kept' ? 'Changes kept. Keep building.' : 'Direct file edits undone.'}</div> : <div className="ccs-review-actions">{confirmUndo ? <div className="ccs-undo-confirm"><p>Undo these direct agent file edits? Changes made by commands or MCP tools are excluded. Newer edits will be preserved.</p><div><button className="ccs-button" disabled={disabled} onClick={() => setConfirmUndo(false)}>Cancel</button><button className="ccs-button is-danger" disabled={disabled || !allReviewable} onClick={() => void onUndo()}>{busy === 'undo' ? <LoaderCircle className="ccs-spin" size={13}/> : <RotateCcw size={13}/>}Undo file edits</button></div></div> : <><button className="ccs-button" disabled={disabled || !pending || !allReviewable} onClick={() => setConfirmUndo(true)} title={!allReviewable ? 'Some files cannot be restored automatically.' : 'Undo direct agent file edits'}><RotateCcw size={13}/>Undo</button><button className="ccs-button is-primary" disabled={disabled || !pending} onClick={() => void onKeep()}>{busy === 'keep' ? <LoaderCircle className="ccs-spin" size={13}/> : <Check size={13}/>}Keep changes</button></>}</div>}
    </>}
    {error ? <div className="ccs-warning" role="alert"><CircleAlert size={15}/><p>{error}</p></div> : null}
    {running ? <p className="ccs-footnote">Review after this run finishes.</p> : null}
    {review?.files.length ? <p className="ccs-footnote">Review and Undo cover direct agent file edits. Changes made by commands or MCP tools are excluded. Keep accepts the edits already in your workspace without creating a Git commit.</p> : null}
  </section>;
}

export function useProjectPad(workspace: string) {
  const key = projectPadKey(workspace);
  const [draft, setDraft] = useState({ key: '', value: '' });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState('');
  const loadedKey = useRef('');
  useEffect(() => {
    let value = '';
    try { const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null'); if (saved && typeof saved === 'object' && 'value' in saved && typeof saved.value === 'string') value = saved.value.slice(0, PAD_LIMIT); setSaveState('saved'); setError(''); }
    catch { setSaveState('error'); setError('Device storage is unavailable. Copy your notes before closing.'); }
    loadedKey.current = key; setDraft({ key, value });
  }, [key]);
  function onChange(value: string) {
    if (loadedKey.current !== key) return;
    const next = value.slice(0, PAD_LIMIT); setDraft({ key, value: next }); setSaveState('saving');
    try { localStorage.setItem(key, JSON.stringify({ value: next })); setSaveState('saved'); setError(''); }
    catch { setSaveState('error'); setError('These notes could not be saved on this device. Copy them before closing.'); }
  }
  return { value: draft.key === key ? draft.value : '', onChange, saveState, error };
}

export function ProjectPad({ workspace, value, onChange, saveState = 'saved', error = '' }: { workspace: string; value: string; onChange: (value: string) => void; saveState?: SaveState; error?: string }) {
  const id = useId();
  const projectName = workspace.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return <section className="cc-studio ccs-pad" aria-label="Project pad"><div className="ccs-panel-heading"><span className="ccs-eyebrow"><NotebookPen size={12}/>PROJECT PAD</span><span className={`ccs-save-state ${saveState}`} role="status">{saveState === 'saving' ? <LoaderCircle className="ccs-spin" size={11}/> : saveState === 'error' ? <CircleAlert size={11}/> : <Check size={11}/>} {saveState === 'saved' ? 'Saved on device' : saveState === 'saving' ? 'Saving' : 'Not saved'}</span></div><h3>Keep your ideas close.</h3><p className="ccs-subtitle">Decisions, little details, and the next thing to make.</p><label htmlFor={id} className="ccs-sr-only">Notes for {projectName || 'your next project'}</label><textarea id={id} value={value} maxLength={PAD_LIMIT} onChange={(event) => onChange(event.target.value)} placeholder={'What are we making?\n\n• The feeling it should have\n• Things to remember\n• The next small step'} spellCheck/><div className="ccs-pad-footer"><span title={workspace}>{projectName || 'Unpaired project'}</span><span>{value.length.toLocaleString()} / {PAD_LIMIT.toLocaleString()}</span></div>{error ? <p className="ccs-pad-error" role="alert">{error}</p> : null}<p className="ccs-footnote">Private notes for this workspace, saved in this app on this device. Add them to your prompt when you want to share them with your agent.</p></section>;
}

export function LocalPreviewPanel({ value, onChange, onOpenExternal }: { value: string; onChange: (url: string) => void; onOpenExternal?: (url: string) => void | Promise<void> }) {
  const [error, setError] = useState(''), [opening, setOpening] = useState(false);
  const [previewLink, setPreviewLink] = useState(''), [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const id = useId();
  async function launch(event: FormEvent) {
    event.preventDefault(); setError(''); setPreviewLink(''); setCopyState('idle');
    let url: string;
    try { url = localPreviewUrl(value, [window.location.origin]); } catch (e) { setError(e instanceof Error ? e.message : 'Enter a valid local address.'); return; }
    setOpening(true);
    try {
      onChange(url);
      if (onOpenExternal) await onOpenExternal(url);
      else { const opened = window.open(url, '_blank', 'noopener,noreferrer'); if (opened) opened.opener = null; }
      setPreviewLink(url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Your local preview could not be opened.'); }
    finally { setOpening(false); }
  }
  async function copyAddress() {
    if (!previewLink) return;
    try { await navigator.clipboard.writeText(previewLink); setCopyState('copied'); }
    catch { setCopyState('error'); }
  }
  return <section className="cc-studio ccs-preview" aria-label="Local app preview"><div className="ccs-panel-heading"><span className="ccs-eyebrow"><Globe2 size={12}/>LOCAL PREVIEW</span><span className="ccs-neutral-chip"><ExternalLink size={10}/>External browser</span></div><div className="ccs-preview-art" aria-hidden="true"><div className="ccs-browser-shell"><div><i/><i/><i/><span>localhost</span></div><section><span/><span/><span/><div><i/><i/></div></section></div><span className="ccs-preview-cursor"><ArrowUpRight size={19}/></span></div><h3>See your idea come to life.</h3><p className="ccs-subtitle">Start your project’s development server, then open the local address it prints.</p><form onSubmit={(event) => void launch(event)}><label htmlFor={id}>Development server address</label><div className="ccs-preview-input"><Globe2 size={14}/><input id={id} type="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={value} onChange={(event) => { onChange(event.target.value); setError(''); setPreviewLink(''); setCopyState('idle'); }} placeholder="http://localhost:5173" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}/></div>{error ? <p id={`${id}-error`} className="ccs-pad-error" role="alert">{error}</p> : null}<button className="ccs-button is-primary" disabled={opening} type="submit">{opening ? <LoaderCircle className="ccs-spin" size={13}/> : <ExternalLink size={13}/>}Open preview<ArrowUpRight size={12}/></button></form>{previewLink ? <div className="ccs-preview-fallback"><p>If a browser window did not open, use this link or copy the address.</p><div><a className="ccs-text-button" href={previewLink} target="_blank" rel="noopener noreferrer" onClick={(event) => { if (window.closedcodeDesktop && onOpenExternal) { event.preventDefault(); void Promise.resolve().then(() => onOpenExternal(previewLink)).catch((e) => setError(e instanceof Error ? e.message : 'Your local preview could not be opened.')); } }}>Open preview link<ArrowUpRight size={12}/></a><button type="button" className="ccs-text-button" onClick={() => void copyAddress()}>{copyState === 'copied' ? <Check size={12}/> : <Copy size={12}/>}Copy address</button></div><span className={copyState === 'error' ? 'is-error' : ''} role="status">{copyState === 'copied' ? 'Address copied.' : copyState === 'error' ? 'Clipboard access is unavailable. Select and copy the address above.' : ''}</span></div> : null}<p className="ccs-footnote">Opens a loopback HTTP address in your browser. A saved address does not mean a server is running.</p></section>;
}
