import './globals.css';
import { ReactNode } from 'react';
import { Manrope } from 'next/font/google';
import { ButtonPressLock } from '@/components/button-press-lock';
import { NumberInputScrollGuard } from '@/components/number-input-scroll-guard';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata = {
  title: 'Sobrew Wholesale Portal',
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/sobrew-logo.png',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <ButtonPressLock />
        <NumberInputScrollGuard />
        {children}
      </body>
    </html>
  );
}
