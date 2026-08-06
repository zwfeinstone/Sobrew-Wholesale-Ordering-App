import Image from 'next/image';
import Link from 'next/link';
import LoginSubmitButton from '@/components/login-submit-button';
import { login } from './actions';

const coffeePortalStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Sobrew Coffee Wholesale Ordering Portal',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://app.sobrew.com/',
  description:
    'Online ordering portal for Sobrew specialty coffee customers and wholesale coffee programs for recovery centers, offices, churches, restaurants, and organizations.',
  publisher: {
    '@type': 'Organization',
    name: 'Sobrew Coffee',
    url: 'https://sobrew.com/',
  },
  offers: {
    '@type': 'OfferCatalog',
    name: 'Wholesale coffee products',
    itemListElement: [
      {
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Product',
          name: 'Wholesale specialty coffee',
          category: 'Coffee',
        },
      },
    ],
  },
};

type LoginViewProps = {
  credentialsError?: boolean;
  inactive?: boolean;
  profileError?: boolean;
};

export function LoginView({ credentialsError = false, inactive = false, profileError = false }: LoginViewProps) {
  return (
    <main className="login-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(coffeePortalStructuredData) }}
      />
      <div className="login-card">
        <section className="login-form-panel">
          <form action={login} className="login-form">
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
              <p className="login-kicker">Wholesale portal</p>
              <h1>Welcome back</h1>
              <p>Sign in to restock, review orders, and manage recurring shipments.</p>
            </div>
            {credentialsError ? <p className="login-alert is-error" role="alert">We couldn&apos;t sign you in with those credentials.</p> : null}
            {profileError ? <p className="login-alert" role="alert">We couldn&apos;t load your account profile. Try again in a moment or contact Sobrew if it continues.</p> : null}
            {inactive ? <p className="login-alert" role="alert">Your account is inactive. Please contact Sobrew for access.</p> : null}
            <div className="login-fields">
              <div>
                <label htmlFor="login-email">Email address</label>
                <input id="login-email" className="input bg-white" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
              </div>
              <div>
                <label htmlFor="login-password">Password</label>
                <input id="login-password" className="input bg-white" name="password" type="password" autoComplete="current-password" required placeholder="Enter your password" />
              </div>
            </div>
            <LoginSubmitButton />
            <div className="login-legal-links">
              <Link href="/privacy">Privacy Policy</Link>
              <span aria-hidden="true">/</span>
              <Link href="/eula">End-User License Agreement</Link>
            </div>
          </form>
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
