import Link from 'next/link';

export default function Home() {
  return (
    <main className="container">
      <div className="card">
        <h1>ClinEval</h1>
        <p>Hosted clinician-adjudicated LLM evaluation platform.</p>
        {/* FIX: added aria-label on each link — <a> wrapping styled divs had no accessible name */}
        <div className="row">
          <Link
            className="btn btn-primary"
            href="/reviewer"
            aria-label="Open expert questionnaire"
          >
            Expert Questionnaire
          </Link>
          <Link
            className="btn btn-secondary"
            href="/case-submission"
            aria-label="Open case submission form"
          >
            Case Submission
          </Link>
          <Link
            className="btn btn-secondary"
            href="/admin"
            aria-label="Open admin dashboard"
          >
            Admin Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
