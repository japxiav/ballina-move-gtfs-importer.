import React, { useEffect, useId, useMemo, useState } from 'react';
import { suggestions, type SearchChoice } from './passengerSearch';

export function StopPicker({ label, value, choices, onChange }: { label: 'From' | 'To'; value: string; choices: SearchChoice[]; onChange: (id: string) => void }) {
  const id = useId(), selected = choices.find(c => c.id === value);
  const [text, setText] = useState(selected?.title || ''), [dirty, setDirty] = useState(false), [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const matches = useMemo(() => suggestions(choices, dirty ? text : ''), [choices, dirty, text]);
  useEffect(() => { if (selected) { setText(selected.title); setDirty(false); } else if (!dirty) setText(''); }, [selected?.id, selected?.title, value, dirty]);
  useEffect(() => setActive(0), [text]);
  function choose(choice: SearchChoice) { onChange(choice.id); setText(choice.title); setDirty(false); setOpen(false); }
  return <div className="field stop-picker" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id}>{label}</label>
    <input id={id} aria-label={`${label} stop`} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && matches[active] ? `${id}-option-${active}` : undefined} autoComplete="off" spellCheck={false} maxLength={160} placeholder="Stop, station or hospital" value={text} onFocus={() => setOpen(true)} onChange={e => { setText(e.target.value); setDirty(true); setOpen(true); onChange(''); }} onKeyDown={e => {
      if (e.key === 'Escape') { setOpen(false); e.preventDefault(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(n => matches.length ? (n + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0); }
      if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]!); }
    }} />
    {selected && <small>{selected.detail}</small>}
    {open && <div id={`${id}-list`} className="stop-suggestions" role="listbox" aria-label={`${label} suggestions`}>{matches.map((c, i) => <button id={`${id}-option-${i}`} key={c.id} type="button" role="option" tabIndex={-1} aria-selected={i === active} onPointerDown={e => e.preventDefault()} onClick={() => choose(c)}><strong>{c.title}</strong><small>{c.detail}</small></button>)}{!matches.length && <p role="status">No covered stops match. Try a name or stop code.</p>}</div>}
  </div>;
}
