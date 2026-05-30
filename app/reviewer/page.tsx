'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { checkpoints, likertOptions, harmOptionsForQuestion } from '../../lib/questionnaire';

export const dynamic = 'force-dynamic'; 

type Reviewer = { id: string; code: string; display_name: string };
type Assignment = {
  id: string; reviewer_id: string; case_id: string; status: string;
  current_checkpoint: number; questionnaire_enabled?: boolean; cases: any;
};
type CaseSubmission = {
  diagnosis: string; differential_diagnosis: string; recommended_tests: string;
  treatment_plan: string; confidence_score: string; notes: string;
};

const TOTAL_STEPS = checkpoints.length;
const emptyCaseSubmission: CaseSubmission = {
  diagnosis: '', differential_diagnosis: '', recommended_tests: '',
  treatment_plan: '', confidence_score: '', notes: ''
};

function fmt(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Not saved';
}
function safeJsonParse(v: string | null) { try { return JSON.parse(v || ''); } catch { return null; } }
function localDraftKey(reviewerId?: string, assignmentId?: string) {
  return `clineval_draft_${reviewerId}_${assignmentId}`;
}
function visibleQuestions(answers: Record<string, any>) {
  return checkpoints.flatMap(cp => cp.questions).filter((q: any) =>
    !(q.conditional && answers[q.conditional.question] !== q.conditional.value)
  );
}
function countAnswered(answers: Record<string, any>) {
  return visibleQuestions(answers).filter((q: any) => answers[q.id] !== undefined && answers[q.id] !== '').length;
}
function OptionGroup({ value, options, onChange }: any) {
  return <div className="options">{options.map(o => <button key={o} type="button" className={'option ' + (value === o ? 'selected' : '')} onClick={() => onChange(o)}>{o}</button>)}</div>;
}

export default function ReviewerPage() {
  const [code, setCode] = useState('');
  const [reviewer, setReviewer] = useState<Reviewer | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState('');
  const [caseSubmission, setCaseSubmission] = useState<CaseSubmission>(emptyCaseSubmission);
  const [caseSubmissionStatus, setCaseSubmissionStatus] = useState<'draft' | 'submitted' | ''>('');
  const [caseSubmissionSavedAt, setCaseSubmissionSavedAt] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // ---- Helper: save questionnaire progress ----
  async function persist(nextAnswers = answers, nextCheckpoint = checkpointIndex, nextStatus = 'in_progress') {
    if (!assignment || !isOnline) return;
    const now = new Date().toISOString();
    await supabase.from('responses').upsert({
      assignment_id: assignment.id, reviewer_id: assignment.reviewer_id, case_id: assignment.case_id,
      answers: nextAnswers, status: 'draft', updated_at: now
    }, { onConflict: 'assignment_id' });
    await supabase.from('assignments').update({
      current_checkpoint: nextCheckpoint + 1, status: nextStatus, updated_at: now
    }).eq('id', assignment.id);
    setAssignment({ ...assignment, current_checkpoint: nextCheckpoint + 1, status: nextStatus });
    setLastSavedAt(now);
    setHasUnsavedChanges(false);
  }

  // ---- Auto‑save draft every 20 seconds ----
  useEffect(() => {
    if (!assignment || assignment.status === 'submitted') return;
    const timer = setInterval(() => {
      if (hasUnsavedChanges && isOnline) {
        if (!assignment.questionnaire_enabled) saveCaseSubmission('draft', false);
        else persist(answers, checkpointIndex);
      }
    }, 20000);
    return () => clearInterval(timer);
  }, [assignment, answers, caseSubmission, checkpointIndex, hasUnsavedChanges, isOnline]);

  // ---- Login ----
  async function login() {
    setLoading(true);
    const { data: reviewerData, error } = await supabase.from('reviewers').select('*').eq('code', code.trim()).single();
    if (error || !reviewerData) { alert('Reviewer code not found'); setLoading(false); return; }
    setReviewer(reviewerData);
    const { data: assignmentData, error: aerr } = await supabase
      .from('assignments').select('*, cases(*)').eq('reviewer_id', reviewerData.id).single();
    if (aerr || !assignmentData) { alert('No active assignment'); setLoading(false); return; }
    setAssignment(assignmentData);
    setCheckpointIndex(Math.max(0, (assignmentData.current_checkpoint || 1) - 1));
    const { data: responseData } = await supabase.from('responses').select('*').eq('assignment_id', assignmentData.id).single();
    setAnswers(responseData?.answers || {});
    setLastSavedAt(responseData?.updated_at || assignmentData.updated_at);
    const { data: csData } = await supabase.from('case_submissions').select('*').eq('assignment_id', assignmentData.id).maybeSingle();
    if (csData) {
      setCaseSubmission({
        diagnosis: csData.diagnosis || '', differential_diagnosis: csData.differential_diagnosis || '',
        recommended_tests: csData.recommended_tests || '', treatment_plan: csData.treatment_plan || '',
        confidence_score: csData.confidence_score ? String(csData.confidence_score) : '', notes: csData.notes || ''
      });
      setCaseSubmissionStatus(csData.status || 'draft');
      setCaseSubmissionSavedAt(csData.updated_at || csData.submitted_at || '');
    }
    setLoading(false);
  }

  // ---- Save Case Submission (with auto‑enable questionnaire) ----
  async function saveCaseSubmission(status: 'draft' | 'submitted' = 'draft', showAlert = true) {
    if (!assignment || !reviewer) return;
    if (status === 'submitted') {
      if (!caseSubmission.diagnosis.trim()) return alert('Most likely diagnosis is required.');
      if (!caseSubmission.recommended_tests.trim()) return alert('Recommended tests are required.');
      if (!caseSubmission.confidence_score) return alert('Confidence score required.');
    }
    const now = new Date().toISOString();
    const confidence = caseSubmission.confidence_score ? Number(caseSubmission.confidence_score) : null;
    const { error } = await supabase.from('case_submissions').upsert({
      assignment_id: assignment.id, reviewer_id: reviewer.id, case_id: assignment.case_id,
      diagnosis: caseSubmission.diagnosis, differential_diagnosis: caseSubmission.differential_diagnosis,
      recommended_tests: caseSubmission.recommended_tests, treatment_plan: caseSubmission.treatment_plan,
      confidence_score: confidence, notes: caseSubmission.notes, status,
      updated_at: now, submitted_at: status === 'submitted' ? now : null
    }, { onConflict: 'assignment_id' });
    if (error) return alert(error.message);
    setCaseSubmissionStatus(status);
    setCaseSubmissionSavedAt(now);
    setHasUnsavedChanges(false);
    // 🔁 AUTO-ACTIVATE QUESTIONNAIRE after submission
    if (status === 'submitted') {
      await supabase.from('assignments').update({ questionnaire_enabled: true, updated_at: now }).eq('id', assignment.id);
      setAssignment({ ...assignment, questionnaire_enabled: true });
      alert('✅ Case submitted! The Expert Questionnaire is now available on this page.');
      await supabase.from('reviewer_audit_log').insert({
        assignment_id: assignment.id, reviewer_id: reviewer.id, case_id: assignment.case_id,
        event_type: 'case_submission_auto_enabled_questionnaire', created_at: now
      });
    } else if (showAlert) alert('Draft saved.');
  }

  // ---- Download Case Submission as JSON ----
  function downloadCaseSubmission() {
    const payload = {
      reviewer_code: reviewer?.code,
      case_code: assignment?.cases?.case_code,
      submitted_at: caseSubmissionSavedAt,
      status: caseSubmissionStatus,
      ...caseSubmission
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reviewer?.code}_${assignment?.cases?.case_code}_case_submission.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Download full annotation (questionnaire) ----
  function downloadFullAnnotation() {
    const payload = {
      reviewer_code: reviewer?.code, case_code: assignment?.cases?.case_code,
      assignment_status: assignment?.status, current_checkpoint: (checkpointIndex + 1),
      answers, exported_at: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reviewer?.code}_${assignment?.cases?.case_code}_annotation.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Questionnaire answer handlers ----
  async function saveAnswer(questionId: string, value: any) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    setHasUnsavedChanges(true);
    await persist(next);
  }
  async function saveDraft() { await persist(); alert('Draft saved.'); }
  async function submitFinal() {
    if (!confirm('Submit final evaluation? This will lock the assignment.')) return;
    const now = new Date().toISOString();
    await supabase.from('responses').upsert({
      assignment_id: assignment!.id, answers, status: 'submitted', submitted_at: now, updated_at: now
    }, { onConflict: 'assignment_id' });
    await supabase.from('assignments').update({ status: 'submitted', updated_at: now }).eq('id', assignment!.id);
    alert('Evaluation submitted. Thank you!');
    setAssignment({ ...assignment!, status: 'submitted' });
  }

  // ---- Progress indicator ----
  const answeredCount = countAnswered(answers);
  const totalVisible = visibleQuestions(answers).length;
  const progressPercent = assignment?.questionnaire_enabled
    ? (answeredCount / (totalVisible || 1)) * 100
    : (caseSubmission.diagnosis ? 25 : 0) + (caseSubmission.recommended_tests ? 25 : 0) + (caseSubmission.confidence_score ? 25 : 0) + (caseSubmission.differential_diagnosis ? 25 : 0);

  // ---- Render logic (login, no assignment, submitted, case inactive, etc.) ----
  if (!reviewer) return (
    <main className="container"><div className="card"><h1>ClinEval reviewer access</h1>
      <input className="input" value={code} onChange={e => setCode(e.target.value)} placeholder="Reviewer code (e.g. PROF_01)" />
      <button className="btn btn-primary" onClick={login} disabled={loading}>Continue</button>
    </div></main>
  );
  if (!assignment) return <main className="container"><div className="card"><h1>No active assignment</h1></div></main>;
  if (assignment.status === 'submitted') return <SubmittedView assignment={assignment} reviewer={reviewer} answers={answers} caseSubmission={caseSubmission} downloadAnnotation={downloadFullAnnotation} correctionMessage={correctionMessage} setCorrectionMessage={setCorrectionMessage} />;
  if (!assignment.cases?.is_active) return <main className="container"><div className="card"><h1>Case not yet released</h1><p>Please wait for the study coordinator to activate the case.</p></div></main>;

  // ---- Case Submission view (if questionnaire not enabled) ----
  if (!assignment.questionnaire_enabled) {
    return (
      <main>
        <div className="topbar"><strong>ClinEval</strong><div className="topbar-right"><span className="badge">{caseSubmissionStatus === 'submitted' ? 'Submitted' : 'Case submission'}</span><span className="small">Last saved: {fmt(caseSubmissionSavedAt)}</span><button className="btn btn-secondary btn-small" onClick={() => saveCaseSubmission('draft')}>Save draft</button><button className="btn btn-secondary btn-small" onClick={downloadCaseSubmission}>⬇️ Download my assessment</button></div></div>
        <div className="container">
          <div className="card"><h1>📝 Independent Case Submission</h1><p className="small">Reviewer: {reviewer.display_name} | Case: {assignment.cases?.case_code}</p><div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPercent}%` }} /></div><p className="small">Completion: {Math.round(progressPercent)}%</p></div>
          <div className="card"><h2>Case vignette</h2><p>{assignment.cases?.vignette_cp1}</p></div>
          <div className="card">
            <h2>Your independent clinical assessment</h2>
            <label>Most likely diagnosis *</label><textarea className="input" value={caseSubmission.diagnosis} onChange={e => { setCaseSubmission({ ...caseSubmission, diagnosis: e.target.value }); setHasUnsavedChanges(true); }} disabled={caseSubmissionStatus === 'submitted'} onBlur={() => saveCaseSubmission('draft', false)} />
            <label>Differential diagnosis</label><textarea className="input" value={caseSubmission.differential_diagnosis} onChange={e => { setCaseSubmission({ ...caseSubmission, differential_diagnosis: e.target.value }); setHasUnsavedChanges(true); }} disabled={caseSubmissionStatus === 'submitted'} onBlur={() => saveCaseSubmission('draft', false)} />
            <label>Recommended diagnostic tests *</label><textarea className="input" value={caseSubmission.recommended_tests} onChange={e => { setCaseSubmission({ ...caseSubmission, recommended_tests: e.target.value }); setHasUnsavedChanges(true); }} disabled={caseSubmissionStatus === 'submitted'} onBlur={() => saveCaseSubmission('draft', false)} />
            <label>Initial treatment plan</label><textarea className="input" value={caseSubmission.treatment_plan} onChange={e => { setCaseSubmission({ ...caseSubmission, treatment_plan: e.target.value }); setHasUnsavedChanges(true); }} disabled={caseSubmissionStatus === 'submitted'} onBlur={() => saveCaseSubmission('draft', false)} />
            <label>Confidence score (1–5) *</label><input className="input" type="number" min="1" max="5" value={caseSubmission.confidence_score} onChange={e => { setCaseSubmission({ ...caseSubmission, confidence_score: e.target.value }); setHasUnsavedChanges(true); }} disabled={caseSubmissionStatus === 'submitted'} onBlur={() => saveCaseSubmission('draft', false)} />
            <label>Notes (optional)</label><textarea className="input" value={caseSubmission.notes} onChange={e => { setCaseSubmission({ ...caseSubmission, notes: e.target.value }); setHasUnsavedChanges(true); }} disabled={caseSubmissionStatus === 'submitted'} onBlur={() => saveCaseSubmission('draft', false)} />
            {caseSubmissionStatus === 'submitted' ? (
              <div className="warning"><strong>✓ Submitted.</strong> The Expert Questionnaire is now active.</div>
            ) : (
              <div className="row"><button className="btn btn-secondary" onClick={() => saveCaseSubmission('draft')}>Save draft</button><button className="btn btn-primary" onClick={() => saveCaseSubmission('submitted')}>Submit & continue to questionnaire</button></div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ---- Questionnaire view (checkpoint based) ----
  const cp = checkpoints[checkpointIndex];
  const stepNumber = checkpointIndex + 1;
  return (
    <main>
      <div className="topbar"><strong>ClinEval</strong><div className="topbar-right"><span className="badge">{assignment.status === 'submitted' ? 'Submitted' : 'In progress'}</span><span className="small">Last saved: {fmt(lastSavedAt)}</span><button className="btn btn-secondary btn-small" onClick={saveDraft}>Save draft</button><button className="btn btn-secondary btn-small" onClick={downloadFullAnnotation}>⬇️ Download annotation</button></div></div>
      <div className="container">
        <div className="card"><h1>{cp.title}</h1><div className="progress-meta"><span>Checkpoint {stepNumber} of 4</span><span>{answeredCount} of {totalVisible} answered</span><span>Progress: {Math.round((answeredCount/totalVisible)*100)}%</span></div><div className="progress-bar"><div className="progress-fill" style={{ width: `${((stepNumber-1)/4)*100}%` }} /></div><div className="warning"><strong>IMPORTANT:</strong> {cp.instruction}</div></div>
        <div className="card"><h3>Case vignette</h3><p>{assignment.cases?.[`vignette_${cp.id}`]}</p><h3>Model output</h3><p>{assignment.cases?.[`model_output_${cp.id}`]}</p></div>
        <div className="card">
          <h3>Expert Questionnaire</h3><p className="small">Likert: 1=Strongly disagree … 5=Strongly agree · N/A</p>
          {cp.questions.map((q: any) => {
            if (q.conditional && answers[q.conditional.question] !== q.conditional.value) return null;
            return <div className="question" key={q.id}><strong>{q.text}</strong>{q.description && <p className="small">{q.description}</p>}
              {q.type === 'likert' && <OptionGroup value={answers[q.id]} options={likertOptions} onChange={v => saveAnswer(q.id, v)} />}
              {q.type === 'yesno' && <OptionGroup value={answers[q.id]} options={['Yes','No']} onChange={v => saveAnswer(q.id, v)} />}
              {q.type === 'harm' && <><OptionGroup value={answers[q.id]} options={harmOptionsForQuestion(q.id)} onChange={v => saveAnswer(q.id, v)} />
                {answers[q.id] === 'Severe harm likely' && <textarea className="input harm-explanation" placeholder="Explain potential harm" value={answers[q.id+'_explanation'] || ''} onChange={e => saveAnswer(q.id+'_explanation', e.target.value)} />}</>}
              {q.type === 'text' && <textarea className="input" value={answers[q.id] || ''} onChange={e => saveAnswer(q.id, e.target.value)} onBlur={() => persist()} placeholder="Free text" />}
            </div>;
          })}
          <div className="question"><strong>Private reviewer notes</strong><textarea className="input" value={answers[`private_notes_step_${stepNumber}`] || ''} onChange={e => saveAnswer(`private_notes_step_${stepNumber}`, e.target.value)} placeholder="Optional notes for yourself" /></div>
          <div className="row nav-row">
            <button className="btn btn-secondary" disabled={checkpointIndex === 0} onClick={() => setCheckpointIndex(checkpointIndex-1)}>Back</button>
            <button className="btn btn-secondary" onClick={saveDraft}>Save draft</button>
            {checkpointIndex < TOTAL_STEPS-1 ? <button className="btn btn-primary" onClick={() => { persist(); setCheckpointIndex(checkpointIndex+1); }}>Save & continue</button> : <button className="btn btn-primary" onClick={submitFinal}>Final submit</button>}
          </div>
        </div>
      </div>
    </main>
  );
}

function SubmittedView({ assignment, reviewer, answers, caseSubmission, downloadAnnotation, correctionMessage, setCorrectionMessage }: any) {
  const [msg, setMsg] = useState(correctionMessage);
  const sendCorrection = async () => {
    if (!msg.trim()) return alert('Write a message first');
    await supabase.from('reviewer_messages').insert({ assignment_id: assignment.id, reviewer_id: reviewer.id, case_id: assignment.case_id, message: msg.trim(), message_type: 'correction_request' });
    alert('Sent to study coordinator');
    setMsg('');
    setCorrectionMessage('');
  };
  return <main className="container"><div className="card"><h1>Evaluation submitted</h1><p>Thank you for completing the study.</p><button className="btn btn-secondary" onClick={downloadAnnotation}>Download my annotation</button><div className="card"><h2>Your independent case submission</h2><pre>{JSON.stringify(caseSubmission, null, 2)}</pre></div><div className="card"><h2>Your questionnaire answers</h2><pre>{JSON.stringify(answers, null, 2)}</pre></div><div className="card"><h2>Correction note</h2><textarea className="input" value={msg} onChange={e => setMsg(e.target.value)} placeholder="If you notice a mistake, describe it here..." /><button className="btn btn-primary" onClick={sendCorrection}>Send correction note</button></div></div></main>;
}