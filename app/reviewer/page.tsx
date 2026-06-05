'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { checkpoints, likertOptions, harmOptionsForQuestion } from '../../lib/questionnaire';

export const dynamic = 'force-dynamic';

type Reviewer = { id: string; code: string; display_name: string; email?: string; disease_entity?: string };
type Case = { id: string; case_code: string; title: string; disease_entity?: string; vignette_cp1: string; vignette_cp2: string; vignette_cp3: string; vignette_cp4: string; is_active: boolean };
type LLMOutput = { id: string; case_id: string; model_name: string; model_version?: string; model_output_cp1: string; model_output_cp2: string; model_output_cp3: string; model_output_cp4: string };
type Assignment = { id: string; reviewer_id: string; case_id: string; status: string; questionnaire_enabled: boolean; cases: Case };
type LLMEvaluation = { id?: string; assignment_id: string; llm_output_id: string; answers: Record<string, any>; current_checkpoint: number; status: string };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const TOTAL_STEPS = checkpoints.length;
const CONTACT_EMAIL = 'jan-niklas.eckardt@ukdd.de';

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
function progressColor(pct: number) {
  if (pct === 100) return 'var(--accent)';
  if (pct > 0) return '#f0a500';
  return '#b4b2a9';
}

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

export default function ReviewerPage() {
  const [code, setCode] = useState('');
  const [reviewer, setReviewer] = useState<Reviewer | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [llmOutputsMap, setLlmOutputsMap] = useState<Record<string, LLMOutput[]>>({});
  const [llmEvaluationsMap, setLlmEvaluationsMap] = useState<Record<string, LLMEvaluation>>({});
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [selectedLLMOutput, setSelectedLLMOutput] = useState<LLMOutput | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [correctionMsg, setCorrectionMsg] = useState('');
  const [correctionSent, setCorrectionSent] = useState(false);
  const [view, setView] = useState<'dashboard' | 'evaluate'>('dashboard');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const answersRef = useRef(answers);
  useEffect(() => { answersRef.current = answers; }, [answers]);

  useEffect(() => {
    if (!selectedAssignment || !selectedLLMOutput) return;
    const timer = setInterval(() => {
      if (!hasUnsaved || !isOnline) return;
      persistEvaluation(answersRef.current, checkpointIndex, false);
    }, 20000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssignment, selectedLLMOutput, checkpointIndex, hasUnsaved, isOnline]);

  async function login() {
    setLoginError(''); setLoading(true);
    const { data: rev, error } = await supabase.from('reviewers').select('*').eq('code', code.trim().toUpperCase()).single();
    if (error || !rev) { setLoginError('Reviewer code not found. Please check your code or contact the study team.'); setLoading(false); return; }
    setReviewer(rev);

    // Load ALL active cases for this disease entity
    const { data: allCases } = await supabase
      .from('cases').select('*')
      .eq('disease_entity', rev.disease_entity)
      .eq('is_active', true)
      .order('created_at');

    // Load or create assignments for all cases
    const { data: existingAssignments } = await supabase
      .from('assignments').select('*, cases(*)')
      .eq('reviewer_id', rev.id);

    // Create missing assignments
    const existingCaseIds = new Set((existingAssignments || []).map((a: any) => a.case_id));
    const toCreate = (allCases || []).filter(c => !existingCaseIds.has(c.id));
    if (toCreate.length > 0) {
      await supabase.from('assignments').insert(
        toCreate.map(c => ({ reviewer_id: rev.id, case_id: c.id, status: 'not_started', questionnaire_enabled: true }))
      );
    }

    // Reload assignments
    const { data: finalAssignments } = await supabase
      .from('assignments').select('*, cases(*)')
      .eq('reviewer_id', rev.id)
      .order('created_at');
    setAssignments(finalAssignments || []);

    // Load LLM outputs
    const caseIds = [...new Set((finalAssignments || []).map((a: any) => a.case_id))];
    if (caseIds.length > 0) {
      const { data: outputs } = await supabase.from('llm_outputs').select('*').in('case_id', caseIds).order('model_name');
      const outMap: Record<string, LLMOutput[]> = {};
      (outputs || []).forEach((o: any) => {
        if (!outMap[o.case_id]) outMap[o.case_id] = [];
        outMap[o.case_id].push(o);
      });
      setLlmOutputsMap(outMap);
    }

    // Load evaluations
    const assignmentIds = (finalAssignments || []).map((a: any) => a.id);
    if (assignmentIds.length > 0) {
      const { data: evals } = await supabase.from('llm_evaluations').select('*').in('assignment_id', assignmentIds);
      const evalMap: Record<string, LLMEvaluation> = {};
      (evals || []).forEach((e: any) => {
        evalMap[`${e.assignment_id}__${e.llm_output_id}`] = { id: e.id, assignment_id: e.assignment_id, llm_output_id: e.llm_output_id, answers: e.answers || {}, current_checkpoint: e.current_checkpoint || 1, status: e.status };
      });
      setLlmEvaluationsMap(evalMap);
    }
    setLoading(false);
  }

  function openEvaluation(assignment: Assignment, llmOutput: LLMOutput) {
    setSelectedAssignment(assignment);
    setSelectedLLMOutput(llmOutput);
    const key = `${assignment.id}__${llmOutput.id}`;
    const existing = llmEvaluationsMap[key];
    setAnswers(existing?.answers || {});
    setCheckpointIndex((existing?.current_checkpoint || 1) - 1);
    setSaveState('idle'); setSavedAt(''); setHasUnsaved(false);
    setView('evaluate');
    window.scrollTo(0, 0);
  }

  async function persistEvaluation(nextAnswers = answers, nextCheckpoint = checkpointIndex, showFeedback = true) {
    if (!selectedAssignment || !selectedLLMOutput || !isOnline) return;
    if (showFeedback) setSaveState('saving');
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
    if (error) { if (showFeedback) setSaveState('error'); return; }
    setSavedAt(now);
    if (showFeedback) setSaveState('saved');
    setHasUnsaved(false);
    setLlmEvaluationsMap(prev => ({ ...prev, [key]: { ...prev[key], assignment_id: selectedAssignment.id, llm_output_id: selectedLLMOutput.id, answers: nextAnswers, current_checkpoint: nextCheckpoint + 1, status: 'in_progress' } }));
  }

  async function saveAnswer(questionId: string, value: string) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next); setHasUnsaved(true);
    await persistEvaluation(next, checkpointIndex);
  }

  async function submitEvaluation() {
    if (!selectedAssignment || !selectedLLMOutput || !reviewer) return;
    if (!confirm('Submit this evaluation? Your answers will be locked.')) return;
    setSaveState('saving');
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
    setSaveState('saved');
    alert('Evaluation submitted! Returning to dashboard.');
    setView('dashboard');
  }

  function overallProgress() {
    let total = 0, submitted = 0;
    assignments.forEach(a => {
      const outputs = llmOutputsMap[a.case_id] || [];
      total += outputs.length;
      outputs.forEach(o => {
        if (llmEvaluationsMap[`${a.id}__${o.id}`]?.status === 'submitted') submitted++;
      });
    });
    return { total, submitted };
  }

  // ── Login ──
  if (!reviewer) return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 420, padding: 20 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🩺</div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24 }}>ClinEval</h1>
          <p style={{ color: 'var(--muted)', marginTop: 0, marginBottom: 24, fontSize: 15 }}>Expert clinician evaluation platform</p>
          <input className="input" value={code} onChange={e => { setCode(e.target.value); setLoginError(''); }}
            onKeyDown={e => e.key === 'Enter' && !loading && login()}
            placeholder="Your reviewer code (e.g. AML_01)"
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

  const { total, submitted } = overallProgress();

  // ── Evaluation view ──
  if (view === 'evaluate' && selectedAssignment && selectedLLMOutput) {
    const key = `${selectedAssignment.id}__${selectedLLMOutput.id}`;
    const evalData = llmEvaluationsMap[key];
    const isSubmitted = evalData?.status === 'submitted';
    const cp = checkpoints[checkpointIndex];
    const answered = countAnswered(answers);
    const totalVisible = visibleQuestions(answers).length;
    const pct = Math.round((answered / (totalVisible || 1)) * 100);
    const cpKey = `vignette_cp${cp.id.replace('cp', '')}` as keyof Case;
    const modelKey = `model_output_cp${cp.id.replace('cp', '')}` as keyof LLMOutput;

    return (
      <main>
        <div className="topbar">
          <div className="topbar-left">
            <button className="btn btn-secondary btn-small" onClick={() => setView('dashboard')}>← Back</button>
            <span className="topbar-title">{selectedLLMOutput.model_name}</span>
            <span className="badge">{selectedAssignment.cases?.case_code}</span>
            {reviewer.disease_entity && <span className="badge" style={{ background: 'var(--accent)', color: 'white' }}>{reviewer.disease_entity}</span>}
          </div>
          <div className="topbar-right">
            {!isOnline && <span style={{ background: 'var(--danger)', color: 'white', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999 }}>⚠ Offline</span>}
            <SaveIndicator state={saveState} lastSavedAt={savedAt} />
            <button className="btn btn-secondary btn-small" onClick={() => persistEvaluation(answers, checkpointIndex, true)} disabled={!isOnline}>Save draft</button>
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
            <div className="progress-label">{answered} of {totalVisible} questions answered ({pct}%)</div>
            <div className="alert alert-warn" style={{ marginTop: 12 }}><strong>Instruction:</strong> {cp.instruction}</div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Case information — Checkpoint {checkpointIndex + 1}</h3>
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
              <div className="question-text" style={{ color: 'var(--muted)', fontWeight: 500 }}>Private notes (not shared)</div>
              <textarea className="input" value={answers[`private_notes_cp${checkpointIndex + 1}`] || ''} disabled={isSubmitted}
                onChange={e => setAnswers(prev => ({ ...prev, [`private_notes_cp${checkpointIndex + 1}`]: e.target.value }))}
                onBlur={e => !isSubmitted && saveAnswer(`private_notes_cp${checkpointIndex + 1}`, e.target.value)}
                placeholder="Optional personal notes…" />
            </div>

            {!isSubmitted && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <SaveIndicator state={saveState} lastSavedAt={savedAt} />
                <div className="nav-row" style={{ flex: 1, marginTop: 0 }}>
                  <button className="btn btn-secondary" disabled={checkpointIndex === 0} onClick={() => setCheckpointIndex(i => i - 1)}>← Back</button>
                  <button className="btn btn-secondary btn-small" onClick={() => persistEvaluation(answers, checkpointIndex, true)} disabled={!isOnline}>Save draft</button>
                  {checkpointIndex < TOTAL_STEPS - 1 ? (
                    <button className="btn btn-primary" onClick={() => { persistEvaluation(answers, checkpointIndex); setCheckpointIndex(i => i + 1); }} disabled={!isOnline}>Save & continue →</button>
                  ) : (
                    <button className="btn btn-primary btn-lg" onClick={submitEvaluation} disabled={!isOnline}>Submit evaluation ✓</button>
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

  // ── Dashboard ──
  const allDone = total > 0 && submitted === total;

  return (
    <main>
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">ClinEval</span>
          <span className="badge">{reviewer.display_name}</span>
          {reviewer.disease_entity && <span className="badge" style={{ background: 'var(--accent)', color: 'white' }}>{reviewer.disease_entity}</span>}
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
          </div>
        ) : (
          <div className="card">
            <h1 style={{ marginTop: 0, fontSize: 22 }}>Welcome, {reviewer.display_name}</h1>
            <p style={{ color: 'var(--muted)', fontSize: 15, marginBottom: 16 }}>
              Evaluate each LLM output for your disease entity: <strong>{reviewer.disease_entity}</strong>.
              Select a case and model to begin.
            </p>
            <div className="row" style={{ gap: 12 }}>
              {[
                { label: 'Cases assigned', value: assignments.length, color: 'var(--text)' },
                { label: 'Evaluations done', value: `${submitted} / ${total}`, color: submitted === total && total > 0 ? 'var(--accent)' : 'var(--warn)' },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, minWidth: 120, background: '#f9f8f5', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {assignments.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: 'var(--muted)' }}>No cases available yet. The study coordinator will activate cases when ready.</p>
          </div>
        ) : assignments.map(assignment => {
          const llmOutputs = llmOutputsMap[assignment.case_id] || [];
          const evals = llmOutputs.map(o => {
            const ev = llmEvaluationsMap[`${assignment.id}__${o.id}`];
            return { output: o, status: ev?.status || 'not_started', answered: countAnswered(ev?.answers || {}), total: visibleQuestions(ev?.answers || {}).length || 37 };
          });
          const caseSubmitted = evals.length > 0 && evals.every(e => e.status === 'submitted');

          return (
            <div key={assignment.id} className="card-task task-active">
              <div className="task-header">
                <div className="task-number" style={{ background: caseSubmitted ? 'var(--accent)' : 'var(--accent)' }}>
                  {caseSubmitted ? '✓' : '→'}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="task-title">{assignment.cases?.case_code}</div>
                  <div className="task-subtitle">{assignment.cases?.title}</div>
                </div>
                {caseSubmitted && <span className="badge badge-done">Complete</span>}
              </div>

              {llmOutputs.length === 0 ? (
                <div className="alert alert-info">No LLM outputs uploaded yet for this case.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {evals.map(({ output, status, answered, total: tot }) => {
                    const pct = Math.round((answered / (tot || 1)) * 100);
                    return (
                      <div key={output.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 16px' }}>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{output.model_name}{output.model_version && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}> {output.model_version}</span>}</div>
                          {status === 'submitted' ? (
                            <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>✅ Submitted</div>
                          ) : status === 'in_progress' ? (
                            <div style={{ marginTop: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1, height: 4, background: '#e8e4db', borderRadius: 999, overflow: 'hidden' }}>
                                  <div style={{ width: `${pct}%`, height: '100%', background: progressColor(pct), borderRadius: 999 }} />
                                </div>
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{answered}/{tot}</span>
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Not started</div>
                          )}
                        </div>
                        <button
                          className={`btn btn-small ${status === 'submitted' ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() => openEvaluation(assignment, output)}>
                          {status === 'submitted' ? 'View' : status === 'in_progress' ? 'Continue' : 'Start'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

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

        {submitted > 0 && (
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
