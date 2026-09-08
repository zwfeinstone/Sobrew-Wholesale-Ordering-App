'use client';
import { useState, type ReactNode } from 'react';
const tabs = [['catalog','Catalog & pricing'],['orders','Orders'],['locations','Locations'],['people','People'],['activity','Activity'],['settings','Settings']] as const;
export default function CustomerWorkspaceTabs({ initialTab, panels }: { initialTab: string; panels: Record<string, ReactNode> }) {
  const [active,setActive] = useState(tabs.some(([id]) => id === initialTab) ? initialTab : 'catalog');
  return <div className="customer-workspace"><div className="workspace-tabs" role="tablist" aria-label="Customer workspace">{tabs.map(([id,label],i) => <button key={id} id={`tab-${id}`} role="tab" type="button" aria-selected={active === id} aria-controls={`panel-${id}`} tabIndex={active === id ? 0 : -1} onClick={() => setActive(id)} onKeyDown={e => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault(); const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length-1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setActive(tabs[index][0]); document.getElementById(`tab-${tabs[index][0]}`)?.focus();
  }}>{label}</button>)}</div>{tabs.map(([id]) => <div key={id} id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} hidden={active !== id} className="customer-tab-panel space-y-6">{panels[id]}</div>)}</div>;
}
