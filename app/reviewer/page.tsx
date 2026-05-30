'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { checkpoints, likertOptions, harmOptionsForQuestion } from '../../lib/questionnaire';

type Reviewer = { id: string; code: string; display_name: string };

type Assignment = {
  id: string;
  reviewer_id: string;
  case_id: string;
  status: string;
  current_checkpoint: number;
  questionnaire_enabled?: boolean;
  cases: any;
};

type CaseSubmission = {
  diagnosis: string;
  differential_diagnosis: string;
  recommended_tests: string;
  treatment_plan: string;
  confidence_score: string;
  notes: string;
};

const TOTAL_STEPS = checkpoints.length;

const emptyCaseSubmission: CaseSubmission = {
  diagnosis: '',
  differential_diagnosis: '',
  recommended_tests: '',
  treatment_plan: '',
  confidence_score: '',
  notes: ''
};

function safeJsonParse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function localDraftKey(reviewerId?: string, assignmentId?: string) {
  if (!reviewerId || !assignmentId) return '';
  return `clineval_draft_${reviewerId}_${assignmentId}`;
}

function submissionReceiptCode(assignmentId: string) {
  return `REV-${new Date().getFullYear()}-${assignmentId.slice(0, 8).toUpperCase()}`;
}


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
  const [correctionMessage, setCorrectionMessage] = useState('');
  const [caseSubmission, setCaseSubmission] = useState<CaseSubmission>(emptyCaseSubmission);
  const [caseSubmissionStatus, setCaseSubmissionStatus] = useState<'draft' | 'submitted' | ''>('');
  const [caseSubmissionSavedAt, setCaseSubmissionSavedAt] = useState<string>('');
  const [isOnline, setIsOnline] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [submissionReceipt, setSubmissionReceipt] = useState('');


  useEffect(() => {
    setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);

    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = '';
      }
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!assignment || !reviewer) return;

    const key = localDraftKey(reviewer.id, assignment.id);
    const localDraft = safeJsonParse(localStorage.getItem(key));

    if (localDraft && localDraft.answers && Object.keys(answers).length === 0) {
      const restore = window.confirm('A local draft was found on this device. Restore it?');
      if (restore) {
        setAnswers(localDraft.answers || {});
        setCaseSubmission(localDraft.caseSubmission || emptyCaseSubmission);
        setCaseSubmissionStatus(localDraft.caseSubmissionStatus || '');
        setHasUnsavedChanges(true);
      }
    }
  }, [assignment?.id, reviewer?.id]);

  useEffect(() => {
    if (!assignment || !reviewer) return;

    const key = localDraftKey(reviewer.id, assignment.id);
    localStorage.setItem(key, JSON.stringify({
      answers,
      caseSubmission,
      caseSubmissionStatus,
      checkpointIndex,
      savedAt: new Date().toISOString()
    }));
  }, [answers, caseSubmission, caseSubmissionStatus, checkpointIndex, assignment?.id, reviewer?.id]);

  useEffect(() => {
    if (!assignment || !reviewer || assignment.status === 'submitted') return;

    const timer = window.setInterval(() => {
      if (!hasUnsavedChanges || !isOnline) return;

      if (!assignment.questionnaire_enabled) {
        saveCaseSubmission('draft', false);
      } else {
        persist(answers, checkpointIndex, assignment.status || 'in_progress', false);
      }
    }, 20000);

    return () => window.clearInterval(timer);
  }, [
    assignment?.id,
    assignment?.questionnaire_enabled,
    assignment?.status,
    reviewer?.id,
    answers,
    caseSubmission,
    checkpointIndex,
    hasUnsavedChanges,
    isOnline
  ]);

  async function login() {
    setLoading(true);
    const { data: reviewerData, error } = await supabase.from('reviewers').select('*').eq('code', code.trim()).single();
    setLoading(false);

    if (error || !reviewerData) {
      alert('Reviewer code not found');
      return;
    }

    setReviewer(reviewerData);

    const { data: assignmentData, error: aerr } = await supabase
      .from('assignments')
      .select('*, cases(*)')
      .eq('reviewer_id', reviewerData.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (aerr || !assignmentData) {
      alert('No active assignment found');
      return;
    }

    setAssignment(assignmentData);
    setCheckpointIndex(Math.max(0, Math.min(TOTAL_STEPS - 1, (assignmentData.current_checkpoint || 1) - 1)));

    const { data: responseData } = await supabase
      .from('responses')
      .select('*')
      .eq('assignment_id', assignmentData.id)
      .single();

    setAnswers(responseData?.answers || {});
    setLastSavedAt(responseData?.updated_at || assignmentData.updated_at || '');
    setSaved(responseData?.updated_at ? 'Saved' : 'Ready');

    const { data: caseSubmissionData } = await supabase
      .from('case_submissions')
      .select('*')
      .eq('assignment_id', assignmentData.id)
      .maybeSingle();

    if (caseSubmissionData) {
      setCaseSubmission({
        diagnosis: caseSubmissionData.diagnosis || '',
        differential_diagnosis: caseSubmissionData.differential_diagnosis || '',
        recommended_tests: caseSubmissionData.recommended_tests || '',
        treatment_plan: caseSubmissionData.treatment_plan || '',
        confidence_score: caseSubmissionData.confidence_score ? String(caseSubmissionData.confidence_score) : '',
        notes: caseSubmissionData.notes || ''
      });
      setCaseSubmissionStatus(caseSubmissionData.status || 'draft');
      setCaseSubmissionSavedAt(caseSubmissionData.updated_at || caseSubmissionData.submitted_at || '');
    } else {
      setCaseSubmission(emptyCaseSubmission);
      setCaseSubmissionStatus('');
      setCaseSubmissionSavedAt('');
    }
  }

  async function writeAudit(eventType: string, payload: Record<string, any> = {}) {
    if (!assignment || !reviewer) return;

    await supabase.from('reviewer_audit_log').insert({
      assignment_id: assignment.id,
      reviewer_id: reviewer.id,
      case_id: assignment.case_id,
      event_type: eventType,
      event_payload: payload,
      created_at: new Date().toISOString()
    });
  }

  async function persist(nextAnswers = answers, nextCheckpointIndex = checkpointIndex, nextStatus = 'in_progress', showAlert = true) {
    if (!assignment) return;

    setSaved('Saving...');
    const now = new Date().toISOString();

    if (!isOnline) {
      setSaved('Offline - local draft saved');
      setHasUnsavedChanges(true);
      return;
    }

    const { error: responseError } = await supabase.from('responses').upsert({
      assignment_id: assignment.id,
      reviewer_id: assignment.reviewer_id,
      case_id: assignment.case_id,
      answers: nextAnswers,
      status: 'draft',
      updated_at: now
    }, { onConflict: 'assignment_id' });

    if (responseError) {
      setSaved('Save failed');
      alert(responseError.message);
      return;
    }

    const { error: assignmentError } = await supabase
      .from('assignments')
      .update({
        current_checkpoint: nextCheckpointIndex + 1,
        status: nextStatus,
        updated_at: now
      })
      .eq('id', assignment.id);

    if (assignmentError) {
      setSaved('Save failed');
      alert(assignmentError.message);
      return;
    }

    setAssignment({ ...assignment, current_checkpoint: nextCheckpointIndex + 1, status: nextStatus });
    setLastSavedAt(now);
    setSaved('Saved');
    setHasUnsavedChanges(false);
    await writeAudit('questionnaire_draft_saved', {
      checkpoint: nextCheckpointIndex + 1,
      status: nextStatus,
      answered_count: Object.keys(nextAnswers || {}).length
    });
  }

  async function saveAnswer(questionId: string, value: any) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    setHasUnsavedChanges(true);
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

  async function saveCaseSubmission(status: 'draft' | 'submitted' = 'draft', showAlert = true) {
    if (!assignment || !reviewer) return;

    if (status === 'submitted') {
      if (!caseSubmission.diagnosis.trim()) {
        alert('Most likely diagnosis is required before submission.');
        return;
      }

      if (!caseSubmission.recommended_tests.trim()) {
        alert('Recommended tests are required before submission.');
        return;
      }

      if (!caseSubmission.confidence_score) {
        alert('Confidence score is required before submission.');
        return;
      }
    }

    const now = new Date().toISOString();
    const confidence = caseSubmission.confidence_score ? Number(caseSubmission.confidence_score) : null;

    const { error } = await supabase.from('case_submissions').upsert({
      assignment_id: assignment.id,
      reviewer_id: reviewer.id,
      case_id: assignment.case_id,
      diagnosis: caseSubmission.diagnosis,
      differential_diagnosis: caseSubmission.differential_diagnosis,
      recommended_tests: caseSubmission.recommended_tests,
      treatment_plan: caseSubmission.treatment_plan,
      confidence_score: confidence,
      notes: caseSubmission.notes,
      status,
      updated_at: now,
      submitted_at: status === 'submitted' ? now : null
    }, { onConflict: 'assignment_id' });

    if (error) {
      alert(error.message);
      return;
    }

    setCaseSubmissionStatus(status);
    setCaseSubmissionSavedAt(now);
    setHasUnsavedChanges(false);
    await writeAudit(status === 'submitted' ? 'case_submission_submitted' : 'case_submission_draft_saved', {
      status,
      has_diagnosis: !!caseSubmission.diagnosis,
      has_recommended_tests: !!caseSubmission.recommended_tests
    });

    if (status === 'submitted') {
      alert('Case submission saved. The expert questionnaire will be available after the study coordinator enables it.');
    } else if (showAlert) {
      alert('Case submission draft saved.');
    }
  }

  function downloadMyAnnotation() {
    if (!assignment || !reviewer) return;

    const payload = {
      reviewer_code: reviewer.code,
      reviewer_name: reviewer.display_name,
      case_code: assignment.cases?.case_code,
      case_title: assignment.cases?.title,
      case_submission: caseSubmission,
      case_submission_status: caseSubmissionStatus,
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

    await supabase
      .from('assignments')
      .update({
        status: 'submitted',
        current_checkpoint: 5,
        updated_at: now
      })
      .eq('id', assignment.id);

    const receipt = submissionReceiptCode(assignment.id);
    await writeAudit('final_questionnaire_submitted', {
      receipt,
      answered_count: Object.keys(answers || {}).length
    });

    if (reviewer) {
      localStorage.removeItem(localDraftKey(reviewer.id, assignment.id));
    }

    setSubmissionReceipt(receipt);
    alert(`Evaluation submitted successfully. Receipt: ${receipt}`);
    setAssignment({ ...assignment, status: 'submitted', current_checkpoint: 5 });
    setSaved('Submitted');
    setLastSavedAt(now);
    setHasUnsavedChanges(false);
  }

  async function sendCorrectionMessage() {
    if (!assignment || !reviewer) return;

    if (!correctionMessage.trim()) {
      alert('Please write a correction note first.');
      return;
    }

    const { error } = await supabase.from('reviewer_messages').insert({
      assignment_id: assignment.id,
      reviewer_id: reviewer.id,
      case_id: assignment.case_id,
      message: correctionMessage.trim(),
      message_type: 'correction_request'
    });

    if (error) {
      alert(error.message);
      return;
    }

    setCorrectionMessage('');
    alert('Your correction note was sent to the study coordinator.');
  }

  if (!reviewer) {
    return (
      <main className="container">
        <div className="card">
          <h1>ClinEval reviewer access</h1>
          <p>Enter your reviewer code.</p>
          <input
            className="input"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="e.g. PROF_01"
            onKeyDown={e => {
              if (e.key === 'Enter') login();
            }}
          />
          <br /><br />
          <button className="btn btn-primary" onClick={login} disabled={loading}>
            {loading ? 'Checking...' : 'Continue'}
          </button>
        </div>
      </main>
    );
  }

  if (!assignment) {
    return (
      <main className="container">
        <div className="card">
          <h1>No active assignment</h1>
          <p>Contact the study coordinator.</p>
        </div>
      </main>
    );
  }

  if (assignment.status === 'submitted') {
    return (
      <main>
        <div className="topbar">
          <strong>ClinEval</strong>
          <div className="topbar-right">
            <span className="badge">Submitted</span>
            <span className="small">Submitted / last saved: {formatTime(lastSavedAt)}</span>
            <button className="btn btn-secondary btn-small" onClick={downloadMyAnnotation}>
              Download annotation
            </button>
          </div>
        </div>

        <div className="container">
          <div className="card">
            <h1>Evaluation submitted</h1>
            <p>Thank you. Your evaluation has been submitted successfully.</p>
            <p><strong>Submission receipt:</strong> {submissionReceipt || submissionReceiptCode(assignment.id)}</p>
            <p className="small">
              Reviewer: {reviewer.display_name} | Case: {assignment.cases?.case_code} | Model: blinded
            </p>
            <div className="row">
              <button className="btn btn-secondary" onClick={downloadMyAnnotation}>
                Download my annotation
              </button>
            </div>
          </div>

          <div className="card">
            <h2>Independent case submission</h2>
            <p className="small">This is the independent clinical assessment submitted before the expert questionnaire.</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{JSON.stringify(caseSubmission, null, 2)}</pre>
          </div>

          <div className="card">
            <h2>Your submitted annotation</h2>
            <p className="small">This is a read-only copy of the answers currently stored for this assignment.</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{JSON.stringify(answers, null, 2)}</pre>
          </div>

          <div className="card">
            <h2>Correction or mistake note</h2>
            <p className="small">
              If you noticed a mistake after submission, write a message to the study coordinator.
              This will not overwrite your submitted evaluation.
            </p>
            <textarea
              className="input"
              value={correctionMessage}
              onChange={e => setCorrectionMessage(e.target.value)}
              placeholder="Describe the correction or issue..."
            />
            <br /><br />
            <button className="btn btn-primary" onClick={sendCorrectionMessage}>
              Send correction note
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!assignment.cases?.is_active) {
    return (
      <main className="container">
        <div className="card">
          <h1>Case not yet released</h1>
          <p>
            This case has been assigned to you but has not yet been activated by the study coordinator.
          </p>
          <p className="small">
            Please return later or contact the study coordinator.
          </p>
        </div>
      </main>
    );
  }

  if (!assignment.questionnaire_enabled) {
    return (
      <main>
        <div className="topbar">
          <strong>ClinEval</strong>
          <div className="topbar-right">
            <span className="badge">{caseSubmissionStatus === 'submitted' ? 'Submitted' : 'Case submission'}</span>
            <span className="small">Connection: {isOnline ? 'Online' : 'Offline'} | Last saved: {formatTime(caseSubmissionSavedAt)}</span>
            <button className="btn btn-secondary btn-small" onClick={() => saveCaseSubmission('draft')}>
              Save draft
            </button>
          </div>
        </div>

        <div className="container">
          <div className="card">
            <h1>Case Submission Form</h1>
            <p className="small">
              Please provide your independent clinical assessment before the expert questionnaire is released.
              The blinded LLM questionnaire will become available after the study coordinator enables it.
            </p>
            <p className="small">
              Reviewer: {reviewer.display_name} | Case: {assignment.cases?.case_code}
            </p>
          </div>

          <div className="card">
            <h2>Case vignette</h2>
            <p>{assignment.cases?.vignette_cp1}</p>
          </div>

          <div className="card">
            <h2>Independent clinical assessment</h2>

            <label>Most likely diagnosis</label>
            <textarea
              className="input"
              value={caseSubmission.diagnosis}
              onChange={e => { setCaseSubmission({ ...caseSubmission, diagnosis: e.target.value }); setHasUnsavedChanges(true); }}
              placeholder="Enter the most likely diagnosis..."
              onBlur={() => saveCaseSubmission('draft', false)}
              disabled={caseSubmissionStatus === 'submitted'}
            />

            <label>Differential diagnosis</label>
            <textarea
              className="input"
              value={caseSubmission.differential_diagnosis}
              onChange={e => { setCaseSubmission({ ...caseSubmission, differential_diagnosis: e.target.value }); setHasUnsavedChanges(true); }}
              placeholder="Enter relevant differential diagnoses..."
              onBlur={() => saveCaseSubmission('draft', false)}
              disabled={caseSubmissionStatus === 'submitted'}
            />

            <label>Recommended tests</label>
            <textarea
              className="input"
              value={caseSubmission.recommended_tests}
              onChange={e => { setCaseSubmission({ ...caseSubmission, recommended_tests: e.target.value }); setHasUnsavedChanges(true); }}
              placeholder="Enter recommended diagnostic tests..."
              onBlur={() => saveCaseSubmission('draft', false)}
              disabled={caseSubmissionStatus === 'submitted'}
            />

            <label>Treatment plan</label>
            <textarea
              className="input"
              value={caseSubmission.treatment_plan}
              onChange={e => { setCaseSubmission({ ...caseSubmission, treatment_plan: e.target.value }); setHasUnsavedChanges(true); }}
              placeholder="Enter initial treatment or management plan..."
              onBlur={() => saveCaseSubmission('draft', false)}
              disabled={caseSubmissionStatus === 'submitted'}
            />

            <label>Confidence score 1-5</label>
            <input
              className="input"
              type="number"
              min="1"
              max="5"
              value={caseSubmission.confidence_score}
              onChange={e => { setCaseSubmission({ ...caseSubmission, confidence_score: e.target.value }); setHasUnsavedChanges(true); }}
              onBlur={() => saveCaseSubmission('draft', false)}
              disabled={caseSubmissionStatus === 'submitted'}
            />

            <label>Notes</label>
            <textarea
              className="input"
              value={caseSubmission.notes}
              onChange={e => { setCaseSubmission({ ...caseSubmission, notes: e.target.value }); setHasUnsavedChanges(true); }}
              placeholder="Optional notes..."
              onBlur={() => saveCaseSubmission('draft', false)}
              disabled={caseSubmissionStatus === 'submitted'}
            />

            <br /><br />

            {caseSubmissionStatus === 'submitted' ? (
              <div className="warning">
                <strong>Submitted.</strong><br />
                Your independent case assessment has been submitted. The expert questionnaire will be available after the study coordinator enables it.
              </div>
            ) : (
              <div className="row">
                <button className="btn btn-secondary" onClick={() => saveCaseSubmission('draft')}>
                  Save draft
                </button>
                <button className="btn btn-primary" onClick={() => saveCaseSubmission('submitted')}>
                  Submit case assessment
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  const cp = checkpoints[checkpointIndex];
  const caseData = assignment.cases;
  const vignette = caseData?.[`vignette_${cp.id}`];
  const modelOutput = caseData?.[`model_output_${cp.id}`];
  const stepNumber = checkpointIndex + 1;
  const progressPct = Math.round(((stepNumber - 1) / TOTAL_STEPS) * 100);
  const answered = countAnswered(answers);
  const totalVisible = visibleQuestions(answers).length;

  return (
    <main>
      <div className="topbar">
        <strong>ClinEval</strong>
        <div className="topbar-right">
          <span className="badge">{saved}</span>
          <span className="small">Connection: {isOnline ? 'Online' : 'Offline'} | Last saved: {formatTime(lastSavedAt)}</span>
          <button className="btn btn-secondary btn-small" onClick={saveDraft}>
            Save draft
          </button>
          <button className="btn btn-secondary btn-small" onClick={downloadMyAnnotation}>
            Download annotation
          </button>
        </div>
      </div>

      <div className="container">
        <div className="card">
          <div className="small">
            Reviewer: {reviewer.display_name} | Case: {caseData?.case_code} | Model: blinded
          </div>
          <h1>{cp.title}</h1>
          <div className="progress-meta">
            <span>Checkpoint {stepNumber} of 4</span>
            <span>{answered} of {totalVisible} visible questions answered</span>
            <span>
              Estimated remaining time: {Math.max(2, (TOTAL_STEPS - stepNumber + 1) * 3)}-{Math.max(4, (TOTAL_STEPS - stepNumber + 1) * 5)} min
            </span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="warning">
            <strong>IMPORTANT:</strong><br />
            {cp.instruction}<br />
            Evaluate ONLY the information displayed on this page.
          </div>
        </div>

        <div className="card">
          <h3>Case vignette</h3>
          <p>{vignette}</p>
          <h3>Model output</h3>
          <p>{modelOutput}</p>
        </div>

        <div className="card">
          <h3>Expert Questionnaire</h3>
          <p className="small">
            Likert scale: 1 = Strongly disagree · 2 = Disagree · 3 = Neutral / Undecided · 4 = Agree · 5 = Strongly agree · Not applicable
          </p>

          {cp.questions.map((q: any) => {
            if (q.conditional && answers[q.conditional.question] !== q.conditional.value) return null;

            return (
              <div className="question" key={q.id}>
                <strong>{q.text}</strong>
                {q.description && <p className="small">{q.description}</p>}

                {q.type === 'likert' && (
                  <OptionGroup
                    value={answers[q.id]}
                    options={likertOptions}
                    onChange={v => saveAnswer(q.id, v)}
                  />
                )}

                {q.type === 'yesno' && (
                  <OptionGroup
                    value={answers[q.id]}
                    options={['Yes', 'No']}
                    onChange={v => saveAnswer(q.id, v)}
                  />
                )}

                {q.type === 'harm' && (
                  <>
                    <OptionGroup
                      value={answers[q.id]}
                      options={harmOptionsForQuestion(q.id)}
                      onChange={v => saveAnswer(q.id, v)}
                    />
                    {answers[q.id] === 'Severe harm likely' && (
                      <textarea
                        className="input harm-explanation"
                        placeholder="Optional: briefly explain the potential source of harm."
                        value={answers[q.id + '_explanation'] || ''}
                        onChange={e => saveAnswer(q.id + '_explanation', e.target.value)}
                        onBlur={() => persist(answers, checkpointIndex, assignment.status || 'in_progress', false)}
                      />
                    )}
                  </>
                )}

                {q.type === 'text' && (
                  <textarea
                    className="input"
                    value={answers[q.id] || ''}
                    onChange={e => saveAnswer(q.id, e.target.value)}
                    onBlur={() => persist(answers, checkpointIndex, assignment.status || 'in_progress', false)}
                    placeholder="Free text"
                  />
                )}
              </div>
            );
          })}

          <div className="question">
            <strong>Private reviewer notes</strong>
            <p className="small">
              Optional. These are saved for your own review and are not part of the primary questionnaire.
            </p>
            <textarea
              className="input"
              value={answers[`private_notes_step_${stepNumber}`] || ''}
              onChange={e => saveAnswer(`private_notes_step_${stepNumber}`, e.target.value)}
              onBlur={() => persist(answers, checkpointIndex, assignment.status || 'in_progress', false)}
              placeholder="Private notes for yourself..."
            />
          </div>

          <br />

          <div className="row nav-row">
            <button
              className="btn btn-secondary"
              disabled={checkpointIndex === 0}
              onClick={() => goToStep(checkpointIndex - 1)}
            >
              Back
            </button>

            <button className="btn btn-secondary" onClick={saveDraft}>
              Save draft
            </button>

            <button className="btn btn-secondary" onClick={downloadMyAnnotation}>
              Download annotation
            </button>

            {checkpointIndex < checkpoints.length - 1 ? (
              <button className="btn btn-primary" onClick={() => goToStep(checkpointIndex + 1)}>
                Save & continue
              </button>
            ) : (
              <button className="btn btn-primary" onClick={submitFinal}>
                Final submit
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
