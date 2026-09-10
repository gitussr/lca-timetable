import type { Metadata, Viewport } from 'next';
import { getViewer } from '@/lib/viewer';
import './globals.css';
import './edit.css';

/**
 * The <head> links the legacy index.html carried in its own <head>.
 * robotBlocker.js is deliberately dropped — it was pinned to a moving branch
 * (`@main`) of a third-party repo, so its author could change the code running
 * on this page at any time (docs/phase-1-assessment.md §3).
 */
export const metadata: Metadata = {
  title: 'LCA Class Timetable',
  description: 'Class timetable for Learn Computer Academy',
  icons: { icon: '/icon-192x192.png' },
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#5b6eff',
};

/**
 * The signed-in user's theme is stamped onto <html> during the server render
 * (§6), so the page paints in the right theme immediately.
 *
 * Applying it from a useEffect instead would paint the localStorage theme (or
 * the default) first and snap to the account's a frame later — the same flash
 * the legacy page had when script.js set data-theme on DOMContentLoaded.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const accountTheme = viewer?.preferredTheme ?? null;

  return (
    <html lang="en" {...(accountTheme ? { 'data-theme': accountTheme } : {})}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css"
        />
      </head>
      <body>
        {/*
          Fallback for anyone the server could not theme: the login screen, and
          a signed-in user who has not chosen one yet. Deliberately defers to an
          attribute already on <html>, so it can never override the account
          preference the server just stamped.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(!document.documentElement.hasAttribute('data-theme')){" +
              "var t=localStorage.getItem('selectedTheme');" +
              "if(t)document.documentElement.setAttribute('data-theme',t);}}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
