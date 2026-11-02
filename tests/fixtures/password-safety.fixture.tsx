import { createRoot } from 'react-dom/client';
import CustomerLoginForms from '@/components/customer-login-forms';
import '@/app/globals.css';

declare global {
  interface Window {
    passwordSafetyFixture: { submissions: { action: string; values: Record<string, string> }[] };
  }
}
window.passwordSafetyFixture = { submissions: [] };
function capture(action: string) {
  return async (data: FormData) => {
    window.passwordSafetyFixture.submissions.push({ action, values: Object.fromEntries(Array.from(data.entries(), ([key, value]) => [key, String(value)])) });
  };
}

createRoot(document.getElementById('fixture-root')!).render(
  <main className="mx-auto max-w-5xl space-y-6 px-3 py-6 sm:px-6">
    <h1 className="page-title">Customer logins</h1>
    <section className="card space-y-4">
      <h2 className="text-xl font-semibold">Test Buyer</h2>
      <CustomerLoginForms centerId="center-1" member={{ id: 'user-1', email: 'buyer@example.test', full_name: 'Test Buyer', is_active: true }}
        saveAction={capture('save')} resetAction={capture('reset')} removeAction={capture('remove')} />
    </section>
  </main>,
);
