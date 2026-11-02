import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import PortalLocationForm from '@/components/portal-location-form';
import { parsePortalLocationForm, type PortalLocationFields, type PortalLocationFormState } from '@/lib/portal-locations';
import '@/app/globals.css';

type FixtureLocation = PortalLocationFields & { id: string };
type FixtureMode = 'success' | 'error' | 'deferred';
type Submission = { kind: 'add' | 'edit'; fields: Record<string, string> };

declare global {
  interface Window {
    portalLocationsFixture: {
      mode: FixtureMode;
      submissions: Submission[];
      locations: FixtureLocation[];
      complete: (() => void) | null;
      refreshCount: number;
      navigation: string[];
      rerender: () => void;
    };
  }
}

const originalLocation: FixtureLocation = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Main office',
  address1: '105 Johnson Dr',
  address2: 'Suite 2',
  city: 'Somerville',
  state: 'TN',
  zip: '38068',
};
window.portalLocationsFixture = {
  mode: (new URLSearchParams(location.search).get('mode') || 'success') as FixtureMode,
  submissions: [],
  locations: [originalLocation],
  complete: null,
  refreshCount: 0,
  navigation: [],
  rerender: () => undefined,
};

// The only action implementation is in-memory. Never send an HTTP form POST,
// even if component behavior regresses and permits a native form submission.
document.addEventListener('submit', (event) => event.preventDefault());

function PortalLocationsFixture() {
  const [locations, setLocations] = useState(window.portalLocationsFixture.locations);
  window.portalLocationsFixture.rerender = () => setLocations([...window.portalLocationsFixture.locations]);

  async function save(kind: Submission['kind'], _previous: PortalLocationFormState, data: FormData): Promise<PortalLocationFormState> {
    const fields = Object.fromEntries(Array.from(data, ([key, value]) => [key, String(value)]));
    window.portalLocationsFixture.submissions.push({ kind, fields });
    const parsed = parsePortalLocationForm(data);
    if (parsed.error) return { status: 'error', message: parsed.error };
    const mode = window.portalLocationsFixture.mode;
    if (mode === 'deferred') await new Promise<void>((resolve) => { window.portalLocationsFixture.complete = resolve; });
    if (mode === 'error') return { status: 'error', message: 'We couldn’t save this location right now. Please try again.' };
    const id = kind === 'edit' ? fields.location_id : `10000000-0000-4000-8000-${String(locations.length + 1).padStart(12, '0')}`;
    const saved = { ...parsed.location, id };
    const next = kind === 'edit' ? locations.map((entry) => entry.id === id ? saved : entry) : [...locations, saved];
    window.portalLocationsFixture.locations = next;
    setLocations(next);
    return { status: 'success', message: kind === 'edit' ? 'Delivery address updated.' : 'Delivery location added. It is ready to use at checkout.' };
  }

  return <main className="mx-auto w-full max-w-5xl space-y-6 px-3 py-6 sm:px-6">
    <header className="panel">
      <span className="eyebrow">Account settings</span>
      <h1 className="page-title mt-4">Delivery locations</h1>
      <p className="page-subtitle mt-3">Add a delivery location or update the address for future orders.</p>
    </header>
    <section className="card space-y-4" aria-label="Add delivery location">
      <h2 className="text-xl font-semibold">Add delivery location</h2>
      <PortalLocationForm action={(previous, data) => save('add', previous, data)} />
    </section>
    <section className="space-y-4" aria-label="Saved delivery locations">
      <h2 className="text-xl font-semibold">Saved delivery locations</h2>
      {locations.map((entry) => <article className="card space-y-4" aria-label={entry.name} key={entry.id}>
        <h3 className="text-lg font-semibold">{entry.name}</h3>
        <address className="not-italic text-sm leading-6 text-slate-600">
          {entry.address1}<br />
          {entry.address2 ? <>{entry.address2}<br /></> : null}
          {entry.city}, {entry.state} {entry.zip}
        </address>
        <details>
          <summary className="cursor-pointer font-semibold text-teal-800">Edit address</summary>
          <div className="mt-4"><PortalLocationForm location={entry} action={(previous, data) => save('edit', previous, data)} /></div>
        </details>
      </article>)}
    </section>
  </main>;
}

createRoot(document.getElementById('fixture-root')!).render(<PortalLocationsFixture />);
