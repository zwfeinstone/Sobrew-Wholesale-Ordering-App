'use client';
import { Printer } from 'lucide-react';
export default function PrintOrderButton() {
  return <button className="workspace-icon-button" type="button" title="Print packing slip" aria-label="Print packing slip" onClick={() => window.print()}><Printer size={18} /></button>;
}
