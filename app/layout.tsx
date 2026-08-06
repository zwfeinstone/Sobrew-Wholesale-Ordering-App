import './globals.css';
import type { Metadata } from 'next';
import { ReactNode } from 'react';
import { Manrope } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ButtonPressLock } from '@/components/button-press-lock';
import { NumberInputScrollGuard } from '@/components/number-input-scroll-guard';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
});

const appUrl = 'https://app.sobrew.com';
const title = 'Sobrew Coffee Wholesale Ordering Portal';
const description =
  'Online ordering portal for Sobrew specialty coffee customers, including wholesale coffee programs for recovery centers, offices, churches, restaurants, and organizations.';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: 'Sobrew Coffee Wholesale',
  category: 'Food and Drink',
  title: {
    default: title,
    template: '%s | Sobrew Coffee Wholesale',
  },
  description,
  keywords: [
    'Sobrew coffee',
    'specialty coffee',
    'wholesale coffee',
    'coffee ordering portal',
    'recovery center coffee',
    'office coffee',
    'restaurant coffee',
    'coffee service',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title,
    description,
    url: appUrl,
    siteName: 'Sobrew Coffee Wholesale',
    images: [
      {
        url: '/sobrew-logo.png',
        width: 512,
        height: 512,
        alt: 'Sobrew coffee logo',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title,
    description,
    images: ['/sobrew-logo.png'],
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/sobrew-logo.png',
  },
  manifest: '/manifest.webmanifest',
  other: {
    'business:industry': 'Specialty coffee wholesale',
    'product:category': 'Coffee',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <ButtonPressLock />
        <NumberInputScrollGuard />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
