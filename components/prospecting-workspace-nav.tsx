import Link from 'next/link';
import { prospectingPath, type ProspectingQueueContext } from '@/lib/prospecting';

export default function ProspectingWorkspaceNav({ context }: { context: ProspectingQueueContext }) {
  return (
    <nav aria-label="Prospecting views" className="flex rounded-xl bg-slate-100 p-1">
      {([
        { id: 'today', label: 'Today' },
        { id: 'list', label: 'Leads' },
        { id: 'pipeline', label: 'Pipeline' },
      ] as const).map((tab) => (
        <Link
          key={tab.id}
          aria-current={context.tab === tab.id || (tab.id === 'today' && context.tab === 'tasks') ? 'page' : undefined}
          className={`min-h-10 flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition ${context.tab === tab.id || (tab.id === 'today' && context.tab === 'tasks') ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:bg-white/60 hover:text-slate-950'}`}
          href={prospectingPath({ ...context, tab: tab.id, stage: '', preset: undefined }, { includePageSize: true, page: 1 })}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
