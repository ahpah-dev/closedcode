'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, Circle, Code2, Command, Copy, FileCode2, FileText, Folder, FolderOpen, GitBranch, Globe, Layers3, Loader2, Menu, MessageSquare, PanelLeftClose, PanelRightClose, Paperclip, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, Terminal, Trash2, Workflow, X, Zap } from 'lucide-react';
import { AgentsPanel, PluginsPanel, RoutingPanel, SettingsPanel, SetupModal, AgentAvatar, companionRequest, type RoutingConfig, type ConnectionConfig } from './panels';
import { AgentPicker, ModelPicker } from './workspace-pickers';
import { normalizeAgentProfiles, validateAgentProfile, MAX_CUSTOM_AGENTS, type AgentProfile } from '@/lib/agent-profiles.mjs';
import { TaskProgressPanel, ChangeReviewPanel, ProjectPad, LocalPreviewPanel, useProjectPad, type StudioChangeReview } from './studio-panels';
import { localPreviewUrl } from '@/lib/preview-url.mjs';
import { createReviewDiff } from '@/lib/studio.mjs';
import './vibe-workspace.css';

type View = 'workspace' | 'agents' | 'plugins' | 'routing' | 'settings';
type Message = {id:string;role:'user'|'assistant';content:string;createdAt:string};
type Session = {id:string;title:string;agent:string;project:string;status:'idle'|'running'|'complete';messages:Message[];createdAt:string;updatedAt:string};
type AgentEvent = {kind?:string;server?:string;tool?:string;type:string;text?:string;name?:string;state?:string;status?:string;args?:Record<string,unknown>|string[];result?:unknown;from?:string;to?:string;reason?:string;error?:string;model?:string;id?:string;program?:string;workspace?:string;commandArgs?:string[];runId?:string;changeCount?:number};
type ChangeRun = {id:string;status:'running'|'pending'|'kept'|'undone';createdAt?:string;files?:Array<{path:string;kind:'created'|'added'|'modified'|'deleted';before:string|null;after:string|null;beforeBytes?:number;afterBytes?:number}>;changeCount:number};
type ApiData = {sessions?:Session[];session?:Session;files?:Array<{path:string}>;content?:string;error?:string;signInUrl?:string};
async function readResponse(response:Response):Promise<ApiData> { return await response.json() as ApiData; }
async function sessionFetch(path:string,options:RequestInit={}) {const deadline=AbortSignal.timeout(6000);const signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;if(typeof window!=='undefined'&&window.closedcodeDesktop){const connection=await window.closedcodeDesktop.getConnection();return fetch(connection.baseUrl+path,{...options,signal,headers:{...Object.fromEntries(new Headers(options.headers).entries()),Authorization:'Bearer '+connection.token}});}return fetch(path,{...options,signal}); }

const AGENTS = [
  {id:'atlas',name:'Atlas',role:'The builder',description:'Big ideas. Thoughtful execution.',color:'sage',letter:'a'},
  {id:'nova',name:'Nova',role:'The explorer',description:'A fresh perspective on every problem.',color:'violet',letter:'n'},
  {id:'sage',name:'Sage',role:'The reviewer',description:'Good code, down to the last detail.',color:'amber',letter:'s'},
  {id:'echo',name:'Echo',role:'The debugger',description:'Finds the why. Fixes the how.',color:'blue',letter:'e'},
];
const DEFAULT_ROUTING:RoutingConfig = {primary:{baseUrl:'http://127.0.0.1:20128/v1',model:'auto',apiKey:''},fallbacks:[{baseUrl:'http://127.0.0.1:11434/v1',model:'auto',apiKey:''}],autoFallback:true,freeOnly:true,autoConfigure:true};
const DEFAULT_CONNECTION:ConnectionConfig = {baseUrl:'http://127.0.0.1:47821',token:'',connected:false,workspace:''};
const EXAMPLE_FILES:Record<string,string> = {
  'src/app.tsx':`import { useState } from 'react';\nimport { AgentWorkspace } from './workspace';\n\n// A little code. A lot of possibility.\nexport default function App() {\n  const [idea, setIdea] = useState('');\n\n  return (\n    <AgentWorkspace\n      name="your-next-big-thing"\n      idea={idea}\n      onChange={setIdea}\n      agents={['atlas', 'nova']}\n    />\n  );\n}\n`,
  'src/workspace.tsx':`export function AgentWorkspace({ name, agents }) {\n  return (\n    <main className="workspace">\n      <h1>{name}</h1>\n      <p>Your agents are ready when you are.</p>\n      {agents.map(agent => (\n        <Agent key={agent} name={agent} />\n      ))}\n    </main>\n  );\n}\n`,
  'package.json':`{\n  "name": "your-next-big-thing",\n  "version": "0.1.0",\n  "license": "MIT",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  }\n}\n`,
  'README.md':`# Your next big thing\n\nThis is a starter preview.\nConnect a local project to explore your actual files.\n\nClosedCode is free, open source, and yours to make.\n`,
};
function migrateRouting(value:RoutingConfig):RoutingConfig {return {...DEFAULT_ROUTING,...value,fallbacks:(value.fallbacks||DEFAULT_ROUTING.fallbacks).map(route=>route.baseUrl.replace(/\/$/,'')==='http://127.0.0.1:11434/v1'&&route.model==='qwen2.5-coder:7b'?{...route,model:'auto'}:route)};}
function Symbol({id,small=false}:{id:string;small?:boolean}) {return <span className={`agent-symbol ${id} ${small?'small':''}`} aria-hidden="true"><span className="symbol-body"><i/><i/></span></span>}
function Logo({large=false}:{large?:boolean}) {return <span className={`cc-logo ${large?'large':''}`} aria-hidden="true"><img src="/desktop-logo.svg" alt=""/></span>}
function CodeBlock({language,code}:{language:string;code:string}) {
  const [copied,setCopied]=useState(false);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),1800);return()=>clearTimeout(timer);},[copied]);
  return <div className="vibe-code-block"><div><span>{language||'Code'}</span><button type="button" aria-label="Copy code block" onClick={()=>navigator.clipboard.writeText(code).then(()=>setCopied(true)).catch(()=>{})}>{copied?<Check size={12}/>:<Copy size={12}/>} {copied?'Copied':'Copy'}</button></div><pre><code>{code}</code></pre></div>;
}
function inlineMessage(text:string):ReactNode {return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part,index)=>part.startsWith('`')?<code key={index}>{part.slice(1,-1)}</code>:part.startsWith('**')?<strong key={index}>{part.slice(2,-2)}</strong>:part);}
function MessageContent({content}:{content:string}) {
  const blocks:ReactNode[]=[];const fence=/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;let cursor=0;let match:RegExpExecArray|null;
  const prose=(text:string,key:string)=> <div key={key}>{text.split('\n').map((line,index)=>{const heading=line.match(/^#{1,4}\s+(.+)/);return heading?<h3 key={index}>{inlineMessage(heading[1])}</h3>:/^\s*[-*]\s+/.test(line)?<p className="vibe-message-bullet" key={index}><span>•</span>{inlineMessage(line.replace(/^\s*[-*]\s+/,''))}</p>:<p key={index}>{inlineMessage(line)||'\u00a0'}</p>;})}</div>;
  while((match=fence.exec(content))){if(match.index>cursor)blocks.push(prose(content.slice(cursor,match.index),`text-${cursor}`));blocks.push(<CodeBlock key={`code-${match.index}`} language={match[1].trim().slice(0,30)} code={match[2].replace(/\n$/,'')}/>);cursor=fence.lastIndex;}
  if(cursor<content.length)blocks.push(prose(content.slice(cursor),`text-${cursor}`));
  return <div className="message-content">{blocks}</div>;
}
function CodeLines({content}:{content:string}) {return <div className="code-lines">{content.split('\n').map((line,i)=><div key={i}><span className="line-no">{i+1}</span><code>{line.split(/('.*?'|".*?"|\/\/.*$|\b(?:import|from|export|default|function|const|return)\b)/g).map((p,j)=><span key={j} className={p.startsWith('//')?'token-comment':/^["']/.test(p)?'token-string':/^(import|from|export|default|function|const|return)$/.test(p)?'token-keyword':''}>{p}</span>)}</code></div>)}</div>}
function reviewModel(run:ChangeRun):StudioChangeReview {
  return {runId:run.id,state:run.status==='running'?'pending':run.status,files:(run.files||[]).map(file=>({path:file.path,status:file.kind==='created'?'added':file.kind,...createReviewDiff(file.before,file.after),reviewable:true}))};
}

export default function ClosedCode() {
  const [view,setView]=useState<View>('workspace');
  const [agent,setAgent]=useState('atlas');
  const [customAgents,setCustomAgents]=useState<AgentProfile[]>([]);
  const customAgentRef=useRef<AgentProfile[]>([]);
  const customAgentIds=useRef(new Set<string>());
  const deletedAgentIds=useRef(new Set<string>());
  const profilesReady=useRef(false);
  const profilesSync=useRef<Promise<void>|null>(null);
  const [mode,setMode]=useState<'build'|'plan'>('build');
  const [prompt,setPrompt]=useState('');
  const [routing,setRouting]=useState<RoutingConfig>(DEFAULT_ROUTING);
  const [connection,setConnection]=useState<ConnectionConfig>(DEFAULT_CONNECTION);
  const [plugins,setPlugins]=useState(['file-context','subagents','code-review','mcp']);
  const [theme,setTheme]=useState('dark');
  const [sessions,setSessions]=useState<Session[]>([]);
  const [current,setCurrent]=useState<Session|null>(null);
  const [setup,setSetup]=useState(false);
  const [running,setRunning]=useState(false);
  const [events,setEvents]=useState<AgentEvent[]>([]);
  const [status,setStatus]=useState('');
  const [toast,setToast]=useState('');
  const [rightOpen,setRightOpen]=useState(true);
  const [mobileOpen,setMobileOpen]=useState(false);
  const [rightTab,setRightTab]=useState<'files'|'activity'|'changes'|'pad'|'preview'>('files');
  const [fileSearch,setFileSearch]=useState('');
  const [following,setFollowing]=useState(true);
  const [review,setReview]=useState<StudioChangeReview|null>(null);
  const [reviewLoading,setReviewLoading]=useState(false);
  const [reviewBusy,setReviewBusy]=useState<'keep'|'undo'|null>(null);
  const [reviewError,setReviewError]=useState('');
  const latestRun=useRef<string|null>(null);
  const reviewRequest=useRef(0);
  const fileRequest=useRef(0);
  const [previewUrl,setPreviewUrl]=useState('http://localhost:5173');
  const [files,setFiles]=useState<string[]>(Object.keys(EXAMPLE_FILES));
  const [activeFile,setActiveFile]=useState('src/app.tsx');
  const [fileContent,setFileContent]=useState(EXAMPLE_FILES['src/app.tsx']);
  const [commandOpen,setCommandOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [attachment,setAttachment]=useState<{name:string;content:string}|null>(null);
  const [cloud,setCloud]=useState(true);
  const [ready,setReady]=useState(false);
  const [desktop,setDesktop]=useState(false);
  const [signInUrl,setSignInUrl]=useState('');
  const [approval,setApproval]=useState<AgentEvent|null>(null);
  const [approvalBusy,setApprovalBusy]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const bottom=useRef<HTMLDivElement|null>(null);
  const textarea=useRef<HTMLTextAreaElement|null>(null);
  const fileInput=useRef<HTMLInputElement|null>(null);
  const allAgents=[...AGENTS,...customAgents];
  const selected=allAgents.find(a=>a.id===agent)||AGENTS[0];
  const notify=useCallback((message:string)=>setToast(message),[]);
  const pad=useProjectPad(connection.workspace||'unconnected');

  useEffect(()=>{
    try {const loaded=normalizeAgentProfiles(JSON.parse(localStorage.getItem('closedcode.custom-agents.v1')||'[]'));customAgentRef.current=loaded;setCustomAgents(loaded);const deleted:unknown=JSON.parse(localStorage.getItem('closedcode.deleted-agents.v1')||'[]');if(Array.isArray(deleted))deletedAgentIds.current=new Set(deleted.filter((id:unknown)=>typeof id==='string'&&/^custom_[a-f0-9-]{36}$/.test(id)).slice(0,100));const p=JSON.parse(localStorage.getItem('closedcode.preferences.v2')||'null');if(p){if(p.routing)setRouting(migrateRouting({...p.routing,freeOnly:p.routing.freeOnly!==false}));if(p.connection)setConnection({...p.connection,token:'',connected:false});if(p.plugins)setPlugins(p.plugins);if(p.theme)setTheme(p.theme);if(p.agent)setAgent(p.agent);} const token=sessionStorage.getItem('closedcode.token');if(token){setConnection(c=>({...c,token}));const baseUrl=p?.connection?.baseUrl||DEFAULT_CONNECTION.baseUrl;fetch(baseUrl+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(async r=>{if(!r.ok)throw new Error();return r.json() as Promise<{workspace:string}>;}).then(d=>setConnection(c=>({...c,baseUrl,token,connected:true,workspace:d.workspace}))).catch(()=>{});}const savedRoutes=sessionStorage.getItem('closedcode.routes.v2');if(savedRoutes)setRouting(migrateRouting(JSON.parse(savedRoutes)));}catch{}
    let alive=true;
    sessionFetch('/api/sessions').then(async r=>{const data=await readResponse(r);if(r.status===401&&data.signInUrl&&alive)setSignInUrl(data.signInUrl);if(!r.ok)throw new Error();return data;}).then(data=>{if(alive)setSessions(data.sessions||[]);}).catch(()=>{if(alive){setCloud(false);try{setSessions(JSON.parse(localStorage.getItem('closedcode.sessions.v1')||'[]'));}catch{}}});
    if(window.closedcodeDesktop){setDesktop(true);window.closedcodeDesktop.getConnection().then(d=>{if(alive)setConnection({...d,connected:true});}).catch(()=>notify('Desktop engine could not connect. Restart ClosedCode.'));}
    setReady(true);return()=>{alive=false;};
  },[]);
  useEffect(()=>{if(!ready)return;try{localStorage.setItem('closedcode.preferences.v2',JSON.stringify({routing:{...routing,primary:{...routing.primary,apiKey:''},fallbacks:routing.fallbacks.map(f=>({...f,apiKey:''}))},connection:{...connection,token:'',connected:false},plugins,theme,agent}));sessionStorage.setItem('closedcode.token',connection.token);sessionStorage.setItem('closedcode.routes.v2',JSON.stringify(routing));}catch{}},[routing,connection,plugins,theme,agent,ready]);
  useEffect(()=>{customAgentRef.current=customAgents;if(ready)try{localStorage.setItem('closedcode.custom-agents.v1',JSON.stringify(customAgents));}catch{}},[customAgents,ready]);
  useEffect(()=>{
    profilesReady.current=false;
    if(!connection.connected){profilesSync.current=null;return;}
    let alive=true;
    const sync=async()=>{
      try{
        const response=await companionRequest<{agents:AgentProfile[]}>(connection,'/api/agents');
        let remote=normalizeAgentProfiles(response.agents);
        for(const id of [...deletedAgentIds.current]){if(!alive)return;if(remote.some(profile=>profile.id===id)){const result=await companionRequest<{agents:AgentProfile[]}>(connection,'/api/agents/'+id,{method:'DELETE'});remote=normalizeAgentProfiles(result.agents);deletedAgentIds.current.delete(id);}}
        try{localStorage.setItem('closedcode.deleted-agents.v1',JSON.stringify([...deletedAgentIds.current]));}catch{}
        customAgentIds.current=new Set(remote.map(profile=>profile.id));
        for(const local of customAgentRef.current){
          if(!alive)return;const saved=remote.find(profile=>profile.id===local.id);
          if(!saved||Date.parse(local.updatedAt)>Date.parse(saved.updatedAt)){
            const result=await companionRequest<{agents:AgentProfile[]}>(connection,'/api/agents'+(saved?'/'+local.id:''),{method:saved?'PATCH':'POST',body:local});remote=normalizeAgentProfiles(result.agents);customAgentIds.current=new Set(remote.map(profile=>profile.id));
          }
        }
        if(alive){customAgentRef.current=remote;setCustomAgents(remote);profilesReady.current=true;}
      }catch{if(alive&&customAgentRef.current.length)notify('Custom profiles are saved on this device. Update your companion to sync and run them.');}
    };
    profilesSync.current=sync();return()=>{alive=false;};
  },[connection.connected,connection.baseUrl,connection.token,notify]);
  async function saveCustomAgent(input:AgentProfile){
    const profile=validateAgentProfile(input);await profilesSync.current;
    const current=customAgentRef.current;
    if(!current.some(item=>item.id===profile.id)&&current.length>=MAX_CUSTOM_AGENTS)throw new Error('You can save up to '+MAX_CUSTOM_AGENTS+' custom agents.');
    if(current.some(item=>item.id!==profile.id&&item.name.toLowerCase()===profile.name.toLowerCase()))throw new Error('Another custom agent already uses this name.');
    let next=[...current.filter(item=>item.id!==profile.id),profile];
    if(connection.connected&&profilesReady.current){const exists=customAgentIds.current.has(profile.id);const result=await companionRequest<{agents:AgentProfile[]}>(connection,'/api/agents'+(exists?'/'+profile.id:''),{method:exists?'PATCH':'POST',body:profile});next=normalizeAgentProfiles(result.agents);customAgentIds.current=new Set(next.map(item=>item.id));}
    customAgentRef.current=next;setCustomAgents(next);notify(profile.name+' saved'+(connection.connected&&profilesReady.current?' in your local engine.':' on this device.'));
  }
  async function deleteCustomAgent(id:string){
    await profilesSync.current;let next=customAgentRef.current.filter(profile=>profile.id!==id);
    if(connection.connected&&profilesReady.current&&customAgentIds.current.has(id)){const result=await companionRequest<{agents:AgentProfile[]}>(connection,'/api/agents/'+id,{method:'DELETE'});next=normalizeAgentProfiles(result.agents);customAgentIds.current.delete(id);deletedAgentIds.current.delete(id);}else{deletedAgentIds.current.add(id);}
    try{localStorage.setItem('closedcode.deleted-agents.v1',JSON.stringify([...deletedAgentIds.current]));}catch{}
    customAgentRef.current=next;setCustomAgents(next);if(agent===id)setAgent('atlas');notify('Custom agent deleted. Your conversations are preserved.');
  }
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(following)bottom.current?.scrollIntoView({behavior:'instant',block:'end'});},[current?.messages,running,following]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();setCommandOpen(o=>!o);}if(e.key==='Escape'){setCommandOpen(false);setMobileOpen(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{if(!connection.connected)return;fetch(connection.baseUrl+'/api/files',{headers:{Authorization:`Bearer ${connection.token}`}}).then(readResponse).then(d=>{if(d.files){setFiles(d.files.map(f=>f.path));setActiveFile('');setFileContent('Select a file to explore your project.');}}).catch(()=>notify('Could not read project files. Check the companion connection.'));},[connection.connected,connection.baseUrl,connection.token,connection.workspace,notify]);

  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{if(window.matchMedia('(max-width: 1050px)').matches)setRightOpen(false);},[]);
  async function openFile(path:string) {const requestId=++fileRequest.current;setActiveFile(path);if(!connection.connected){setFileContent(EXAMPLE_FILES[path]||'');return;}setFileContent('');try{const data=await companionRequest<ApiData>(connection,'/api/file?path='+encodeURIComponent(path));if(requestId===fileRequest.current)setFileContent(data.content||'');}catch(e){if(requestId===fileRequest.current){setFileContent('');notify(e instanceof Error?e.message:'Could not read file.');}}}
  useEffect(()=>{fileRequest.current++;setActiveFile('');setFileContent('');setFileSearch('');},[connection.workspace,connection.baseUrl,connection.token]);
  const loadReview=useCallback(async(id?:string)=>{
    if(!connection.connected)return;const requestId=++reviewRequest.current;setReviewLoading(true);setReviewError('');
    try{
      let target=id;
      if(!target){const data=await companionRequest<{runs:ChangeRun[]}>(connection,'/api/changes');target=data.runs.find(run=>run.status==='pending')?.id||data.runs[0]?.id;}
      if(!target){if(requestId===reviewRequest.current)setReview(null);return;}
      let data=await companionRequest<{run:ChangeRun}>(connection,'/api/changes/'+target);
      if(data.run.changeCount===0){const history=await companionRequest<{runs:ChangeRun[]}>(connection,'/api/changes');const pending=history.runs.find(run=>run.status==='pending'&&run.changeCount>0);if(pending){target=pending.id;data=await companionRequest<{run:ChangeRun}>(connection,'/api/changes/'+target);}}
      if(requestId===reviewRequest.current){latestRun.current=target;setReview(reviewModel(data.run));}
    }catch(error){if(requestId===reviewRequest.current)setReviewError(error instanceof Error?error.message:'Could not load changes.');}
    finally{if(requestId===reviewRequest.current)setReviewLoading(false);}
  },[connection.connected,connection.baseUrl,connection.token,connection.workspace]);
  useEffect(()=>{reviewRequest.current++;setReview(null);setReviewError('');latestRun.current=null;if(connection.connected)void loadReview();},[loadReview,connection.connected]);
  async function resolveReview(action:'keep'|'undo'){
    if(!review||running||reviewBusy)return;const target=review.runId;setReviewBusy(action);setReviewError('');
    try{
      const data=await companionRequest<{run:ChangeRun}>(connection,`/api/changes/${target}/${action}`,{method:'POST',body:{},timeout:20000});
      if(latestRun.current===target)setReview(reviewModel(data.run));
      if(action==='undo'){const data=await companionRequest<ApiData>(connection,'/api/files');if(data.files){const next=data.files.map(file=>file.path);setFiles(next);if(activeFile&&next.includes(activeFile))await openFile(activeFile);else if(activeFile){fileRequest.current++;setActiveFile('');setFileContent('');}}}
      await loadReview();
      notify(action==='keep'?'Changes kept in your project.':'Agent file edits undone.');
    }catch(error){setReviewError(error instanceof Error?error.message:'Review action failed.');}
    finally{setReviewBusy(null);}
  }
  async function openPreview(input:string){
    const url=localPreviewUrl(input,[connection.baseUrl,window.location.origin]);
    if(window.closedcodeDesktop){if(!window.closedcodeDesktop.openLocalPreview)throw new Error('Update the desktop app to open local previews.');await window.closedcodeDesktop.openLocalPreview(url);}
    else {const opened=window.open(url,'_blank','noopener,noreferrer');if(opened)opened.opener=null;}
  }
  async function persist(session:Session,exists:boolean) {
    setSessions(prev=>{const updated=[session,...prev.filter(s=>s.id!==session.id)];try{localStorage.setItem('closedcode.sessions.v1',JSON.stringify(updated));}catch{}return updated;});
    if(!cloud)return;
    try{const response=await sessionFetch(exists?'/api/sessions/'+session.id:'/api/sessions',{method:exists?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:session.title,agent:session.agent,project:session.project,messages:session.messages,...(exists?{status:session.status}:{})})});if(!response.ok)throw new Error();const data=await readResponse(response);if(!data.session)throw new Error();const saved=data.session;setSessions(prev=>[saved,...prev.filter(s=>s.id!==session.id&&s.id!==saved.id)]);setCurrent(saved);return saved;}catch{setCloud(false);notify('Server history is unavailable. This session is saved on this device.');}
  }
  function newSession(){if(running){notify('Stop the current run before opening a new session.');return;}setCurrent(null);setPrompt('');setEvents([]);setFollowing(true);setView('workspace');setMobileOpen(false);setAttachment(null);textarea.current?.focus();}
  function pickSession(session:Session){if(running){notify('Stop the current run before switching sessions.');return;}setCurrent(session);setFollowing(true);setAgent(allAgents.some(profile=>profile.id===session.agent)?session.agent:'atlas');setEvents([]);setView('workspace');setMobileOpen(false);setCommandOpen(false);}
  async function deleteSession(session:Session){if(running)return;try{if(cloud){const r=await sessionFetch('/api/sessions/'+session.id,{method:'DELETE'});if(!r.ok)throw new Error();}const next=sessions.filter(s=>s.id!==session.id);setSessions(next);localStorage.setItem('closedcode.sessions.v1',JSON.stringify(next));if(current?.id===session.id)setCurrent(null);notify('Session deleted.');}catch{notify('Could not delete session. Try again.');}}
  async function run() {
    if(!prompt.trim()||running||controller.current)return;
    if(!connection.connected){setSetup(true);return;}
    if(agent.startsWith('custom_')){await profilesSync.current;if(controller.current)return;if(!profilesReady.current){notify('Update and connect the local companion to run this custom agent.');return;}}
    const text=prompt.trim();if(text.length+(attachment?.content.length||0)>30000){notify('Keep your prompt and attachment below 30,000 characters.');return;}const now=new Date().toISOString();const prior=current;
    let session:Session=prior?{...prior,messages:[...prior.messages,{id:crypto.randomUUID(),role:'user',content:text,createdAt:now}],status:'running',updatedAt:now}:{id:crypto.randomUUID(),title:text.slice(0,54),agent,project:connection.workspace||'Local project',status:'running',messages:[{id:crypto.randomUUID(),role:'user',content:text,createdAt:now}],createdAt:now,updatedAt:now};
    setPrompt('');setRunning(true);setEvents([]);setStatus(`${selected.name} is getting oriented…`);setCurrent(session);setFollowing(true);setRightTab('activity');if(window.innerWidth>1050)setRightOpen(true);latestRun.current=null;setReviewError('');
    const abort=new AbortController();controller.current=abort;let responseText='';let failed=false;let completed=false;
    try{
      const saved=await persist(session,!!prior);if(saved)session={...saved,status:'running'};
      const assistantId=crypto.randomUUID();session={...session,messages:[...session.messages,{id:assistantId,role:'assistant',content:'',createdAt:now}]};setCurrent(session);
      const request=await fetch(connection.baseUrl+'/api/run',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${connection.token}`},body:JSON.stringify({prompt:text+(attachment?`\n\nAttached context: ${attachment.name}\n${attachment.content}`:''),agent,mode,model:routing.primary.model,routing:{...routing,fallbacks:routing.autoFallback?routing.fallbacks:[]},history:(prior?.messages||[]).map(m=>({role:m.role,content:m.content})),plugins})});
      if(!request.ok){const data=await readResponse(request);throw new Error(data.error||`Companion returned ${request.status}`);}
      if(!request.body)throw new Error('No response stream received.');
      const reader=request.body.getReader();const decoder=new TextDecoder();let buffer='';
      function handle(event:AgentEvent){if(event.type!=='delta')setEvents(prev=>[...prev,event].slice(-300));if(event.runId)latestRun.current=event.runId;if(event.type==='changes'&&event.status!=='running'&&event.changeCount){void loadReview(event.runId);setRightTab('changes');} if(event.type==='approval'){setApproval({...event,commandArgs:Array.isArray(event.args)?event.args:[]});setStatus(event.kind==='mcp'?'Waiting for your MCP tool approval…':'Waiting for your command approval…');}if(event.type==='delta'||event.type==='reset'){responseText=event.type==='reset'?(event.text||''):responseText+(event.text||'');session={...session,messages:session.messages.map(m=>m.id===assistantId?{...m,content:responseText}:m)};setCurrent({...session});}if(event.type==='status')setStatus(event.text||'Working…');if(event.type==='fallback'){setStatus('Switching to '+event.to);notify('Fallback activated: '+event.to);}if(event.type==='error')throw new Error(event.error||'Agent request failed.');if(event.type==='done'){completed=true;if(event.text){responseText=event.text;session={...session,messages:session.messages.map(m=>m.id===assistantId?{...m,content:responseText}:m)};setCurrent({...session});}}}
      while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');const blocks=buffer.split('\n\n');buffer=blocks.pop()||'';for(const block of blocks){const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(data)handle(JSON.parse(data));}}
      if(buffer.trim()){const data=buffer.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(data)handle(JSON.parse(data));}
      if(!completed)throw new Error('The response stream ended before the run completed. Review activity and try again.');
      if(!responseText)throw new Error('The provider returned no answer. Check your model and provider setup.');
      setAttachment(null);
    }catch(e){failed=true;const error=e instanceof Error?e.message:'The run could not complete.';const cancelled=abort.signal.aborted;notify(cancelled?'Run stopped.':error);setEvents(prev=>[...prev,{type:'error',error:cancelled?'Stopped by you.':error}]);if(!responseText)session={...session,messages:[...session.messages.filter(m=>m.content),{id:crypto.randomUUID(),role:'assistant',content:cancelled?'Run stopped. You can continue when you’re ready.':`I couldn’t complete this run. ${error}`,createdAt:new Date().toISOString()}]};
    }finally{const final={...session,status:(failed?'idle':'complete') as Session['status'],updatedAt:new Date().toISOString()};setApproval(null);setCurrent(final);await persist(final,true);setRunning(false);setStatus('');controller.current=null;if(latestRun.current)void loadReview(latestRun.current);if(connection.connected){try{const r=await fetch(connection.baseUrl+'/api/files',{headers:{Authorization:`Bearer ${connection.token}`}});const d=await readResponse(r);if(d.files)setFiles(d.files.map(f=>f.path));if(activeFile)await openFile(activeFile);}catch{}}}
  }
  async function respondApproval(approved:boolean){if(!approval?.id)return;setApprovalBusy(true);try{const r=await fetch(connection.baseUrl+'/api/approval',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${connection.token}`},body:JSON.stringify({id:approval.id,approved})});const d=await readResponse(r);if(!r.ok)throw new Error(d.error||'Approval could not be delivered.');setApproval(null);setStatus(approved?'Running your approved tool…':'Tool declined. Agent is continuing…');}catch(e){notify(e instanceof Error?e.message:'Could not send approval.');}finally{setApprovalBusy(false);}}
  async function attach(file:File){if(file.size>24000){notify('Choose a text file smaller than 24 KB.');return;}setAttachment({name:file.name,content:await file.text()});notify('File added as context.');}
  const actions=[{name:'New session',icon:Plus,action:newSession},{name:'Choose an agent',icon:Sparkles,action:()=>setView('agents')},{name:'Configure OmniRoute',icon:Workflow,action:()=>setView('routing')},{name:'Connect local project',icon:FolderOpen,action:()=>setSetup(true)},{name:'Manage plugins',icon:Layers3,action:()=>setView('plugins')}];
  return <div className={`closedcode ${theme==='dark'?'dark':theme==='system'?'system-theme':'light'}`}>
    {mobileOpen?<button className="sidebar-scrim" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>:null}
    <aside className={`sidebar ${mobileOpen?'mobile-open':''}`}>
      <button className="brand" onClick={newSession}><Logo/><span>ClosedCode<span className="brand-period">.</span></span><span className="beta">STUDIO</span></button>
      <button className="new-session" onClick={newSession}><Plus size={17}/>New session</button>
      <button className="search-button" onClick={()=>setCommandOpen(true)}><Search size={16}/>Quick actions<kbd>⌘ K</kbd></button>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">{([{id:'workspace',icon:MessageSquare,label:'Workspace'},{id:'agents',icon:Sparkles,label:'Agents',badge:String(allAgents.length)},{id:'plugins',icon:Layers3,label:'Plugins'},{id:'routing',icon:Workflow,label:'Model routing'}] as const).map(item=><button key={item.id} className={view===item.id?'active':''} onClick={()=>{setView(item.id);setMobileOpen(false);}}><item.icon size={17}/><span>{item.label}</span>{'badge' in item?<span className="nav-count">{item.badge}</span>:null}{item.id==='routing'?<span className="nav-dot"/>:null}</button>)}</nav>
      <div className="session-section"><div className="nav-label">RECENT SESSIONS <button aria-label="New session" onClick={newSession}><Plus size={14}/></button></div>{sessions.length?sessions.slice(0,8).map(s=><div className={`session-row ${current?.id===s.id?'selected':''}`} key={s.id}><button onClick={()=>pickSession(s)}><MessageSquare size={14}/><span>{s.title}</span></button><button aria-label={'Delete '+s.title} className="delete-session" onClick={()=>deleteSession(s)}><Trash2 size={12}/></button></div>):<div className="empty-sessions"><span>A clean slate.</span><p>Your next great idea lives here.</p></div>}</div>
      <div className="sidebar-bottom"><button className="router-card" onClick={()=>setView('routing')}><div><span className="route-icon"><Zap size={15}/></span><strong>Powered by OmniRoute</strong><ArrowRight size={14}/></div><p>One gateway. Free-first inference.</p><span className="router-card-bottom"><i/>{connection.connected?'Companion connected':'Ready to connect'}<span>Free & open source</span></span></button><button className={`settings-nav ${view==='settings'?'active':''}`} onClick={()=>setView('settings')}><Settings2 size={16}/>Settings<span className="version">v0.4.0</span></button><div className="profile"><span className="profile-avatar">D</span><div><strong>Personal workspace</strong><span>Your code stays yours</span></div><ShieldCheck size={15}/></div></div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button><span className="topbar-workspace">{view==='workspace'?'Studio':view==='routing'?'Model routing':view[0].toUpperCase()+view.slice(1)}</span><ChevronRight size={13}/><span>{view==='workspace'?(current?.title||'New session'):'Overview'}</span></div><div className="topbar-actions"><span className="private-label"><ShieldCheck size={13}/>Your code. Your control.</span>{view==='workspace'?<button className="vibe-top-action" onClick={()=>{setRightOpen(true);setRightTab('pad');}}><BookOpen size={14}/>Pad</button>:null}<button className="connect-button" onClick={()=>setSetup(true)}><span className={connection.connected?'connection-dot connected':'connection-dot'}/>{connection.connected?'Project connected':'Connect project'}<ChevronDown size={13}/></button><button className="icon-button" aria-label={rightOpen?'Hide project panel':'Show project panel'} onClick={()=>setRightOpen(o=>!o)}><PanelRightClose size={18}/></button></div></header>
      <div className="body-columns">
        <main className={`main-content ${view!=='workspace'?'panel-view':''}`}>
          {signInUrl?<div className="signin-banner"><ShieldCheck size={13}/><span>Sign in to sync your sessions across devices.</span><a href={signInUrl}>Connect account<ArrowRight size={12}/></a></div>:null}
          {view==='workspace'?<>
            <div className={`conversation ${current?'has-messages':''}`} onScroll={event=>{const node=event.currentTarget;setFollowing(node.scrollHeight-node.scrollTop-node.clientHeight<100);}}>
              {!current?<div className="welcome vibe-welcome">
                <div className="vibe-welcome-label"><span className="vibe-live-dot"/>A SPACE FOR YOUR NEXT IDEA</div>
                <div className="vibe-agent-orbit"><AgentAvatar agent={agent} color={selected.color}/><span/><i/></div>
                <h1>From idea to<br/><span>something real.</span></h1>
                <p>Build, explore, and refine with a coding partner.<br/>Your project stays at the center.</p>
                <div className="vibe-workflow"><span><BookOpen size={12}/>Think it through</span><i/><span><Code2 size={12}/>Build together</span><i/><span><Check size={12}/>Make it yours</span></div>
                <div className="starter-prompts vibe-starters"><button onClick={()=>{setPrompt('Build a polished, responsive app for this idea: ');setAgent('atlas');setMode('build');textarea.current?.focus();}}><span><Code2 size={17}/></span><strong>Bring an idea to life</strong><small>Start with what you imagine</small><ArrowRight size={14}/></button><button onClick={()=>{setPrompt('Explore this project, explain how it works, and propose a clear implementation plan before changing anything.');setAgent('nova');setMode('plan');textarea.current?.focus();}}><span><FolderOpen size={17}/></span><strong>Find your way around</strong><small>Understand an existing project</small><ArrowRight size={14}/></button><button onClick={()=>{setPrompt('Review this project for bugs, accessibility issues, and rough edges. Explain what matters most and propose focused improvements.');setAgent('sage');setMode('plan');textarea.current?.focus();}}><span><Sparkles size={17}/></span><strong>Make something better</strong><small>Polish the details that matter</small><ArrowRight size={14}/></button></div>
                {!connection.connected?<button className="vibe-connect-hint" onClick={()=>setSetup(true)}><FolderOpen size={13}/>Connect a project when you’re ready<ArrowRight size={12}/></button>:<div className="vibe-connected-hint"><span className="vibe-live-dot"/>{connection.workspace.split(/[\\/]/).filter(Boolean).pop()} is connected · Free-only routes are checked before each run</div>}
              </div>:<div className="messages">{current.messages.map(m=><article key={m.id} className={`message ${m.role}`}><div className="message-avatar">{m.role==='assistant'?<AgentAvatar agent={current.agent} color={allAgents.find(profile=>profile.id===current.agent)?.color} size="small"/>:<span className="you-avatar">D</span>}</div><div className="message-body"><div className="message-author">{m.role==='assistant'?(allAgents.find(a=>a.id===current.agent)?.name||(current.agent.startsWith('custom_')?'Custom agent':'Atlas')):'You'}<span>{m.role==='assistant'?'Your coding partner':'Just now'}</span></div><MessageContent content={m.content}/>{!running&&m.role==='assistant'?<button className="copy-message" aria-label="Copy response" onClick={()=>{navigator.clipboard.writeText(m.content).then(()=>notify('Response copied.')).catch(()=>notify('Clipboard access unavailable.'));}}><Copy size={13}/></button>:null}</div></article>)}{running?<div className="run-status"><AgentAvatar agent={agent} color={selected.color} size="small"/><Loader2 size={13} className="spin"/>{status}</div>:null}<div ref={bottom}/></div>}
            </div>
            <div className="composer-area">{mode==='plan'&&current?.status==='complete'&&!running?<button className="vibe-plan-action" onClick={()=>{setMode('build');setPrompt('Implement the plan from this conversation. Read relevant files, make focused changes, and verify the result with the available tools.');textarea.current?.focus();}}><Code2 size={14}/><span>Ready to turn this plan into code?</span>Build this plan<ArrowRight size={13}/></button>:null}{!following&&current?<button className="vibe-jump" onClick={()=>{setFollowing(true);bottom.current?.scrollIntoView({behavior:'instant',block:'end'});}}><ArrowDown size={13}/>Back to latest</button>:null}{review?.state==='pending'&&review.files.length&&!running?<button className="vibe-review-banner" onClick={()=>{setRightTab('changes');setRightOpen(true);}}><GitBranch size={14}/><span>{review.files.length} {review.files.length===1?'file':'files'} changed · ready for your review</span><ArrowRight size={13}/></button>:null}{approval?<div className="approval-card" role="region" aria-label="Tool approval"><div className="approval-heading"><Terminal size={16}/>{approval.kind==='mcp'?'Review external MCP tool':'Review command before running'}</div><p>{approval.kind==='mcp'?`Server ${approval.server} will call ${approval.tool}. This external server may access resources outside your project.`:`This command will run on your computer inside ${approval.workspace}. Approve it only if you trust the command and project code.`}</p><pre><code>{approval.kind==='mcp'?JSON.stringify(approval.args,null,2):`${approval.program} ${approval.commandArgs?.map(a=>JSON.stringify(a)).join(' ')}`}</code></pre><div><button disabled={approvalBusy} onClick={()=>void respondApproval(false)}>Decline</button><button className="approve" disabled={approvalBusy} onClick={()=>void respondApproval(true)}>{approvalBusy?'Sending…':'Approve once'}<ArrowRight size={12}/></button></div></div>:null}<div className={`composer ${running?'is-running':''}`}>
              {attachment?<div className="attachment"><FileText size={12}/>{attachment.name}<button aria-label="Remove attachment" onClick={()=>setAttachment(null)}><X size={12}/></button></div>:null}
              <label className="vibe-composer-label" htmlFor="vibe-prompt"><Sparkles size={12}/>{current?'KEEP THE IDEA MOVING':'WHAT WOULD YOU LIKE TO MAKE?'}</label><textarea id="vibe-prompt" ref={textarea} aria-label="Ask your coding agent" placeholder={`Describe your idea, or ask ${selected.name} to change something…`} value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void run();}}} rows={3}/>
              <div className="composer-toolbar"><div className="composer-controls"><button className="attach-button icon-button" aria-label="Attach a text file" onClick={()=>fileInput.current?.click()}><Paperclip size={16}/></button><input ref={fileInput} type="file" accept=".txt,.md,.json,.js,.ts,.tsx,.jsx,.css,.html,.py,.rs,.go,.yaml,.yml" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void attach(f);e.target.value='';}}/><span className="toolbar-divider"/><AgentPicker agents={allAgents} value={agent} onChange={setAgent} onManage={()=>setView('agents')} disabled={running}/><div className="mode-switch"><button className={mode==='build'?'active':''} onClick={()=>setMode('build')} disabled={running}><Code2 size={12}/>Build</button><button className={mode==='plan'?'active':''} onClick={()=>setMode('plan')} disabled={running}><BookOpen size={12}/>Plan</button></div></div><div className="composer-submit"><ModelPicker routing={routing} connection={connection} onChange={setRouting} onManage={()=>setView('routing')} disabled={running}/>{running?<button className="send-button stop" aria-label="Stop agent" onClick={()=>controller.current?.abort()}><Square size={13} fill="currentColor"/></button>:<button className="send-button" aria-label="Send prompt" disabled={!prompt.trim()} onClick={()=>void run()}><ArrowUp size={18}/></button>}</div></div>
            </div><div className="composer-caption"><span><span className="tiny-dot"/>{routing.freeOnly?'Free models only':routing.autoFallback?'Automatic fallback on':'Single route'}<span className="caption-separator">·</span>{mode==='plan'?'Read-only planning':'Local agent execution'}</span><span><kbd>↵</kbd> to send <span className="caption-separator">·</span><kbd>⇧ ↵</kbd> new line</span></div></div>
            {!current?<section className="team-section vibe-team"><span>ANOTHER PERSPECTIVE?</span><div>{allAgents.slice(0,6).map(member=><button key={member.id} className={agent===member.id?'is-selected':''} onClick={()=>setAgent(member.id)}><AgentAvatar agent={member.id} color={member.color} size="small"/><span>{member.name}</span>{agent===member.id?<Check size={11}/>:null}</button>)}<button className="vibe-team-manage" onClick={()=>setView('agents')}><Plus size={13}/>Your team</button></div></section>:null}
          </>:view==='agents'?<AgentsPanel customAgents={customAgents} onSave={saveCustomAgent} onDelete={deleteCustomAgent} selectedAgent={agent} onSelect={id=>{setAgent(id);setView('workspace');notify(`${allAgents.find(a=>a.id===id)?.name} is your coding partner.`);}}/>:view==='plugins'?<PluginsPanel connection={connection} enabled={plugins} onToggle={id=>setPlugins(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])}/>:view==='routing'?<RoutingPanel routing={routing} onChange={setRouting} connection={connection} onConnectionChange={setConnection} onSetup={()=>setSetup(true)}/>:<SettingsPanel connection={connection} onConnectionChange={setConnection} theme={theme} onThemeChange={setTheme} onSetup={()=>setSetup(true)}/>}
        </main>
        {rightOpen&&view==='workspace'?<aside className="project-panel vibe-project-panel"><div className="project-header"><div><Folder size={15}/><strong>{connection.connected?(connection.workspace.split(/[\\/]/).filter(Boolean).pop()||'Local project'):'Your project'}</strong></div><button className="icon-button" aria-label="Close project panel" onClick={()=>setRightOpen(false)}><X size={14}/></button></div><div className="project-meta"><span><span className={connection.connected?'status-dot connected':'status-dot'}/>{connection.connected?'Connected to local engine':'Connect a folder to start building'}</span><button onClick={()=>setSetup(true)}>{connection.connected?'Change':'Connect'}<ChevronRight size={11}/></button></div><div className="project-tabs" role="tablist" aria-label="Project tools">{([{id:'files',label:'Code',icon:FileCode2},{id:'activity',label:'Activity',icon:Terminal},{id:'changes',label:'Changes',icon:GitBranch},{id:'pad',label:'Pad',icon:BookOpen},{id:'preview',label:'Preview',icon:Globe}] as const).map(tab=><button type="button" role="tab" aria-selected={rightTab===tab.id} key={tab.id} className={rightTab===tab.id?'active':''} onClick={()=>setRightTab(tab.id)}><tab.icon size={12}/>{tab.label}{tab.id==='changes'&&review?.state==='pending'&&review.files.length?<span>{review.files.length}</span>:null}</button>)}</div>
          <div className="vibe-project-content" role="tabpanel" aria-label={rightTab}>
          {rightTab==='files'?connection.connected?<><label className="vibe-file-search"><Search size={13}/><input aria-label="Find a project file" placeholder="Find a file…" value={fileSearch} onChange={event=>setFileSearch(event.target.value)}/><kbd>{files.length}</kbd></label><div className="file-explorer"><div className="explorer-heading">PROJECT FILES</div>{files.filter(path=>path.toLowerCase().includes(fileSearch.toLowerCase())).slice(0,100).map(path=><button className={activeFile===path?'active':''} key={path} onClick={()=>void openFile(path)}>{path.endsWith('.json')?<span className="file-type json">{'{}'}</span>:path.endsWith('.md')?<FileText size={13}/>:<FileCode2 size={13}/>}<span>{path}</span></button>)}{!files.some(path=>path.toLowerCase().includes(fileSearch.toLowerCase()))?<p className="vibe-empty-search">No matching files.</p>:null}</div><div className="code-preview"><div className="code-tab"><FileCode2 size={12}/>{activeFile.split('/').pop()||'Choose a file'}<span/><button className="icon-button" aria-label="Copy file contents" onClick={()=>navigator.clipboard.writeText(fileContent).then(()=>notify('File copied.')).catch(()=>notify('Clipboard unavailable.'))}><Copy size={12}/></button></div>{activeFile?<CodeLines content={fileContent}/>:<div className="vibe-code-empty"><Code2 size={23}/><p>Select a file to take a closer look.</p></div>}</div></>:<div className="vibe-project-empty"><span><FolderOpen size={28}/></span><h3>Your project,<br/>right here.</h3><p>Bring a folder. Your agent can explore the code, make changes, and show you what happened.</p><button onClick={()=>setSetup(true)}><Plus size={14}/>Connect a project</button><small>Your files stay on your computer.</small></div>:rightTab==='activity'?<TaskProgressPanel events={events} running={running} waitingForApproval={!!approval} status={status} agentName={selected.name}/>:rightTab==='changes'?<ChangeReviewPanel review={review} loading={reviewLoading} busy={reviewBusy} running={running} error={reviewError} onRefresh={()=>void loadReview()} onKeep={()=>void resolveReview('keep')} onUndo={()=>void resolveReview('undo')} onOpenFile={path=>{setRightTab('files');void openFile(path);}}/>:rightTab==='pad'?<ProjectPad workspace={connection.workspace||'No project connected'} value={pad.value} onChange={pad.onChange} saveState={pad.saveState} error={pad.error}/>:<LocalPreviewPanel value={previewUrl} onChange={setPreviewUrl} onOpenExternal={openPreview}/>}</div>
          <div className="vibe-panel-footer"><ShieldCheck size={12}/><span>{routing.freeOnly?'Free Only is on':'Provider pricing applies'}</span><button onClick={()=>setView('routing')}>Model setup<ArrowRight size={11}/></button></div>
        </aside>:null}
      </div><footer className="statusbar"><div><span className={connection.connected?'status-dot connected':'status-dot'}/>{connection.connected?'Local companion connected':'Local companion offline'}<span className="status-separator">/</span><span>{cloud?(desktop?'Local session history':'Synced session history'):'Device history'}</span></div><div><GitBranch size={11}/><span>Open source</span><span className="status-separator">/</span><span>Made for the way you think.</span></div></footer>
    </div>
    {setup?<SetupModal onClose={()=>setSetup(false)} connection={connection} onConnectionChange={setConnection} freeOnly={routing.freeOnly} routing={routing} onRoutingChange={setRouting}/>:null}
    {commandOpen?<div className="command-backdrop" onClick={()=>setCommandOpen(false)}><div className="command-modal" role="dialog" aria-modal="true" aria-label="Search workspace" onClick={e=>e.stopPropagation()}><div className="command-input"><Search size={19}/><input autoFocus placeholder="Where would you like to go?" aria-label="Search commands and sessions" value={search} onChange={e=>setSearch(e.target.value)}/><button onClick={()=>setCommandOpen(false)}><kbd>ESC</kbd></button></div><div className="command-results"><span>QUICK ACTIONS</span>{actions.filter(a=>a.name.toLowerCase().includes(search.toLowerCase())).map(a=><button key={a.name} onClick={()=>{setCommandOpen(false);a.action();}}><a.icon size={16}/>{a.name}<ArrowRight size={14}/></button>)}{sessions.filter(s=>s.title.toLowerCase().includes(search.toLowerCase())).map(s=><button key={s.id} onClick={()=>pickSession(s)}><MessageSquare size={16}/>{s.title}</button>)}</div></div></div>:null}
    {toast?<div className="toast" role="status"><Check size={15}/>{toast}<button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={13}/></button></div>:null}
  </div>;
}
