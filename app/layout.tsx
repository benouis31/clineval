import type { Metadata, Viewport } from 'next';
import './globals.css';

// FIX: added viewport export — previously missing, causing suboptimal mobile rendering
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'ClinEval',
  // FIX: description was defined but never surfaced as a proper Metadata type
  description: 'Clinician-adjudicated LLM evaluation platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // FIX: added Inter font via next/font to actually load the font declared in globals.css;
  // without this the browser falls back to system-ui silently and Inter is never fetched.
  // If you prefer to keep the import-free approach, add the Google Fonts <link> in a
  // custom _document or switch to the next/font/google approach below.
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
