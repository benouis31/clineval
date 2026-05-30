'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { checkpoints, likertOptions, harmOptionsForQuestion } from '../../lib/questionnaire';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────
type Reviewer = { id: string; code: string; display_name: string; email?: string };
type Assignment = {
  id: string; reviewer_id: string; case_id: string; status: string;
  current_checkpoint: number; questionnaire_enabled?: boolean; cases: any;
};
type CaseSubmission = {
  diagnosis: string; differential_diagnosis: string; recommended_tests: string;
  treatment_plan: string; confidence_score: string; notes: string;
};
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const TOTAL_STEPS = checkpoints.length;
const CONTACT_EMAIL = 'jan-niklas.eckardt@ukdd.de';
const emptyCaseSubmission: CaseSubmission = {
  diagnosis: '', differential_diagnosis: '', recommended_tests: '',
  treatment_plan: '', confidence_score: '', notes: ''
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(value?: string) {
  if (!value) return 'Not yet saved';
  return new Date(value).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function visibleQuestions(answers: Record<string, any>) {
  return checkpoints.flatMap(cp => cp.questions).filter((q: any) =>
    !(q.conditional && answers[q.conditional.question] !== q.conditional.value)
  );
}

function countAnswered(answers: Record<string, any>) {
  return visibleQuestions(answers).filter((q: any) =>
    answers[q.id] !== undefined && answers[q.id] !== ''
  ).length;
}

function downloadBlob(filename: string, payload: object) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function OptionGroup({ value, options, onChange, disabled }: {
  value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className="options">
      {options.map(o => (
        <button
          key={o} type="button" disabled={disabled}
          className={'option ' + (value === o ? 'selected' : '')}
          onClick={() => !disabled && onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function SaveIndicator({ state, lastSavedAt }: { state: SaveState; lastSavedAt: string }) {
  if (state === 'saving') return (
    <span className="save-status">
      <span className="save-dot" style={{ background: '#f0a500' }} />
      Saving…
    </span>
  );
  if (state === 'error') return (
    <span className="save-status error">
      <span className="save-dot" />
      Save failed — please try manually
    </span>
  );
  if (state === 'saved') return (
    <span className="save-status saved">
      <span className="save-dot" />
      Saved {fmt(lastSavedAt)}
    </span>
  );
  return (
    <span className="save-status">
      Last saved: {fmt(lastSavedAt)}
    </span>
  );
}

function ContactBar({ reviewerName }: { reviewerName: string }) {
  return (
    <div className="contact-box" style={{ marginTop: 24 }}>
      <span style={{ fontSize: 22 }}>💬</span>
      <div>
        <strong>Need help or found an issue?</strong>
        <div style={{ fontSize: 14, marginTop: 2 }}>
          Contact the study team at{' '}
          <a href={`mailto:${CONTACT_EMAIL}?subject=ClinEval question — ${reviewerName}`}>
            {CONTACT_EMAIL}
          </a>
          {' '}or use the correction note below after submission.
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ReviewerPage() {
  const [code, setCode] = useState('');
  const [reviewer, setReviewer] = useState<Reviewer | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);

  // Task 1 — independent case assessment
  const [caseSubmission, setCaseSubmission] = useState<CaseSubmission>(emptyCaseSubmission);
  const [caseSubmissionStatus, setCaseSubmissionStatus] = useState<'draft' | 'submitted' | ''>('');
  const [caseSubmissionSavedAt, setCaseSubmissionSavedAt] = useState('');
  const [task1SaveState, setTask1SaveState] = useState<SaveState>('idle');

  // Task 2 — expert questionnaire
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [task2SaveState, setTask2SaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState('');

  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [correctionMsg, setCorrectionMsg] = useState('');
  const [correctionSent, setCorrectionSent] = useState(false);

  // Online/offline
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Stale-closure ref for autosave
  const caseSubmissionRef = useRef(caseSubmission);
  useEffect(() => { caseSubmissionRef.current = caseSubmission; }, [caseSubmission]);

  // ── Autosave every 20s ──
  useEffect(() => {
    if (!assignment || assignment.status === 'submitted') return;
    const timer = setInterval(() => {
      if (!hasUnsavedChanges || !isOnline) return;
      if (!assignment.questionnaire_enabled) {
        persistCaseSubmission(caseSubmissionRef.current, 'draft', false);
      } else {
        persistQuestionnaire(answers, checkpointIndex);
      }
    }, 20000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment, answers, checkpointIndex, hasUnsavedChanges, isOnline]);

  // ── Login ──
  async function login() {
    setLoginError('');
    setLoading(true);
    const { data: rev, error } = await supabase
      .from('reviewers').select('*').eq('code', code.trim().toUpperCase()).single();
    if (error || !rev) {
      setLoginError('Reviewer code not found. Please check your code and try again, or contact the study team.');
      setLoading(false); return;
    }
    setReviewer(rev);

    const { data: rows, error: aerr } = await supabase
      .from('assignments').select('*, cases(*)')
      .eq('reviewer_id', rev.id)
      .order('created_at', { ascending: false }).limit(1);
    const asgn = rows?.[0] ?? null;
    if (aerr || !asgn) {
      setLoginError('No active assignment found. Please contact the study team.');
      setLoading(false); return;
    }
    setAssignment(asgn);
    setCheckpointIndex(Math.max(0, (asgn.current_checkpoint || 1) - 1));

    const { data: resp } = await supabase
      .from('responses').select('*').eq('assignment_id', asgn.id).maybeSingle();
    setAnswers(resp?.answers || {});
    setLastSavedAt(resp?.updated_at || asgn.updated_at || '');

    const { data: cs } = await supabase
      .from('case_submissions').select('*').eq('assignment_id', asgn.id).maybeSingle();
    if (cs) {
      const loaded: CaseSubmission = {
        diagnosis: cs.diagnosis || '',
        differential_diagnosis: cs.differential_diagnosis || '',
        recommended_tests: cs.recommended_tests || '',
        treatment_plan: cs.treatment_plan || '',
        confidence_score: cs.confidence_score ? String(cs.confidence_score) : '',
        notes: cs.notes || ''
      };
      setCaseSubmission(loaded);
      caseSubmissionRef.current = loaded;
      setCaseSubmissionStatus(cs.status || 'draft');
      setCaseSubmissionSavedAt(cs.updated_at || cs.submitted_at || '');
    }
    setLoading(false);
  }

  // ── Task 1: persist case submission ──
  async function persistCaseSubmission(
    values: CaseSubmission,
    status: 'draft' | 'submitted' = 'draft',
    showFeedback = true
  ) {
    if (!assignment || !reviewer || !isOnline) return;
    if (showFeedback) setTask1SaveState('saving');
    const now = new Date().toISOString();
    const confidence = values.confidence_score ? Number(values.confidence_score) : null;
    const { error } = await supabase.from('case_submissions').upsert({
      assignment_id: assignment.id, reviewer_id: reviewer.id, case_id: assignment.case_id,
      diagnosis: values.diagnosis, differential_diagnosis: values.differential_diagnosis,
      recommended_tests: values.recommended_tests, treatment_plan: values.treatment_plan,
      confidence_score: confidence, notes: values.notes, status,
      updated_at: now, submitted_at: status === 'submitted' ? now : null
    }, { onConflict: 'assignment_id' });
    if (error) { if (showFeedback) setTask1SaveState('error'); return; }
    setCaseSubmissionStatus(status);
    setCaseSubmissionSavedAt(now);
    setHasUnsavedChanges(false);
    if (showFeedback) setTask1SaveState('saved');
    if (status === 'submitted') {
      await supabase.from('assignments').update({ questionnaire_enabled: true, updated_at: now }).eq('id', assignment.id);
      setAssignment(a => a ? { ...a, questionnaire_enabled: true } : a);
      await supabase.from('reviewer_audit_log').insert({
        assignment_id: assignment.id, reviewer_id: reviewer.id, case_id: assignment.case_id,
        event_type: 'case_submission_submitted', created_at: now
      });
    }
  }

  async function submitTask1() {
    if (!caseSubmission.diagnosis.trim()) return alert('Please fill in your most likely diagnosis before submitting.');
    if (!caseSubmission.recommended_tests.trim()) return alert('Please fill in your recommended diagnostic tests before submitting.');
    const score = Number(caseSubmission.confidence_score);
    if (!caseSubmission.confidence_score || isNaN(score) || score < 1 || score > 5) {
      return alert('Please enter a confidence score between 1 and 5.');
    }
    if (!confirm('Submit your independent case assessment? You will not be able to edit it afterwards.')) return;
    await persistCaseSubmission(caseSubmission, 'submitted', true);
  }

  // ── Task 2: persist questionnaire ──
  async function persistQuestionnaire(
    nextAnswers = answers,
    nextCheckpoint = checkpointIndex,
  ) {
    if (!assignment || !isOnline) return;
    setTask2SaveState('saving');
    const now = new Date().toISOString();
    const { error: e1 } = await supabase.from('responses').upsert({
      assignment_id: assignment.id, reviewer_id: assignment.reviewer_id, case_id: assignment.case_id,
      answers: nextAnswers, status: 'draft', updated_at: now
    }, { onConflict: 'assignment_id' });
    if (e1) { setTask2SaveState('error'); return; }
    const { error: e2 } = await supabase.from('assignments').update({
      current_checkpoint: nextCheckpoint + 1, status: 'in_progress', updated_at: now
    }).eq('id', assignment.id);
    if (e2) { setTask2SaveState('error'); return; }
    setAssignment(a => a ? { ...a, current_checkpoint: nextCheckpoint + 1 } : a);
    setLastSavedAt(now);
    setHasUnsavedChanges(false);
    setTask2SaveState('saved');
  }

  async function saveAnswer(questionId: string, value: string) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    setHasUnsavedChanges(true);
    await persistQuestionnaire(next, checkpointIndex);
  }

  async function submitFinal() {
    if (!assignment) return;
    if (!confirm('Submit your final evaluation? This will lock your answers — you will not be able to make changes.')) return;
    setTask2SaveState('saving');
    const now = new Date().toISOString();
    await supabase.from('responses').upsert({
      assignment_id: assignment.id, answers, status: 'submitted',
      submitted_at: now, updated_at: now
    }, { onConflict: 'assignment_id' });
    await supabase.from('assignments').update({ status: 'submitted', updated_at: now }).eq('id', assignment.id);
    setTask2SaveState('saved');
    setAssignment(a => a ? { ...a, status: 'submitted' } : a);
  }

  async function sendCorrection() {
    if (!correctionMsg.trim() || !assignment || !reviewer) return;
    await supabase.from('reviewer_messages').insert({
      assignment_id: assignment.id, reviewer_id: reviewer.id,
      case_id: assignment.case_id, message: correctionMsg.trim(), message_type: 'correction_request'
    });
    setCorrectionSent(true);
    setCorrectionMsg('');
  }

  // ── Progress ──
  const answeredCount = countAnswered(answers);
  const totalVisible = visibleQuestions(answers).length;
  const task2Percent = Math.round((answeredCount / (totalVisible || 1)) * 100);
  const task1Percent =
    (caseSubmission.diagnosis ? 25 : 0) +
    (caseSubmission.recommended_tests ? 25 : 0) +
    (caseSubmission.confidence_score ? 25 : 0) +
    (caseSubmission.differential_diagnosis ? 25 : 0);

  // ══════════════════════════════════════════════════════
  // RENDER: Login
  // ══════════════════════════════════════════════════════
  if (!reviewer) return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 420, padding: 20 }}>
        <div className="card">
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🩺</div>
            <h1 style={{ margin: 0, fontSize: 24 }}>ClinEval</h1>
            <p style={{ color: 'var(--muted)', marginTop: 6, fontSize: 15 }}>
              Expert clinician evaluation platform
            </p>
          </div>
          <label style={{ fontWeight: 600, marginBottom: 6, display: 'block' }}>
            Your reviewer code
          </label>
          <input
            className="input"
            value={code}
            onChange={e => { setCode(e.target.value); setLoginError(''); }}
            onKeyDown={e => e.key === 'Enter' && !loading && login()}
            placeholder="e.g. PROF_01"
            style={{ fontSize: 18, letterSpacing: 2, marginBottom: 12 }}
            autoFocus
          />
          {loginError && (
            <div className="alert alert-danger" style={{ marginBottom: 12 }}>
              {loginError}
            </div>
          )}
          <button className="btn btn-primary btn-lg" onClick={login} disabled={loading || !code.trim()} style={{ width: '100%' }}>
            {loading ? 'Loading your assignment…' : 'Enter'}
          </button>
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
            Problems accessing? Email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>{CONTACT_EMAIL}</a>
          </div>
        </div>
      </div>
    </main>
  );

  // ══════════════════════════════════════════════════════
  // RENDER: Case not yet active
  // ══════════════════════════════════════════════════════
  if (!assignment?.cases?.is_active) return (
    <main className="container">
      <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
        <h1>Your case is being prepared</h1>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>
          The study coordinator will activate your case shortly. You will receive an email when it is ready.
        </p>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 16 }}>
          Questions? Contact <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>{CONTACT_EMAIL}</a>
        </p>
      </div>
    </main>
  );

  // ══════════════════════════════════════════════════════
  // RENDER: Fully submitted
  // ══════════════════════════════════════════════════════
  if (assignment.status === 'submitted') return (
    <main className="container">
      <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
        <h1>Evaluation complete!</h1>
        <p style={{ fontSize: 16, color: 'var(--muted)', maxWidth: 460, margin: '8px auto 0' }}>
          Thank you, <strong>{reviewer.display_name}</strong>. Your evaluation has been submitted and your contribution is greatly appreciated.
        </p>
        <button
          className="btn btn-secondary"
          style={{ marginTop: 24 }}
          onClick={() => downloadBlob(`${reviewer.code}_annotation.json`, { reviewer_code: reviewer.code, answers, exported_at: new Date().toISOString() })}
        >
          Download my answers
        </button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Send a correction or note</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>
          If you noticed a mistake in your answers, please let us know below. The study team will review your message.
        </p>
        {correctionSent ? (
          <div className="alert alert-success">Your message has been sent. Thank you!</div>
        ) : (
          <>
            <textarea
              className="input"
              value={correctionMsg}
              onChange={e => setCorrectionMsg(e.target.value)}
              placeholder="Describe the correction or question…"
              style={{ minHeight: 100 }}
            />
            <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={sendCorrection} disabled={!correctionMsg.trim()}>
              Send message
            </button>
          </>
        )}
      </div>
    </main>
  );

  const cp = checkpoints[checkpointIndex];
  const stepNumber = checkpointIndex + 1;
  const task1Locked = caseSubmissionStatus === 'submitted';
  const task2Locked = !assignment.questionnaire_enabled;

  // ══════════════════════════════════════════════════════
  // RENDER: Main workflow — two tasks
  // ══════════════════════════════════════════════════════
  return (
    <main>
      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">ClinEval</span>
          <span className="badge">{reviewer.display_name}</span>
        </div>
        <div className="topbar-right">
          {!isOnline && (
            <span style={{ background: 'var(--danger)', color: 'white', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999 }}>
              ⚠ You are offline
            </span>
          )}
          <span className="small" style={{ color: 'var(--muted)' }}>
            Case: <strong>{assignment.cases?.case_code}</strong>
          </span>
          <a href={`mailto:${CONTACT_EMAIL}?subject=ClinEval — ${reviewer.display_name}`} className="btn btn-secondary btn-small">
            Contact us
          </a>
        </div>
      </div>

      {/* ── Offline full banner ── */}
      {!isOnline && (
        <div className="offline-bar">
          ⚠ You are currently offline. Your answers are safe but will not be saved until your connection is restored.
        </div>
      )}

      <div className="container">

        {/* ── Welcome / overview ── */}
        <div className="card">
          <h1 style={{ marginTop: 0, fontSize: 22 }}>
            Welcome, {reviewer.display_name}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 15, marginBottom: 16 }}>
            Your evaluation has two separate tasks, shown below. Complete <strong>Task 1</strong> first — Task 2 will become available once you submit it.
          </p>

          {/* Overview pills */}
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1, minWidth: 180, background: task1Locked ? 'var(--accent-light)' : '#f9f8f5', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: task1Locked ? 'var(--accent)' : 'var(--muted)', marginBottom: 6 }}>
                TASK 1 — {task1Locked ? '✅ Submitted' : 'In progress'}
              </div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Independent Case Assessment</div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${task1Locked ? 100 : task1Percent}%` }} /></div>
              <div className="progress-label">{task1Locked ? 'Completed' : `${task1Percent}% filled`}</div>
            </div>
            <div style={{ flex: 1, minWidth: 180, background: !task2Locked ? '#f9f8f5' : '#fafaf8', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', opacity: task2Locked ? 0.6 : 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: assignment.status === 'submitted' ? 'var(--accent)' : 'var(--muted)', marginBottom: 6 }}>
                TASK 2 — {task2Locked ? '🔒 Locked' : assignment.status === 'submitted' ? '✅ Submitted' : 'In progress'}
              </div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Expert Questionnaire</div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${task2Locked ? 0 : task2Percent}%` }} /></div>
              <div className="progress-label">{task2Locked ? 'Available after Task 1' : `${answeredCount} of ${totalVisible} questions answered`}</div>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════
            TASK 1 — Independent Case Assessment
        ══════════════════════════════════════════════ */}
        <div className={`card-task ${task1Locked ? 'task-locked' : 'task-active'}`} style={{ pointerEvents: task1Locked ? 'none' : 'auto', opacity: task1Locked ? 1 : 1 }}>
          <div className="task-header">
            <div className={`task-number ${task1Locked ? '' : ''}`} style={{ background: task1Locked ? 'var(--accent)' : 'var(--accent)' }}>
              {task1Locked ? '✓' : '1'}
            </div>
            <div>
              <div className="task-title">Task 1 — Independent Case Assessment</div>
              <div className="task-subtitle">
                {task1Locked
                  ? 'Submitted — thank you. Task 2 is now available below.'
                  : 'Read the case and record your own clinical assessment before seeing the AI output.'}
              </div>
            </div>
          </div>

          {task1Locked ? (
            <div className="alert alert-success">
              ✅ <strong>Your independent assessment has been submitted.</strong> Your answers have been recorded. Please scroll down to complete Task 2.
            </div>
          ) : (
            <>
              <div className="alert alert-warn">
                <strong>Important:</strong> Please provide your own clinical assessment <em>before</em> seeing the AI model output. Your independent opinion is essential for this study.
              </div>

              {/* Case vignette */}
              <h3 style={{ marginTop: 20 }}>Case presentation</h3>
              <div className="vignette">{assignment.cases?.vignette_cp1}</div>

              {/* Fields */}
              <div style={{ marginTop: 24 }}>
                {(
                  [
                    { label: 'Most likely diagnosis', key: 'diagnosis', required: true, hint: 'State the single most likely diagnosis.' },
                    { label: 'Differential diagnoses', key: 'differential_diagnosis', required: false, hint: 'List other diagnoses you are considering, ranked by likelihood.' },
                    { label: 'Recommended diagnostic tests', key: 'recommended_tests', required: true, hint: 'List the further tests you would order at this stage.' },
                    { label: 'Initial treatment plan', key: 'treatment_plan', required: false, hint: 'If applicable at this stage, describe your preferred treatment approach.' },
                    { label: 'Additional notes', key: 'notes', required: false, hint: 'Anything else relevant to your assessment.' },
                  ] as { label: string; key: keyof CaseSubmission; required: boolean; hint: string }[]
                ).map(({ label, key, required, hint }) => (
                  <div key={key} style={{ marginBottom: 20 }}>
                    <label>
                      {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
                    </label>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>{hint}</div>
                    <textarea
                      className="input"
                      value={caseSubmission[key]}
                      onChange={e => { setCaseSubmission(prev => ({ ...prev, [key]: e.target.value })); setHasUnsavedChanges(true); }}
                      onBlur={() => persistCaseSubmission(caseSubmission, 'draft', true)}
                      placeholder={`Enter your ${label.toLowerCase()}…`}
                    />
                  </div>
                ))}

                <div style={{ marginBottom: 20 }}>
                  <label>
                    Confidence score (1–5)<span style={{ color: 'var(--danger)' }}> *</span>
                  </label>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
                    How confident are you in your assessment?
                    <span style={{ marginLeft: 8 }}>1 = not confident · 5 = very confident</span>
                  </div>
                  <div className="options">
                    {['1', '2', '3', '4', '5'].map(n => (
                      <button
                        key={n} type="button"
                        className={'option ' + (caseSubmission.confidence_score === n ? 'selected' : '')}
                        onClick={() => { setCaseSubmission(prev => ({ ...prev, confidence_score: n })); setHasUnsavedChanges(true); }}
                        style={{ minWidth: 52, fontSize: 16, fontWeight: 700 }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Save status + actions */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 8, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <SaveIndicator state={task1SaveState} lastSavedAt={caseSubmissionSavedAt} />
                <div className="row">
                  <button
                    className="btn btn-secondary"
                    onClick={() => persistCaseSubmission(caseSubmission, 'draft', true)}
                    disabled={!isOnline}
                  >
                    Save draft
                  </button>
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={submitTask1}
                    disabled={!isOnline || !caseSubmission.diagnosis.trim()}
                  >
                    Submit Task 1 →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ══════════════════════════════════════════════
            TASK 2 — Expert Questionnaire
        ══════════════════════════════════════════════ */}
        <div className={`card-task ${task2Locked ? '' : 'task-active'}`} style={{ opacity: task2Locked ? 0.55 : 1, pointerEvents: task2Locked ? 'none' : 'auto' }}>
          <div className="task-header">
            <div className="task-number" style={{ background: task2Locked ? '#b0b0a8' : 'var(--accent)' }}>
              {assignment.status === 'submitted' ? '✓' : task2Locked ? '🔒' : '2'}
            </div>
            <div>
              <div className="task-title">Task 2 — Expert Questionnaire</div>
              <div className="task-subtitle">
                {task2Locked
                  ? 'This task will unlock once you submit Task 1.'
                  : `Checkpoint ${stepNumber} of ${TOTAL_STEPS} · ${answeredCount} of ${totalVisible} questions answered`}
              </div>
            </div>
          </div>

          {task2Locked && (
            <div className="alert alert-info">
              🔒 <strong>Task 2 is locked.</strong> Complete and submit your independent assessment in Task 1 above to unlock this section.
            </div>
          )}

          {!task2Locked && (
            <>
              {/* Checkpoint steps */}
              <div className="steps">
                {checkpoints.map((c, i) => (
                  <div
                    key={c.id}
                    className={`step ${i < checkpointIndex ? 'done' : i === checkpointIndex ? 'active' : ''}`}
                  >
                    {i < checkpointIndex ? '✓ ' : ''}{c.shortTitle}
                  </div>
                ))}
              </div>

              {/* Progress */}
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${task2Percent}%` }} />
              </div>
              <div className="progress-label">{answeredCount} of {totalVisible} questions answered ({task2Percent}%)</div>

              {/* Instruction */}
              <div className="alert alert-warn" style={{ marginTop: 16 }}>
                <strong>Instruction:</strong> {cp.instruction}
              </div>

              {/* Vignette + model output */}
              <h3 style={{ marginTop: 20 }}>Case information — Checkpoint {stepNumber}</h3>
              <div className="vignette" style={{ marginBottom: 12 }}>{assignment.cases?.[`vignette_${cp.id}`]}</div>
              <h3>AI model output</h3>
              <div className="vignette">{assignment.cases?.[`model_output_${cp.id}`]}</div>

              {/* Questions */}
              <div style={{ marginTop: 24 }}>
                <h3 style={{ marginBottom: 4 }}>Your evaluation</h3>
                <p className="small">Likert scale: 1 = Strongly disagree · 2 = Disagree · 3 = Neutral · 4 = Agree · 5 = Strongly agree</p>
                {cp.questions.map((q: any) => {
                  if (q.conditional && answers[q.conditional.question] !== q.conditional.value) return null;
                  return (
                    <div className="question" key={q.id}>
                      <div className="question-text">{q.text}</div>
                      {q.description && <p className="small" style={{ marginBottom: 8 }}>{q.description}</p>}
                      {q.type === 'likert' && (
                        <OptionGroup value={answers[q.id]} options={likertOptions} onChange={v => saveAnswer(q.id, v)} />
                      )}
                      {q.type === 'yesno' && (
                        <OptionGroup value={answers[q.id]} options={['Yes', 'No']} onChange={v => saveAnswer(q.id, v)} />
                      )}
                      {q.type === 'harm' && (
                        <>
                          <OptionGroup value={answers[q.id]} options={harmOptionsForQuestion(q.id)} onChange={v => saveAnswer(q.id, v)} />
                          {answers[q.id] === 'Severe harm likely' && (
                            <textarea
                              className="input harm-explanation"
                              placeholder="Please explain the potential harm…"
                              value={answers[q.id + '_explanation'] || ''}
                              onChange={e => setAnswers(prev => ({ ...prev, [q.id + '_explanation']: e.target.value }))}
                              onBlur={e => saveAnswer(q.id + '_explanation', e.target.value)}
                            />
                          )}
                        </>
                      )}
                      {q.type === 'text' && (
                        <textarea
                          className="input"
                          value={answers[q.id] || ''}
                          onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                          onBlur={e => saveAnswer(q.id, e.target.value)}
                          placeholder="Your comments (optional)…"
                        />
                      )}
                    </div>
                  );
                })}

                {/* Private notes */}
                <div className="question">
                  <div className="question-text" style={{ color: 'var(--muted)', fontWeight: 500 }}>
                    Private notes (not shared with the study team)
                  </div>
                  <textarea
                    className="input"
                    value={answers[`private_notes_step_${stepNumber}`] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [`private_notes_step_${stepNumber}`]: e.target.value }))}
                    onBlur={e => saveAnswer(`private_notes_step_${stepNumber}`, e.target.value)}
                    placeholder="Optional personal notes for this checkpoint…"
                  />
                </div>
              </div>

              {/* Nav */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 8, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <SaveIndicator state={task2SaveState} lastSavedAt={lastSavedAt} />
                <div className="nav-row" style={{ flex: 1, marginTop: 0 }}>
                  <button
                    className="btn btn-secondary"
                    disabled={checkpointIndex === 0}
                    onClick={() => setCheckpointIndex(i => i - 1)}
                  >
                    ← Back
                  </button>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => persistQuestionnaire(answers, checkpointIndex)}
                    disabled={!isOnline}
                  >
                    Save draft
                  </button>
                  {checkpointIndex < TOTAL_STEPS - 1 ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => { persistQuestionnaire(answers, checkpointIndex); setCheckpointIndex(i => i + 1); }}
                      disabled={!isOnline}
                    >
                      Save & continue →
                    </button>
                  ) : (
                    <button className="btn btn-primary btn-lg" onClick={submitFinal} disabled={!isOnline}>
                      Submit final evaluation ✓
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Contact ── */}
        <ContactBar reviewerName={reviewer.display_name} />

      </div>
    </main>
  );
}
