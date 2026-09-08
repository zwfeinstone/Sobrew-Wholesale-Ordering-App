'use client';
import { RefreshCw } from 'lucide-react';
export default function CustomerWorkspaceError({ reset }: { reset: () => void }) {
  return <section className="workspace-empty" role="alert"><h1 className="page-title">Customer unavailable</h1><p>The customer workspace could not be loaded. No changes were made.</p><button type="button" className="btn-primary" onClick={reset}><RefreshCw size={16} />Try again</button></section>;
}
