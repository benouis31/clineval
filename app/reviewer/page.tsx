'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { checkpoints, likertOptions, harmOptionsForQuestion } from '../../lib/questionnaire';

type Reviewer = { id: string; code: string; display_name: string };
type Assignment = { id: string; reviewer_id: string; case_id: string; status: string; current_checkpoint: number; cases: any };

const TOTAL_STEPS = checkpoints.length;

function OptionGroup({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return <div className="options">{options.map(o => <button key={o} type="button" className={'option ' + (value === o ? 'selected' : '')} onClick={() => onChange(o)}>{o}</button>)}</div>;
}

function formatTime(value?: string) {
  if (!value) return 'Not yet saved';
  return new Date(value).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}

function visibleQuestions(answers: Record<string, any>) {
  return checkpoints.flatMap(cp => cp.questions).filter((q: any) => !(q.conditional && answers[q.conditional.question] !== q.conditional.value));
}

function countAnswered(answers: Record<string, any>) {
  return visibleQuestions(answers).filter((q: any) => answers[q.id] !== undefined && answers[q.id] !== '').length;
}

export default function ReviewerPage() {
  const [code, setCode] = useState('');
  const [reviewer, setReviewer] = useState<Reviewer | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [saved, setSaved] = useState('Not saved');
  const [lastSavedAt, setLastSavedAt] = useState<string>('');
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true);
    const { data: reviewerData, error } = await supabase.from('reviewers').select('*').eq('code', code.trim()).single();
    setLoading(false);
    if (error || !reviewerData) { alert('Reviewer code not found'); return; }
    setReviewer(reviewerData);

    const { data: assignmentData, error: aerr } = await supabase
      .from('assignments')
      .select('*, cases(*)')
      .eq('reviewer_id', reviewerData.id)
      .neq('status', 'submitted')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (aerr || !assignmentData) { alert('No active assignment found'); return; }
    setAssignment(assignmentData);
    setCheckpointIndex(Math.max(0, Math.min(TOTAL_STEPS - 1, (assignmentData.current_checkpoint || 1) - 1)));

    const { data: responseData } = await supabase.from('responses').select('*').eq('assignment_id', assignmentData.id).single();
    setAnswers(responseData?.answers || {});
    setLastSavedAt(responseData?.updated_at || assignmentData.updated_at || '');
    setSaved(responseData?.updated_at ? 'Saved' : 'Ready');
  }

  async function persist(nextAnswers = answers, nextCheckpointIndex = checkpointIndex, nextStatus = 'in_progress') {
    if (!assignment) return;
    setSaved('Saving...');
    const now = new Date().toISOString();
    await supabase.from('responses').upsert({
      assignment_id: assignment.id,
      reviewer_id: assignment.reviewer_id,
      case_id: assignment.case_id,
      answers: nextAnswers,
      status: 'draft',
      updated_at: now
    }, { onConflict: 'assignment_id' });
    await supabase.from('assignments').update({ current_checkpoint: nextCheckpointIndex + 1, status: nextStatus, updated_at: now }).eq('id', assignment.id);
    setAssignment({ ...assignment, current_checkpoint: nextCheckpointIndex + 1, status: nextStatus });
    setLastSavedAt(now);
    setSaved('Saved');
  }

  async function saveAnswer(questionId: string, value: any) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    await persist(next);
  }

  async function saveDraft() {
    await persist(answers, checkpointIndex);
    alert('Draft saved. You can close the browser and return later with the same reviewer code.');
  }

  async function goToStep(nextIndex: number) {
    const safeIndex = Math.max(0, Math.min(TOTAL_STEPS - 1, nextIndex));
    setCheckpointIndex(safeIndex);
    await persist(answers, safeIndex);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function downloadMyAnnotation() {
    if (!assignment || !reviewer) return;

    const payload = {
      reviewer_code: reviewer.code,
      reviewer_name: reviewer.display_name,
      case_code: assignment.cases?.case_code,
      case_title: assignment.cases?.title,
      assignment_status: assignment.status,
      current_checkpoint: checkpointIndex + 1,
      answers,
      exported_at: new Date().toISOString()
    };

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${reviewer.code}_${assignment.cases?.case_code}_annotation.json`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  async function submitFinal() {
    if (!assignment) return;
    const confirmSubmit = window.confirm('Submit final evaluation? After final submission, this assignment will be locked for the reviewer.');
    if (!confirmSubmit) return;
    const now = new Date().toISOString();
    await supabase.from('responses').upsert({
      assignment_id: assignment.id,
      reviewer_id: assignment.reviewer_id,
      case_id: assignment.case_id,
      answers,
      status: 'submitted',
      updated_at: now,
      submitted_at: now
    }, { onConflict: 'assignment_id' });
    await supabase.from('assignments').update({ status: 'submitted', current_checkpoint: 5, updated_at: now }).eq('id', assignment.id);
    alert('Evaluation submitted. Thank you.');
    setAssignment(null);
  }

  if (!reviewer) return <main className="container"><div className="card"><h1>ClinEval reviewer access</h1><p>Enter your reviewer code.</p><input className="input" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. PROF_01" onKeyDown={e => { if (e.key === 'Enter') login(); }} /><br/><br/><button className="btn btn-primary" onClick={login} disabled={loading}>{loading ? 'Checking...' : 'Continue'}</button></div></main>;

  if (!assignment) return <main className="container"><div className="card"><h1>No active assignment</h1><p>Contact the study coordinator.</p></div></main>;

  const cp = checkpoints[checkpointIndex];
  const caseData = assignment.cases;
  const vignette = caseData?.[`vignette_${cp.id}`];
  const modelOutput = caseData?.[`model_output_${cp.id}`];
  const stepNumber = checkpointIndex + 1;
  const progressPct = Math.round(((stepNumber - 1) / TOTAL_STEPS) * 100);
  const answered = countAnswered(answers);
  const totalVisible = visibleQuestions(answers).length;

  return <main>
    <div className="topbar"><strong>ClinEval</strong><div className="topbar-right"><span className="badge">{saved}</span><span className="small">Last saved: {formatTime(lastSavedAt)}</span><button className="btn btn-secondary btn-small" onClick={saveDraft}>Save draft</button><button className="btn btn-secondary btn-small" onClick={downloadMyAnnotation}>Download annotation</button></div></div>
    <div className="container">
      <div className="card">
        <div className="small">Reviewer: {reviewer.display_name} | Case: {caseData?.case_code} | Model: blinded</div>
        <h1>{cp.title}</h1>
        <div className="progress-meta"><span>Checkpoint {stepNumber} of 4</span><span>{answered} of {totalVisible} visible questions answered</span><span>Estimated remaining time: {Math.max(2, (TOTAL_STEPS - stepNumber + 1) * 3)}–{Math.max(4, (TOTAL_STEPS - stepNumber + 1) * 5)} min</span></div>
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
        <div className="warning"><strong>IMPORTANT:</strong><br />{cp.instruction}<br />Evaluate ONLY the information displayed on this page.</div>
      </div>
      <div className="card"><h3>Case vignette</h3><p>{vignette}</p><h3>Model output</h3><p>{modelOutput}</p></div>
      <div className="card">
        <h3>Expert Questionnaire</h3>
        <p className="small">Likert scale: 1 = Strongly disagree · 2 = Disagree · 3 = Neutral / Undecided · 4 = Agree · 5 = Strongly agree · Not applicable</p>
        {cp.questions.map((q: any) => {
          if (q.conditional && answers[q.conditional.question] !== q.conditional.value) return null;
          return <div className="question" key={q.id}>
            <strong>{q.text}</strong>
            {q.description && <p className="small">{q.description}</p>}
            {q.type === 'likert' && <OptionGroup value={answers[q.id]} options={likertOptions} onChange={v => saveAnswer(q.id, v)} />}
            {q.type === 'yesno' && <OptionGroup value={answers[q.id]} options={['Yes', 'No']} onChange={v => saveAnswer(q.id, v)} />}
            {q.type === 'harm' && <><OptionGroup value={answers[q.id]} options={harmOptionsForQuestion(q.id)} onChange={v => saveAnswer(q.id, v)} />{answers[q.id] === 'Severe harm likely' && <textarea className="input harm-explanation" placeholder="Optional: briefly explain the potential source of harm." value={answers[q.id + '_explanation'] || ''} onChange={e => saveAnswer(q.id + '_explanation', e.target.value)} />}</>}
            {q.type === 'text' && <textarea className="input" value={answers[q.id] || ''} onChange={e => saveAnswer(q.id, e.target.value)} placeholder="Free text" />}
          </div>;
        })}
        <div className="question"><strong>Private reviewer notes</strong><p className="small">Optional. These are saved for your own review and are not part of the primary questionnaire.</p><textarea className="input" value={answers[`private_notes_step_${stepNumber}`] || ''} onChange={e => saveAnswer(`private_notes_step_${stepNumber}`, e.target.value)} placeholder="Private notes for yourself..." /></div>
        <br />
        <div className="row nav-row"><button className="btn btn-secondary" disabled={checkpointIndex === 0} onClick={() => goToStep(checkpointIndex - 1)}>Back</button><button className="btn btn-secondary" onClick={saveDraft}>Save draft</button><button className="btn btn-secondary" onClick={downloadMyAnnotation}>Download annotation</button>{checkpointIndex < checkpoints.length - 1 ? <button className="btn btn-primary" onClick={() => goToStep(checkpointIndex + 1)}>Save & continue</button> : <button className="btn btn-primary" onClick={submitFinal}>Final submit</button>}</div>
      </div>
    </div>
  </main>;
}