import Link from 'next/link';
import { prospectingPath, type ProspectingQueueContext } from '@/lib/prospecting';

export default function ProspectingWorkspaceNav({ context }: { context: ProspectingQueueContext }) {
  return (
    <nav aria-label="Prospecting views" className="grid grid-cols-[1fr_1.7fr_1fr_1.2fr] gap-0.5 rounded-xl bg-slate-100 p-1">
      {([
        { id: 'today', label: 'Today' },
        { id: 'recent', label: 'Recently worked' },
        { id: 'list', label: 'Leads' },
        { id: 'pipeline', label: 'Pipeline' },
      ] as const).map((tab) => (
        <Link
          key={tab.id}
          aria-current={context.tab === tab.id || (tab.id === 'today' && context.tab === 'tasks') ? 'page' : undefined}
          className={`flex min-h-10 min-w-0 items-center justify-center rounded-lg px-1.5 py-2 text-center text-xs font-semibold transition sm:text-sm ${context.tab === tab.id || (tab.id === 'today' && context.tab === 'tasks') ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:bg-white/60 hover:text-slate-950'}`}
          href={prospectingPath({ ...context, tab: tab.id, stage: '', preset: undefined }, { includePageSize: true, page: 1 })}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
