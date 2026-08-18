import type { Metadata, Viewport } from 'next';
import './globals.css';

// Phase 16 — PWA (master spec §62: "Where appropriate, configure the web
// application as a Progressive Web App... Staff dashboards should work well
// on tablets. Kitchen interface should work well on large displays/
// tablets."). This app never triggers §61's native mobile app strategy (no
// Expo/React Native build exists, by design — see docs/architecture.md §
// Phase 14 and CLAUDE.md → Known Issues) — what §62 asks for instead is
// installability for the tablet-based staff/kitchen use case, which is what
// `public/manifest.json` + the metadata below provide: "Add to Home Screen"
// on a kitchen display or a server's tablet, launching standalone (no
// browser chrome) at /dashboard. This is NOT a substitute for a native App
// Store/Play Store listing — there is no native binary to submit, so that
// half of §61/§62's "Store configuration" bullet is explicitly N/A here;
// see docs/deployment/README.md for the full explanation.
export const metadata: Metadata = {
  title: 'Restaurant Platform',
  description: 'Restaurant reservations, ordering, catering, CRM & financial intelligence.',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/favicon.ico' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Restaurant Platform',
  },
};

export const viewport: Viewport = {
  themeColor: '#101828', // matches --primary in app/globals.css
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
