import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

type LegalSection = {
  title: string;
  body: ReactNode;
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  intro: string;
  sections: LegalSection[];
};

export function LegalPage({ eyebrow, title, intro, sections }: LegalPageProps) {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-col gap-5 border-b border-[rgba(42,31,23,0.12)] pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/login" className="flex min-w-0 items-center gap-3">
            <span className="brand-mark relative h-12 w-12">
              <Image src="/sobrew-logo.png" alt="Sobrew logo" fill sizes="48px" className="object-contain" priority />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Sobrew Wholesale</span>
              <span className="mt-0.5 block text-sm text-slate-500">Purpose in every pour</span>
            </span>
          </Link>
          <Link href="/login" className="btn-secondary w-full sm:w-auto">
            Back to sign in
          </Link>
        </header>

        <section className="py-10 sm:py-12">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">{intro}</p>
          <p className="mt-5 text-sm font-semibold text-slate-500">Effective date: August 1, 2026</p>
        </section>

        <section className="space-y-5 pb-12">
          {sections.map((section) => (
            <article key={section.title} className="rounded-xl border border-[rgba(42,31,23,0.11)] bg-white/85 p-5 shadow-[0_8px_20px_rgba(42,31,23,0.045)] sm:p-6">
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">{section.body}</div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
