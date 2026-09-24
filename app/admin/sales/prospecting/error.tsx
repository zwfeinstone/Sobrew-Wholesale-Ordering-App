'use client';

export default function ProspectingError({ reset }: { reset: () => void }) {
  return <section className="card space-y-4" role="alert"><h1 className="text-xl font-semibold">Prospecting could not be loaded</h1><p className="text-sm text-slate-600">Your records have not been changed. Try loading the workspace again.</p><button type="button" className="btn-primary" onClick={reset}>Try again</button></section>;
}
