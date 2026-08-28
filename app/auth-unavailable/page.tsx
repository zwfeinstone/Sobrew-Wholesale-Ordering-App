import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign-in temporarily unavailable',
  robots: { follow: false, index: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function protectedRetryPath(value: string | undefined) {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/login';

  const isPortalPath = value === '/portal' || value.startsWith('/portal/') || value.startsWith('/portal?');
  const isAdminPath = value === '/admin' || value.startsWith('/admin/') || value.startsWith('/admin?');
  return isPortalPath || isAdminPath ? value : '/login';
}

export default function AuthUnavailablePage({ searchParams }: { searchParams: SearchParams }) {
  const retryPath = protectedRetryPath(firstValue(searchParams.next));
  const proposedReference = firstValue(searchParams.ref) ?? '';
  const reference = /^[A-F0-9]{12}$/.test(proposedReference) ? proposedReference : null;

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <section className="panel w-full max-w-lg p-8 sm:p-10" role="alert">
        <div className="eyebrow mb-7">SoBrew</div>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">
          We couldn&apos;t verify your sign-in just now.
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">
          Our sign-in service took too long to respond. Your request did not continue past sign-in verification, so it is
          safe to try again.
        </p>
        <a className="btn-primary mt-7" href={retryPath}>
          Try again
        </a>
        {reference ? (
          <p className="mt-6 text-sm leading-6 text-slate-500">
            If this keeps happening, share reference <span className="font-semibold text-slate-700">{reference}</span>{' '}
            with SoBrew support.
          </p>
        ) : null}
      </section>
    </main>
  );
}
