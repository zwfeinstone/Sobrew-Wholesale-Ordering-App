import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function PasswordRecoveryShell({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <main className="login-shell">
      <div className="login-card">
        <section className="login-form-panel">
          <div className="login-form">
            <div className="login-mobile-brand">
              <div className="brand-mark h-12 w-12">
                <Image src="/sobrew-logo.png" alt="Sobrew logo" fill sizes="48px" className="object-contain" priority />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Sobrew Coffee Wholesale</p>
                <p className="mt-0.5 text-xs text-slate-500">Purpose in every pour</p>
              </div>
            </div>
            <div>
              <p className="login-kicker">Account access</p>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            {children}
            <Link className="text-center text-sm font-semibold text-teal-800 underline underline-offset-4" href="/login">Back to sign in</Link>
            <div className="login-legal-links">
              <Link href="/privacy">Privacy Policy</Link>
              <span aria-hidden="true">/</span>
              <Link href="/eula">End-User License Agreement</Link>
            </div>
          </div>
        </section>
        <section className="login-story-panel">
          <div className="login-desktop-brand">
            <div className="brand-mark h-16 w-16">
              <Image src="/sobrew-logo.png" alt="" fill sizes="64px" className="object-contain" />
            </div>
            <div>
              <p>Purpose in every pour</p>
              <span>Sobrew Coffee Wholesale</span>
            </div>
          </div>
          <div>
            <h2>Coffee that moves recovery forward.</h2>
            <p>Every wholesale order helps someone take another step toward recovery. A portion of every purchase directly supports the recovery community.</p>
          </div>
          <p className="login-story-footnote">Community impact is built into every purchase.</p>
        </section>
      </div>
    </main>
  );
}
