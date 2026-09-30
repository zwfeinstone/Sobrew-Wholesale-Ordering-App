import { createRoot } from 'react-dom/client';
import { UserWizard } from '@/components/user-wizard';
import '@/app/globals.css';

declare global {
  interface Window {
    customerWizardFixture: { submissions: Record<string, string>[] };
  }
}

window.customerWizardFixture = { submissions: [] };

// React's root handler runs first, so record only submissions it permits. Every
// native POST is prevented here; no customer, email, or QuickBooks API is called.
document.addEventListener('submit', (event) => {
  if (!(event.target instanceof HTMLFormElement) || event.defaultPrevented) return;
  event.preventDefault();
  window.customerWizardFixture.submissions.push(Object.fromEntries(
    Array.from(new FormData(event.target).entries(), ([name, value]) => [name, String(value)]),
  ));
});

createRoot(document.getElementById('fixture-root')!).render(
  <main className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-6">
    <section className="panel">
      <span className="eyebrow">Center Admin</span>
      <h1 className="page-title mt-4">Create center wizard</h1>
      <p className="page-subtitle mt-3">Add the customer’s address, first login, and invoice recipients, choose their order guide, and connect them to QuickBooks.</p>
    </section>
    <UserWizard products={[]} />
  </main>,
);
