"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown, LoaderCircle, Search, Settings2, Sparkles } from "lucide-react";
import "./pickers.css";

export type PickerOption = { value: string; label: string; description?: string; icon?: ReactNode; group?: string; badge?: string; disabled?: boolean };
export function GlassPicker({ label, value, options, onChange, trigger, className = "", searchable = true, searchPlaceholder, loading, error, onOpen, onManage, manageLabel = "Manage", disabled }: {
  label: string; value: string; options: PickerOption[]; onChange: (value: string) => void; trigger: ReactNode; className?: string;
  searchable?: boolean; searchPlaceholder?: string; loading?: boolean; error?: string; onOpen?: () => void; onManage?: () => void; manageLabel?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const id = useId();
  const filtered = options.filter((option) => `${option.label} ${option.description || ""}`.toLowerCase().includes(query.toLowerCase()));
  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0));
  function choose(option: PickerOption) { if (!option.disabled) { onChange(option.value); setOpen(false); } }
  function move(direction: number) {
    let next = activeIndex;
    for (let count = 0; count < filtered.length; count++) {
      next = (next + direction + filtered.length) % filtered.length;
      if (!filtered[next].disabled) { setActive(next); const option = list.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`); option?.scrollIntoView({ block: "nearest" }); if (!searchable) option?.focus(); break; }
    }
  }
  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { setQuery(""); setActive(Math.max(options.findIndex((option) => option.value === value), 0)); onOpen?.(); } }}>
    <Popover.Trigger asChild><button type="button" className={`cc-picker-trigger ${className}`} aria-label={label} aria-description={`Selected: ${options.find((option) => option.value === value)?.label || value}`} disabled={disabled}>{trigger}<ChevronDown size={12} className="cc-picker-chevron" /></button></Popover.Trigger>
    <Popover.Portal container={typeof document !== "undefined" ? document.querySelector<HTMLElement>(".closedcode") : undefined}>
      <Popover.Content className="cc-picker" side="top" sideOffset={10} align="start" collisionPadding={16} aria-label={label} onOpenAutoFocus={(event) => { event.preventDefault(); if (searchable) input.current?.focus(); else (list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') || list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus(); }} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
        if (event.key === "Enter" && searchable && document.activeElement === input.current && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); }
      }}>
        <div className="cc-picker-top"><span>{label}</span><span className="cc-picker-key">ESC</span></div>
        {searchable ? <div className="cc-picker-search"><Search size={14} /><input ref={input} aria-label={searchPlaceholder || `Search ${label.toLowerCase()}`} placeholder={searchPlaceholder || "Search…"} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={filtered[activeIndex] ? `${id}-${activeIndex}` : undefined} autoComplete="off" /></div> : null}
        {loading ? <div className="cc-picker-notice" role="status"><LoaderCircle size={13} className="spin" />Checking live availability…</div> : null}
        {error ? <div className="cc-picker-error" role="status">{error}</div> : null}
        <div className="cc-picker-list" ref={list} id={`${id}-list`} role="listbox" aria-label={label}>
          {filtered.map((option, index) => <div key={option.value}>{option.group && filtered[index - 1]?.group !== option.group ? <div className="cc-picker-group">{option.group}</div> : null}<button type="button" role="option" aria-selected={value === option.value} disabled={option.disabled} title={option.description || option.label} id={`${id}-${index}`} data-index={index} tabIndex={searchable ? -1 : 0} className={`cc-picker-option ${activeIndex === index ? "is-active" : ""} ${value === option.value ? "is-selected" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}><span className="cc-picker-icon">{option.icon || <Sparkles size={16} />}</span><span className="cc-picker-copy"><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>{option.badge ? <span className="cc-picker-badge">{option.badge}</span> : null}{value === option.value ? <Check size={14} className="cc-picker-check" /> : <span className="cc-picker-check-space" />}</button></div>)}
          {!filtered.length && !loading ? <div className="cc-picker-empty"><Search size={20} /><strong>No matches</strong><span>Try a different name or model ID.</span></div> : null}
        </div>
        {onManage ? <button type="button" className="cc-picker-manage" onClick={() => { setOpen(false); onManage(); }}><Settings2 size={13} />{manageLabel}<span>↗</span></button> : null}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
