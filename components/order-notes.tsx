import { StickyNote } from 'lucide-react';

export function OrderNotes({ notes }: { notes: string | null | undefined }) {
  if (!notes?.trim()) return null;
  return <section className="order-note" aria-label="Delivery instructions"><StickyNote aria-hidden="true" /><div><h2>Delivery instructions</h2><p>{notes.trim()}</p></div></section>;
}
