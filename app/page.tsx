import Link from 'next/link';

export default function Home() {
  return <main className="container">
    <div className="card">
      <h1>ClinEval</h1>
      <p>Hosted clinician-adjudicated LLM evaluation platform.</p>
      <div className="row">
        <Link className="btn btn-primary" href="/reviewer">Expert Questionnaire</Link>
        <Link className="btn btn-secondary" href="/case-submission">Case Submission</Link>
        <Link className="btn btn-secondary" href="/admin">Admin Dashboard</Link>
      </div>
    </div>
  </main>;
}
