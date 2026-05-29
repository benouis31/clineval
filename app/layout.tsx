import './globals.css';

export const metadata = {
  title: 'ClinEval',
  description: 'Clinician-adjudicated LLM evaluation platform'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
