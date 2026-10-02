import type { Metadata, Viewport } from 'next';

import { Providers } from '@/app/providers';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'DuskProof Guard',
    template: '%s · DuskProof Guard',
  },
  description: 'Real-time monitoring, alerting and remote control for your VPS/VDS fleet.',
  applicationName: 'DuskProof Guard',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon.svg' }],
  },
  appleWebApp: {
    capable: true,
    title: 'DuskProof Guard',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
  ],
};

/**
 * Applies the persisted theme before first paint so the dark UI never flashes
 * white on reload.
 */
const themeScript = `
(function () {
  try {
    var stored = window.localStorage.getItem('vpsguard.ui');
    var theme = 'dark';
    if (stored) {
      var parsed = JSON.parse(stored);
      if (parsed && parsed.state && parsed.state.theme) theme = parsed.state.theme;
    }
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  } catch (error) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="scrollbar-thin">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
