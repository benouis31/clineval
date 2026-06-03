'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { checkpoints, likertOptions, harmOptionsForQuestion } from '../../lib/questionnaire';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────
type Reviewer = { id: string; code: string; display_name: string; email?: string };
type Case = { id: string; case_code: string; title: string; vignette_cp1: string; vignette_cp2: string; vignette_cp3: string; vignette_cp4: string; is_active: boolean };
type LLMOutput = { id: string; case_id: string; model_name: string; model_version?: string; model_output_cp1: string; model_output_cp2: string; model_output_cp3: string; model_output_cp4: string };
type Assignment = { id: string; reviewer_id: string; case_id: string; status: string; questionnaire_enabled: boolean; cases: Case };
type CaseSubmission = { diagnosis: string; differential_diagnosis: string; recommended_tests: string; treatment_plan: string; confidence_score: string; notes: string };
type LLMEvaluation = { id?: string; assignment_id: string; llm_output_id: string; answers: Record<string, any>; current_checkpoint: number; status: string };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const TOTAL_STEPS = checkpoints.length;
const CONTACT_EMAIL = 'jan-niklas.eckardt@ukdd.de';
const emptyCaseSubmission: CaseSubmission = { diagnosis: '', differential_diagnosis: '', recommended_tests: '', treatment_plan: '', confidence_score: '', notes: '' };

// ─── Helpers ──────────────────────────────────────────────────
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
    !q.id.endsWith('_explanation') && answers[q.id] !== undefined && answers[q.id] !== ''
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
function progressColor(pct: number) {
  if (pct === 100) return 'var(--accent)';
  if (pct > 0) return '#f0a500';
  return '#b4b2a9';
}

// ─── Sub-components ───────────────────────────────────────────
function OptionGroup({ value, options, onChange, disabled }: { value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="options">
      {options.map(o => (
        <button key={o} type="button" disabled={disabled}
          className={'option ' + (value === o ? 'selected' : '')}
          onClick={() => !disabled && onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
function SaveIndicator({ state, lastSavedAt }: { state: SaveState; lastSavedAt: string }) {
  if (state === 'saving') return <span className="save-status"><span className="save-dot" style={{ background: '#f0a500' }} />Saving…</span>;
  if (state === 'error') return <span className="save-status error"><span className="save-dot" />Save failed — try manually</span>;
  if (state === 'saved') return <span className="save-status saved"><span className="save-dot" />Saved {fmt(lastSavedAt)}</span>;
  return <span className="save-status">Last saved: {fmt(lastSavedAt)}</span>;
}

// ─── Main component ───────────────────────────────────────────
export default function ReviewerPage() {
  const [code, setCode] = useState('');
  const [reviewer, setReviewer] = useState<Reviewer | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [llmOutputsMap, setLlmOutputsMap] = useState<Record<string, LLMOutput[]>>({});
  const [caseSubmissionsMap, setCaseSubmissionsMap] = useState<Record<string, CaseSubmission & { status: string; savedAt: string }>>({});
  const [llmEvaluationsMap, setLlmEvaluationsMap] = useState<Record<string, LLMEvaluation>>({});

  // Active selection
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [selectedLLMOutput, setSelectedLLMOutput] = useState<LLMOutput | null>(null);

  // Task 1 state
  const [caseSubmission, setCaseSubmission] = useState<CaseSubmission>(emptyCaseSubmission);
  const [task1SaveState, setTask1SaveState] = useState<SaveState>('idle');
  const [task1SavedAt, setTask1SavedAt] = useState('');

  // Task 2 state
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [task2SaveState, setTask2SaveState] = useState<SaveState>('idle');
  const [task2SavedAt, setTask2SavedAt] = useState('');

  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [correctionMsg, setCorrectionMsg] = useState('');
  const [correctionSent, setCorrectionSent] = useState(false);
  const [view, setView] = useState<'dashboard' | 'task1' | 'task2'>('dashboard');

  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const caseSubmissionRef = useRef(caseSubmission);
  useEffect(() => { caseSubmissionRef.current = caseSubmission; }, [caseSubmission]);

  // ── Autosave ──
  useEffect(() => {
    if (!selectedAssignment) return;
    const timer = setInterval(() => {
      if (!hasUnsavedChanges || !isOnline) return;
      if (view === 'task1') persistTask1(caseSubmissionRef.current, 'draft', false);
      if (view === 'task2' && selectedLLMOutput) persistTask2(answers, checkpointIndex, false);
    }, 20000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssignment, selectedLLMOutput, view, answers, checkpointIndex, hasUnsavedChanges, isOnline]);

  // ── Login ──
  async function login() {
    setLoginError(''); setLoading(true);
    const { data: rev, error } = await supabase.from('reviewers').select('*').eq('code', code.trim().toUpperCase()).single();
    if (error || !rev) { setLoginError('Reviewer code not found. Please check your code or contact the study team.'); setLoading(false); return; }
    setReviewer(rev);

    // Load all assignments for this reviewer
    const { data: asgns } = await supabase
      .from('assignments').select('*, cases(*)')
      .eq('reviewer_id', rev.id).order('created_at');
    const assignmentList = asgns || [];
    setAssignments(assignmentList);

    // Load LLM outputs for all assigned cases
    const caseIds = [...new Set(assignmentList.map((a: any) => a.case_id))];
    if (caseIds.length > 0) {
      const { data: outputs } = await supabase.from('llm_outputs').select('*').in('case_id', caseIds).order('model_name');
      const outMap: Record<string, LLMOutput[]> = {};
      (outputs || []).forEach((o: any) => {
        if (!outMap[o.case_id]) outMap[o.case_id] = [];
        outMap[o.case_id].push(o);
      });
      setLlmOutputsMap(outMap);
    }

    // Load case submissions (Task 1)
    const { data: submissions } = await supabase.from('case_submissions').select('*').eq('reviewer_id', rev.id);
    const subMap: Record<string, any> = {};
    (submissions || []).forEach((s: any) => {
      subMap[s.assignment_id] = {
        diagnosis: s.diagnosis || '', differential_diagnosis: s.differential_diagnosis || '',
        recommended_tests: s.recommended_tests || '', treatment_plan: s.treatment_plan || '',
        confidence_score: s.confidence_score ? String(s.confidence_score) : '', notes: s.notes || '',
        status: s.status || 'draft', savedAt: s.updated_at || ''
      };
    });
    setCaseSubmissionsMap(subMap);

    // Load LLM evaluations (Task 2)
    const assignmentIds = assignmentList.map((a: any) => a.id);
    if (assignmentIds.length > 0) {
      const { data: evals } = await supabase.from('llm_evaluations').select('*').in('assignment_id', assignmentIds);
      const evalMap: Record<string, LLMEvaluation> = {};
      (evals || []).forEach((e: any) => {
        const key = `${e.assignment_id}__${e.llm_output_id}`;
        evalMap[key] = { id: e.id, assignment_id: e.assignment_id, llm_output_id: e.llm_output_id, answers: e.answers || {}, current_checkpoint: e.current_checkpoint || 1, status: e.status };
      });
      setLlmEvaluationsMap(evalMap);
    }
    setLoading(false);
  }

  // ── Open Task 1 ──
  function openTask1(assignment: Assignment) {
    setSelectedAssignment(assignment);
    const existing = caseSubmissionsMap[assignment.id];
    if (existing) {
      setCaseSubmission({ diagnosis: existing.diagnosis, differential_diagnosis: existing.differential_diagnosis, recommended_tests: existing.recommended_tests, treatment_plan: existing.treatment_plan, confidence_score: existing.confidence_score, notes: existing.notes });
      setTask1SavedAt(existing.savedAt);
    } else {
      setCaseSubmission(emptyCaseSubmission);
      setTask1SavedAt('');
    }
    setTask1SaveState('idle');
    setView('task1');
    window.scrollTo(0, 0);
  }

  // ── Open Task 2 ──
  function openTask2(assignment: Assignment, llmOutput: LLMOutput) {
    setSelectedAssignment(assignment);
    setSelectedLLMOutput(llmOutput);
    const key = `${assignment.id}__${llmOutput.id}`;
    const existing = llmEvaluationsMap[key];
    if (existing) {
      setAnswers(existing.answers);
      setCheckpointIndex((existing.current_checkpoint || 1) - 1);
      setTask2SavedAt(existing.status === 'submitted' ? '' : '');
    } else {
      setAnswers({});
      setCheckpointIndex(0);
    }
    setTask2SaveState('idle');
    setTask2SavedAt('');
    setHasUnsavedChanges(false);
    setView('task2');
    window.scrollTo(0, 0);
  }

  // ── Persist Task 1 ──
  async function persistTask1(values: CaseSubmission, status: 'draft' | 'submitted' = 'draft', showFeedback = true) {
    if (!selectedAssignment || !reviewer || !isOnline) return;
    if (showFeedback) setTask1SaveState('saving');
    const now = new Date().toISOString();
    const confidence = values.confidence_score ? Number(values.confidence_score) : null;
    const { error } = await supabase.from('case_submissions').upsert({
      assignment_id: selectedAssignment.id, reviewer_id: reviewer.id, case_id: selectedAssignment.case_id,
      diagnosis: values.diagnosis, differential_diagnosis: values.differential_diagnosis,
      recommended_tests: values.recommended_tests, treatment_plan: values.treatment_plan,
      confidence_score: confidence, notes: values.notes, status, updated_at: now,
      submitted_at: status === 'submitted' ? now : null
    }, { onConflict: 'assignment_id' });
    if (error) { if (showFeedback) setTask1SaveState('error'); return; }
    setTask1SavedAt(now);
    if (showFeedback) setTask1SaveState('saved');
    setHasUnsavedChanges(false);
    // Update local map
    setCaseSubmissionsMap(prev => ({
      ...prev,
      [selectedAssignment.id]: { ...values, status, savedAt: now }
    }));
    if (status === 'submitted') {
      // Enable questionnaire on this assignment
      await supabase.from('assignments').update({ questionnaire_enabled: true, updated_at: now }).eq('id', selectedAssignment.id);
      setAssignments(prev => prev.map(a => a.id === selectedAssignment.id ? { ...a, questionnaire_enabled: true } : a));
      setSelectedAssignment(prev => prev ? { ...prev, questionnaire_enabled: true } : prev);
      await supabase.from('reviewer_audit_log').insert({ assignment_id: selectedAssignment.id, reviewer_id: reviewer.id, case_id: selectedAssignment.case_id, event_type: 'task1_submitted', created_at: now });
    }
  }

  async function submitTask1() {
    if (!caseSubmission.diagnosis.trim()) return alert('Please fill in your most likely diagnosis.');
    if (!caseSubmission.recommended_tests.trim()) return alert('Please fill in your recommended diagnostic tests.');
    const score = Number(caseSubmission.confidence_score);
    if (!caseSubmission.confidence_score || isNaN(score) || score < 1 || score > 5) return alert('Please select a confidence score (1-5).');
    if (!confirm('Submit your independent case assessment? You will not be able to edit it afterwards.')) return;
    await persistTask1(caseSubmission, 'submitted', true);
  }

  // ── Persist Task 2 ──
  async function persistTask2(nextAnswers = answers, nextCheckpoint = checkpointIndex, showFeedback = true) {
    if (!selectedAssignment || !selectedLLMOutput || !isOnline) return;
    if (showFeedback) setTask2SaveState('saving');
    const now = new Date().toISOString();
    const key = `${selectedAssignment.id}__${selectedLLMOutput.id}`;
    const existing = llmEvaluationsMap[key];
    const { error } = await supabase.from('llm_evaluations').upsert({
      ...(existing?.id ? { id: existing.id } : {}),
      assignment_id: selectedAssignment.id, llm_output_id: selectedLLMOutput.id,
      reviewer_id: reviewer!.id, case_id: selectedAssignment.case_id,
      answers: nextAnswers, current_checkpoint: nextCheckpoint + 1,
      status: 'in_progress', updated_at: now
    }, { onConflict: 'assignment_id,llm_output_id' });
    if (error) { if (showFeedback) setTask2SaveState('error'); return; }
    setTask2SavedAt(now);
    if (showFeedback) setTask2SaveState('saved');
    setHasUnsavedChanges(false);
    setLlmEvaluationsMap(prev => ({ ...prev, [key]: { ...prev[key], assignment_id: selectedAssignment.id, llm_output_id: selectedLLMOutput.id, answers: nextAnswers, current_checkpoint: nextCheckpoint + 1, status: 'in_progress' } }));
  }

  async function saveAnswer(questionId: string, value: string) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    setHasUnsavedChanges(true);
    await persistTask2(next, checkpointIndex);
  }

  async function submitTask2() {
    if (!selectedAssignment || !selectedLLMOutput || !reviewer) return;
    if (!confirm('Submit evaluation for this LLM? This will lock your answers.')) return;
    setTask2SaveState('saving');
    const now = new Date().toISOString();
    const key = `${selectedAssignment.id}__${selectedLLMOutput.id}`;
    const existing = llmEvaluationsMap[key];
    await supabase.from('llm_evaluations').upsert({
      ...(existing?.id ? { id: existing.id } : {}),
      assignment_id: selectedAssignment.id, llm_output_id: selectedLLMOutput.id,
      reviewer_id: reviewer.id, case_id: selectedAssignment.case_id,
      answers, current_checkpoint: TOTAL_STEPS, status: 'submitted',
      updated_at: now, submitted_at: now
    }, { onConflict: 'assignment_id,llm_output_id' });
    setLlmEvaluationsMap(prev => ({ ...prev, [key]: { ...prev[key], assignment_id: selectedAssignment.id, llm_output_id: selectedLLMOutput.id, answers, current_checkpoint: TOTAL_STEPS, status: 'submitted' } }));
    setTask2SaveState('saved');
    // Check if all LLM evaluations for this assignment are submitted
    const allOutputs = llmOutputsMap[selectedAssignment.case_id] || [];
    const allSubmitted = allOutputs.every(o => {
      const k = `${selectedAssignment.id}__${o.id}`;
      return k === key || llmEvaluationsMap[k]?.status === 'submitted';
    });
    if (allSubmitted) {
      await supabase.from('assignments').update({ status: 'submitted', updated_at: now }).eq('id', selectedAssignment.id);
      setAssignments(prev => prev.map(a => a.id === selectedAssignment.id ? { ...a, status: 'submitted' } : a));
    }
    alert('Evaluation submitted! Returning to your dashboard.');
    setView('dashboard');
  }

  // ── Overall progress ──
  function overallProgress() {
    let totalEvals = 0, submittedEvals = 0, task1Done = 0;
    assignments.forEach(a => {
      const sub = caseSubmissionsMap[a.id];
      if (sub?.status === 'submitted') task1Done++;
      const outputs = llmOutputsMap[a.case_id] || [];
      totalEvals += outputs.length;
      outputs.forEach(o => {
        const key = `${a.id}__${o.id}`;
        if (llmEvaluationsMap[key]?.status === 'submitted') submittedEvals++;
      });
    });
    return { totalEvals, submittedEvals, task1Done, totalCases: assignments.length };
  }

  // ══════════════════════════════════════════════════════
  // RENDER: Login
  // ══════════════════════════════════════════════════════
  if (!reviewer) return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 420, padding: 20 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🩺</div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24 }}>ClinEval</h1>
          <p style={{ color: 'var(--muted)', marginTop: 0, marginBottom: 24, fontSize: 15 }}>Expert clinician evaluation platform</p>
          <input className="input" value={code} onChange={e => { setCode(e.target.value); setLoginError(''); }}
            onKeyDown={e => e.key === 'Enter' && !loading && login()}
            placeholder="Your reviewer code (e.g. PROF_01)"
            style={{ fontSize: 18, letterSpacing: 2, marginBottom: 12 }} autoFocus />
          {loginError && <div className="alert alert-danger" style={{ marginBottom: 12, textAlign: 'left' }}>{loginError}</div>}
          <button className="btn btn-primary btn-lg" onClick={login} disabled={loading || !code.trim()} style={{ width: '100%' }}>
            {loading ? 'Loading…' : 'Enter'}
          </button>
          <p style={{ marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
            Problems? <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>{CONTACT_EMAIL}</a>
          </p>
        </div>
      </div>
    </main>
  );

  const { totalEvals, submittedEvals, task1Done, totalCases } = overallProgress();

  // ══════════════════════════════════════════════════════
  // RENDER: Task 1
  // ══════════════════════════════════════════════════════
  if (view === 'task1' && selectedAssignment) {
    const cs = caseSubmissionsMap[selectedAssignment.id];
    const isSubmitted = cs?.status === 'submitted';
    return (
      <main>
        <div className="topbar">
          <div className="topbar-left">
            <button className="btn btn-secondary btn-small" onClick={() => setView('dashboard')}>← Back</button>
            <span className="topbar-title">Independent Assessment</span>
          </div>
          <div className="topbar-right">
            {!isOnline && <span style={{ background: 'var(--danger)', color: 'white', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999 }}>⚠ Offline</span>}
            <SaveIndicator state={task1SaveState} lastSavedAt={task1SavedAt} />
          </div>
        </div>
        {!isOnline && <div className="offline-bar">⚠ You are offline — changes will not be saved until reconnected.</div>}
        <div className="container">
          <div className="card">
            <div className="task-header">
              <div className="task-number">1</div>
              <div>
                <div className="task-title">Task 1 — Independent Case Assessment</div>
                <div className="task-subtitle">Case: {selectedAssignment.cases?.case_code} · {selectedAssignment.cases?.title}</div>
              </div>
            </div>
            {isSubmitted ? (
              <div className="alert alert-success">✅ Your independent assessment has been submitted and locked. Scroll down to evaluate the LLM outputs for this case.</div>
            ) : (
              <div className="alert alert-warn"><strong>Important:</strong> Record your own clinical assessment before seeing any AI output. Your independent opinion is essential for this study.</div>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Case presentation</h3>
            <div className="vignette">{selectedAssignment.cases?.vignette_cp1}</div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Your independent assessment</h3>
            {([
              { label: 'Most likely diagnosis', key: 'diagnosis', required: true, hint: 'State the single most likely diagnosis.' },
              { label: 'Differential diagnoses', key: 'differential_diagnosis', required: false, hint: 'List other diagnoses you are considering, ranked by likelihood.' },
              { label: 'Recommended diagnostic tests', key: 'recommended_tests', required: true, hint: 'List the further tests you would order at this stage.' },
              { label: 'Initial treatment plan', key: 'treatment_plan', required: false, hint: 'Describe your preferred treatment approach if applicable at this stage.' },
              { label: 'Additional notes', key: 'notes', required: false, hint: 'Anything else relevant to your assessment.' },
            ] as { label: string; key: keyof CaseSubmission; required: boolean; hint: string }[]).map(({ label, key, required, hint }) => (
              <div key={key} style={{ marginBottom: 20 }}>
                <label>{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>{hint}</div>
                <textarea className="input" value={caseSubmission[key]}
                  disabled={isSubmitted}
                  onChange={e => { setCaseSubmission(prev => ({ ...prev, [key]: e.target.value })); setHasUnsavedChanges(true); }}
                  onBlur={() => !isSubmitted && persistTask1(caseSubmission, 'draft', true)}
                  placeholder={isSubmitted ? '' : `Enter your ${label.toLowerCase()}…`} />
              </div>
            ))}
            <div style={{ marginBottom: 20 }}>
              <label>Confidence score (1–5)<span style={{ color: 'var(--danger)' }}> *</span></label>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>1 = not confident · 5 = very confident</div>
              <div className="options">
                {['1','2','3','4','5'].map(n => (
                  <button key={n} type="button" disabled={isSubmitted}
                    className={'option ' + (caseSubmission.confidence_score === n ? 'selected' : '')}
                    onClick={() => { setCaseSubmission(prev => ({ ...prev, confidence_score: n })); setHasUnsavedChanges(true); }}
                    style={{ minWidth: 52, fontSize: 16, fontWeight: 700 }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {!isSubmitted && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <SaveIndicator state={task1SaveState} lastSavedAt={task1SavedAt} />
                <div className="row">
                  <button className="btn btn-secondary" onClick={() => persistTask1(caseSubmission, 'draft', true)} disabled={!isOnline}>Save draft</button>
                  <button className="btn btn-primary btn-lg" onClick={submitTask1} disabled={!isOnline || !caseSubmission.diagnosis.trim()}>Submit Task 1 →</button>
                </div>
              </div>
            )}
            {isSubmitted && (
              <div style={{ paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <button className="btn btn-primary" onClick={() => setView('dashboard')}>← Back to dashboard to start questionnaire</button>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ══════════════════════════════════════════════════════
  // RENDER: Task 2
  // ══════════════════════════════════════════════════════
  if (view === 'task2' && selectedAssignment && selectedLLMOutput) {
    const key = `${selectedAssignment.id}__${selectedLLMOutput.id}`;
    const evalData = llmEvaluationsMap[key];
    const isSubmitted = evalData?.status === 'submitted';
    const cp = checkpoints[checkpointIndex];
    const stepNumber = checkpointIndex + 1;
    const answeredCount = countAnswered(answers);
    const totalVisible = visibleQuestions(answers).length;
    const pct = Math.round((answeredCount / (totalVisible || 1)) * 100);
    const cpKey = `vignette_cp${cp.id.replace('cp', '')}` as keyof LLMOutput;
    const modelKey = `model_output_cp${cp.id.replace('cp', '')}` as keyof LLMOutput;

    return (
      <main>
        <div className="topbar">
          <div className="topbar-left">
            <button className="btn btn-secondary btn-small" onClick={() => setView('dashboard')}>← Back</button>
            <span className="topbar-title">{selectedLLMOutput.model_name}</span>
            <span className="badge">{selectedAssignment.cases?.case_code}</span>
          </div>
          <div className="topbar-right">
            {!isOnline && <span style={{ background: 'var(--danger)', color: 'white', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999 }}>⚠ Offline</span>}
            <SaveIndicator state={task2SaveState} lastSavedAt={task2SavedAt} />
            <button className="btn btn-secondary btn-small" onClick={() => persistTask2(answers, checkpointIndex, true)} disabled={!isOnline}>Save draft</button>
          </div>
        </div>
        {!isOnline && <div className="offline-bar">⚠ You are offline — changes will not be saved until reconnected.</div>}
        <div className="container">
          <div className="card">
            <h1 style={{ marginTop: 0, fontSize: 20 }}>{cp.title}</h1>
            <div className="steps">
              {checkpoints.map((c, i) => (
                <div key={c.id} className={`step ${i < checkpointIndex ? 'done' : i === checkpointIndex ? 'active' : ''}`}>
                  {i < checkpointIndex ? '✓ ' : ''}{c.shortTitle}
                </div>
              ))}
            </div>
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
            <div className="progress-label">{answeredCount} of {totalVisible} questions answered ({pct}%)</div>
            <div className="alert alert-warn" style={{ marginTop: 12 }}><strong>Instruction:</strong> {cp.instruction}</div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Case information — Checkpoint {stepNumber}</h3>
            <div className="vignette" style={{ marginBottom: 12 }}>{selectedAssignment.cases?.[cpKey as keyof Case] as string}</div>
            <h3>AI model output — {selectedLLMOutput.model_name}</h3>
            <div className="vignette">{selectedLLMOutput[modelKey] as string}</div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Your evaluation</h3>
            <p className="small">Likert: 1 = Strongly disagree · 2 = Disagree · 3 = Neutral · 4 = Agree · 5 = Strongly agree</p>
            {cp.questions.map((q: any) => {
              if (q.conditional && answers[q.conditional.question] !== q.conditional.value) return null;
              return (
                <div className="question" key={q.id}>
                  <div className="question-text">{q.text}</div>
                  {q.description && <p className="small" style={{ marginBottom: 8 }}>{q.description}</p>}
                  {q.type === 'likert' && <OptionGroup value={answers[q.id]} options={likertOptions} onChange={v => saveAnswer(q.id, v)} disabled={isSubmitted} />}
                  {q.type === 'yesno' && <OptionGroup value={answers[q.id]} options={['Yes', 'No']} onChange={v => saveAnswer(q.id, v)} disabled={isSubmitted} />}
                  {q.type === 'harm' && <>
                    <OptionGroup value={answers[q.id]} options={harmOptionsForQuestion(q.id)} onChange={v => saveAnswer(q.id, v)} disabled={isSubmitted} />
                    {answers[q.id] === 'Severe harm likely' && (
                      <textarea className="input harm-explanation" placeholder="Please explain the potential harm…"
                        value={answers[q.id + '_explanation'] || ''}
                        disabled={isSubmitted}
                        onChange={e => setAnswers(prev => ({ ...prev, [q.id + '_explanation']: e.target.value }))}
                        onBlur={e => !isSubmitted && saveAnswer(q.id + '_explanation', e.target.value)} />
                    )}
                  </>}
                  {q.type === 'text' && (
                    <textarea className="input" value={answers[q.id] || ''} disabled={isSubmitted}
                      onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                      onBlur={e => !isSubmitted && saveAnswer(q.id, e.target.value)}
                      placeholder="Your comments (optional)…" />
                  )}
                </div>
              );
            })}
            <div className="question">
              <div className="question-text" style={{ color: 'var(--muted)', fontWeight: 500 }}>Private notes (not shared with study team)</div>
              <textarea className="input" value={answers[`private_notes_cp${stepNumber}`] || ''} disabled={isSubmitted}
                onChange={e => setAnswers(prev => ({ ...prev, [`private_notes_cp${stepNumber}`]: e.target.value }))}
                onBlur={e => !isSubmitted && saveAnswer(`private_notes_cp${stepNumber}`, e.target.value)}
                placeholder="Optional personal notes…" />
            </div>

            {!isSubmitted && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <SaveIndicator state={task2SaveState} lastSavedAt={task2SavedAt} />
                <div className="nav-row" style={{ flex: 1, marginTop: 0 }}>
                  <button className="btn btn-secondary" disabled={checkpointIndex === 0} onClick={() => setCheckpointIndex(i => i - 1)}>← Back</button>
                  <button className="btn btn-secondary btn-small" onClick={() => persistTask2(answers, checkpointIndex, true)} disabled={!isOnline}>Save draft</button>
                  {checkpointIndex < TOTAL_STEPS - 1 ? (
                    <button className="btn btn-primary" onClick={() => { persistTask2(answers, checkpointIndex); setCheckpointIndex(i => i + 1); }} disabled={!isOnline}>Save & continue →</button>
                  ) : (
                    <button className="btn btn-primary btn-lg" onClick={submitTask2} disabled={!isOnline}>Submit evaluation ✓</button>
                  )}
                </div>
              </div>
            )}
            {isSubmitted && (
              <div style={{ paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <div className="alert alert-success">✅ This evaluation has been submitted.</div>
                <button className="btn btn-secondary" onClick={() => setView('dashboard')}>← Back to dashboard</button>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ══════════════════════════════════════════════════════
  // RENDER: Dashboard
  // ══════════════════════════════════════════════════════
  const allDone = totalEvals > 0 && submittedEvals === totalEvals && task1Done === totalCases;

  return (
    <main>
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">ClinEval</span>
          <span className="badge">{reviewer.display_name}</span>
        </div>
        <div className="topbar-right">
          {!isOnline && <span style={{ background: 'var(--danger)', color: 'white', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999 }}>⚠ Offline</span>}
          <a href={`mailto:${CONTACT_EMAIL}?subject=ClinEval — ${reviewer.display_name}`} className="btn btn-secondary btn-small">Contact us</a>
        </div>
      </div>

      <div className="container">
        {allDone ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <h1>All evaluations complete!</h1>
            <p style={{ color: 'var(--muted)', fontSize: 15 }}>Thank you, <strong>{reviewer.display_name}</strong>. Your contribution is greatly appreciated.</p>
            <button className="btn btn-secondary" style={{ marginTop: 20 }}
              onClick={() => downloadBlob(`${reviewer.code}_all_evaluations.json`, { reviewer_code: reviewer.code, evaluations: llmEvaluationsMap, exported_at: new Date().toISOString() })}>
              Download all my answers
            </button>
          </div>
        ) : (
          <div className="card">
            <h1 style={{ marginTop: 0, fontSize: 22 }}>Welcome, {reviewer.display_name}</h1>
            <p style={{ color: 'var(--muted)', fontSize: 15, marginBottom: 16 }}>
              For each case: complete <strong>Task 1</strong> (your independent assessment) first, then evaluate each LLM output in <strong>Task 2</strong>.
            </p>
            <div className="row" style={{ gap: 12 }}>
              {[
                { label: 'Cases assigned', value: totalCases, color: 'var(--text)' },
                { label: 'Task 1 submitted', value: `${task1Done} / ${totalCases}`, color: task1Done === totalCases ? 'var(--accent)' : 'var(--warn)' },
                { label: 'Evaluations done', value: `${submittedEvals} / ${totalEvals}`, color: submittedEvals === totalEvals && totalEvals > 0 ? 'var(--accent)' : 'var(--warn)' },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, minWidth: 120, background: '#f9f8f5', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Case list */}
        {assignments.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: 'var(--muted)' }}>No cases assigned yet. The study coordinator will notify you when your case is ready.</p>
          </div>
        ) : assignments.map(assignment => {
          const cs = caseSubmissionsMap[assignment.id];
          const task1Status = cs?.status === 'submitted' ? 'submitted' : cs ? 'draft' : 'not_started';
          const llmOutputs = llmOutputsMap[assignment.case_id] || [];
          const isActive = assignment.cases?.is_active;

          return (
            <div key={assignment.id} className={`card-task ${isActive ? 'task-active' : ''}`} style={{ opacity: isActive ? 1 : 0.6 }}>
              <div className="task-header">
                <div className="task-number" style={{ background: assignment.status === 'submitted' ? 'var(--accent)' : isActive ? 'var(--accent)' : '#b0b0a8' }}>
                  {assignment.status === 'submitted' ? '✓' : isActive ? '→' : '⏳'}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="task-title">{assignment.cases?.case_code}</div>
                  <div className="task-subtitle">{assignment.cases?.title}</div>
                </div>
                {!isActive && <span className="badge" style={{ background: '#f1eee8', color: 'var(--muted)' }}>Not yet active</span>}
                {assignment.status === 'submitted' && <span className="badge badge-done">Case complete</span>}
              </div>

              {!isActive ? (
                <div className="alert alert-info">The study coordinator will activate this case when it is ready.</div>
              ) : (
                <>
                  {/* Task 1 block */}
                  <div style={{ background: '#f9f8f5', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 20px', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>
                          Task 1 — Independent Assessment
                          {task1Status === 'submitted' && <span style={{ color: 'var(--accent)', marginLeft: 8 }}>✅ Submitted</span>}
                          {task1Status === 'draft' && <span style={{ color: 'var(--warn)', marginLeft: 8 }}>✏️ Draft saved</span>}
                          {task1Status === 'not_started' && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>Not started</span>}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                          {task1Status === 'submitted' ? 'Locked — your independent assessment has been recorded.' : 'Record your assessment before seeing any AI output.'}
                        </div>
                      </div>
                      <button
                        className={`btn btn-small ${task1Status === 'submitted' ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => openTask1(assignment)}>
                        {task1Status === 'submitted' ? 'View' : task1Status === 'draft' ? 'Continue' : 'Start Task 1'}
                      </button>
                    </div>
                  </div>

                  {/* Task 2 — LLM outputs */}
                  <div style={{ background: assignment.questionnaire_enabled ? '#f9f8f5' : '#fafaf8', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 20px', opacity: assignment.questionnaire_enabled ? 1 : 0.6 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
                      Task 2 — Expert Questionnaire
                      {!assignment.questionnaire_enabled && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 13, marginLeft: 8 }}>🔒 Unlocks after Task 1 submission</span>}
                    </div>
                    {!assignment.questionnaire_enabled ? (
                      <div style={{ fontSize: 13, color: 'var(--muted)' }}>Submit Task 1 to unlock the expert questionnaire for this case.</div>
                    ) : llmOutputs.length === 0 ? (
                      <div style={{ fontSize: 13, color: 'var(--muted)' }}>No LLM outputs uploaded for this case yet. The study coordinator will add them shortly.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {llmOutputs.map(output => {
                          const evalKey = `${assignment.id}__${output.id}`;
                          const evalData = llmEvaluationsMap[evalKey];
                          const evalStatus = evalData?.status || 'not_started';
                          const evalAnswers = evalData?.answers || {};
                          const answered = countAnswered(evalAnswers);
                          const total = visibleQuestions(evalAnswers).length || 37;
                          const pct = Math.round((answered / total) * 100);
                          return (
                            <div key={output.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 16px' }}>
                              <div style={{ flex: 1, minWidth: 160 }}>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{output.model_name}{output.model_version && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}> {output.model_version}</span>}</div>
                                {evalStatus === 'submitted' ? (
                                  <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>✅ Submitted</div>
                                ) : evalStatus === 'in_progress' ? (
                                  <div style={{ marginTop: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <div style={{ flex: 1, height: 4, background: '#e8e4db', borderRadius: 999, overflow: 'hidden' }}>
                                        <div style={{ width: `${pct}%`, height: '100%', background: progressColor(pct), borderRadius: 999 }} />
                                      </div>
                                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{answered}/{total}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Not started</div>
                                )}
                              </div>
                              <button
                                className={`btn btn-small ${evalStatus === 'submitted' ? 'btn-secondary' : 'btn-primary'}`}
                                onClick={() => openTask2(assignment, output)}>
                                {evalStatus === 'submitted' ? 'View' : evalStatus === 'in_progress' ? 'Continue' : 'Start'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Contact */}
        <div className="contact-box" style={{ marginTop: 8 }}>
          <span style={{ fontSize: 22 }}>💬</span>
          <div>
            <strong>Need help or found an issue?</strong>
            <div style={{ fontSize: 14, marginTop: 2 }}>
              Contact the study team at{' '}
              <a href={`mailto:${CONTACT_EMAIL}?subject=ClinEval — ${reviewer.display_name}`}>{CONTACT_EMAIL}</a>
            </div>
          </div>
        </div>

        {/* Correction note — shown after at least one submission */}
        {submittedEvals > 0 && (
          <div className="card" style={{ marginTop: 8 }}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>Send a correction or note</h2>
            {correctionSent ? (
              <div className="alert alert-success">Your message has been sent. Thank you!</div>
            ) : (
              <>
                <textarea className="input" value={correctionMsg} onChange={e => setCorrectionMsg(e.target.value)} placeholder="If you noticed a mistake, describe it here…" style={{ minHeight: 80 }} />
                <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={!correctionMsg.trim()}
                  onClick={async () => {
                    if (!assignments[0]) return;
                    await supabase.from('reviewer_messages').insert({ assignment_id: assignments[0].id, reviewer_id: reviewer.id, case_id: assignments[0].case_id, message: correctionMsg.trim(), message_type: 'correction_request' });
                    setCorrectionSent(true); setCorrectionMsg('');
                  }}>
                  Send message
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
