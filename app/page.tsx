import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f4f0' }}>
      <div style={{ width: '100%', maxWidth: 420, padding: 20 }}>
        <div style={{ background: 'white', border: '1px solid #ddd8ce', borderRadius: 16, padding: 36, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🩺</div>
          <h1 style={{ margin: '0 0 8px', fontSize: 26, color: '#1a1714' }}>ClinEval</h1>
          <p style={{ color: '#5a5550', fontSize: 15, marginBottom: 28 }}>Expert clinician evaluation platform</p>
          <Link href="/reviewer" style={{ display: 'block', background: '#1c4f3a', color: 'white', padding: '14px 24px', borderRadius: 10, fontWeight: 600, fontSize: 16, textDecoration: 'none', marginBottom: 12 }}>
            Enter my reviewer code →
          </Link>
          <p style={{ color: '#5a5550', fontSize: 13, marginTop: 20 }}>
            Study team: <a href="mailto:jan-niklas.eckardt@ukdd.de" style={{ color: '#1c4f3a' }}>jan-niklas.eckardt@ukdd.de</a>
          </p>
        </div>
      </div>
    </main>
  );
}
