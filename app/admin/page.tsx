'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

function fmt(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function csvCell(value: any) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export default function AdminPage() {
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [llmOutputs, setLlmOutputs] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [caseSubmissions, setCaseSubmissions] = useState<any[]>([]);
  const [llmEvaluations, setLlmEvaluations] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<Record<string, 'sending' | 'sent' | 'no-email' | 'error'>>({});
  const [activeTab, setActiveTab] = useState<'overview' | 'cases' | 'manage'>('overview');
  const [newReviewer, setNewReviewer] = useState({ code: '', display_name: '', email: '', specialty: 'Hematology' });
  const [editReviewer, setEditReviewer] = useState<any | null>(null);
  const [assignReviewerId, setAssignReviewerId] = useState('');
  const [assignCaseId, setAssignCaseId] = useState('');
  const [newLLM, setNewLLM] = useState({ case_id: '', model_name: '', model_version: '', model_output_cp1: '', model_output_cp2: '', model_output_cp3: '', model_output_cp4: '' });
  const [showLLMForm, setShowLLMForm] = useState<string | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportResult, setBulkImportResult] = useState<string | null>(null);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<string | null>(null);
  const [showTimestampWarnings, setShowTimestampWarnings] = useState(false);

  async function load() {
    setLoading(true); setLoadError('');
    const [
      { data: revData, error: e1 },
      { data: caseData, error: e2 },
      { data: llmData, error: e3 },
      { data: asgnData, error: e4 },
      { data: csData, error: e5 },
      { data: evalData, error: e6 },
      { data: msgData, error: e7 },
    ] = await Promise.all([
      supabase.from('reviewers').select('*').order('created_at'),
      supabase.from('cases').select('*').order('created_at', { ascending: false }),
      supabase.from('llm_outputs').select('*').order('model_name'),
      supabase.from('assignments').select('*, reviewers(*), cases(*)').order('created_at'),
      supabase.from('case_submissions').select('*'),
      supabase.from('llm_evaluations').select('*'),
      supabase.from('reviewer_messages').select('*, reviewers(code,display_name), cases(case_code)').order('created_at', { ascending: false }),
    ]);
    const firstError = e1 || e2 || e3 || e4 || e5 || e6 || e7;
    if (firstError) { setLoadError('Failed to load: ' + firstError.message); setLoading(false); return; }
    setReviewers(revData || []);
    setCases(caseData || []);
    setLlmOutputs(llmData || []);
    setAssignments(asgnData || []);
    setCaseSubmissions(csData || []);
    setLlmEvaluations(evalData || []);
    setMessages(msgData || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (typeof sessionStorage !== 'undefined') {
      const saved = sessionStorage.getItem('adminSearch');
      if (saved) setSearch(saved);
    }
  }, []);
  useEffect(() => {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('adminSearch', search);
  }, [search]);

  const totalCaseSubmissions = caseSubmissions.filter(cs => cs.status === 'submitted').length;
  const totalEvalSubmitted = llmEvaluations.filter(e => e.status === 'submitted').length;
  const totalEvals = llmEvaluations.length;
  const totalAssignments = assignments.length;
  const totalCorrections = messages.length;

  const filteredAssignments = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return assignments;
    return assignments.filter(a =>
      a.reviewers?.display_name?.toLowerCase().includes(q) ||
      a.reviewers?.code?.toLowerCase().includes(q) ||
      a.cases?.case_code?.toLowerCase().includes(q) ||
      a.cases?.title?.toLowerCase().includes(q)
    );
  }, [assignments, search]);

  async function addReviewer() {
    if (!newReviewer.code || !newReviewer.display_name) return alert('Code and name required');
    const { error } = await supabase.from('reviewers').insert(newReviewer);
    if (error) return alert(error.message);
    setNewReviewer({ code: '', display_name: '', email: '', specialty: 'Hematology' });
    await load();
  }

  async function assignCase() {
    if (!assignReviewerId || !assignCaseId) return alert('Select both reviewer and case');

    // ── Cross-validation check ──────────────────────────────────
    // Block assignment if the reviewer is the contributor of this case.
    // Experts must not evaluate their own cases.
    const selectedCase = cases.find(c => c.id === assignCaseId);
    if (selectedCase?.contributor_reviewer_id && selectedCase.contributor_reviewer_id === assignReviewerId) {
      const rev = reviewers.find(r => r.id === assignReviewerId);
      return alert(
        `Cross-validation violation!\n\n` +
        `${rev?.display_name || rev?.code} submitted case ${selectedCase.case_code}. ` +
        `Experts cannot evaluate their own cases.\n\n` +
        `Please assign a different reviewer to this case.`
      );
    }

    const { error } = await supabase.from('assignments').upsert({
      reviewer_id: assignReviewerId, case_id: assignCaseId,
      status: 'not_started', questionnaire_enabled: false,
      updated_at: new Date().toISOString()
    }, { onConflict: 'reviewer_id,case_id' });
    if (error) return alert(error.message);
    setAssignReviewerId(''); setAssignCaseId('');
    await load();
  }

  async function toggleCaseActive(caseRow: any, active: boolean) {
    if (!confirm(`${active ? 'Activate' : 'Deactivate'} case ${caseRow.case_code}?`)) return;
    const { error } = await supabase.from('cases').update({ is_active: active }).eq('id', caseRow.id);
    if (error) return alert(error.message);
    await load();
  }

  async function toggleQuestionnaire(assignment: any, enable: boolean) {
    if (enable && !assignment.cases?.is_active) {
      return alert('Cannot activate: case is inactive. Please activate the case first.');
    }
    setUpdating(assignment.id);
    const { error } = await supabase.from('assignments').update({ questionnaire_enabled: enable }).eq('id', assignment.id);
    if (error) alert(error.message);
    await load();
    setUpdating(null);
  }

  async function resetAssignment(assignment: any) {
    if (!confirm(`Reset all data for ${assignment.reviewers?.code} on ${assignment.cases?.case_code}? This deletes all answers and Task 1 submission.`)) return;
    setUpdating(assignment.id);
    await supabase.from('assignments').update({ status: 'not_started', questionnaire_enabled: false, updated_at: new Date().toISOString() }).eq('id', assignment.id);
    await supabase.from('case_submissions').delete().eq('assignment_id', assignment.id);
    await supabase.from('llm_evaluations').delete().eq('assignment_id', assignment.id);
    await load();
    setUpdating(null);
  }

  async function addLLMOutput() {
    if (!newLLM.case_id || !newLLM.model_name) return alert('Case and model name required');
    const { error } = await supabase.from('llm_outputs').insert({
      case_id: newLLM.case_id, model_name: newLLM.model_name,
      model_version: newLLM.model_version || null,
      model_output_cp1: newLLM.model_output_cp1,
      model_output_cp2: newLLM.model_output_cp2,
      model_output_cp3: newLLM.model_output_cp3,
      model_output_cp4: newLLM.model_output_cp4,
    });
    if (error) return alert(error.message);
    setNewLLM({ case_id: '', model_name: '', model_version: '', model_output_cp1: '', model_output_cp2: '', model_output_cp3: '', model_output_cp4: '' });
    setShowLLMForm(null);
    await load();
  }

  async function deleteLLMOutput(id: string, modelName: string) {
    if (!confirm(`Delete LLM output "${modelName}"? This will also delete all evaluations for this output.`)) return;
    await supabase.from('llm_outputs').delete().eq('id', id);
    await load();
  }

  async function reminderEmail(assignment: any) {
    const email = assignment.reviewers?.email;
    if (!email) { setEmailStatus(s => ({ ...s, [assignment.id]: 'no-email' })); return; }
    setEmailStatus(s => ({ ...s, [assignment.id]: 'sending' }));
    try {
      const res = await fetch('/api/send-reminder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerName: assignment.reviewers?.display_name, reviewerCode: assignment.reviewers?.code, reviewerEmail: email, caseCode: assignment.cases?.case_code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setEmailStatus(s => ({ ...s, [assignment.id]: 'sent' }));
    } catch (err: any) {
      setEmailStatus(s => ({ ...s, [assignment.id]: 'error' }));
    }
  }

  // ── Bulk LLM Output Import ──────────────────────────────────
  // Expects JSON: Array of { case_code, model_name, model_version?,
  //   model_output_cp1, model_output_cp2, model_output_cp3, model_output_cp4 }
  async function handleBulkLLMImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkImporting(true);
    setBulkImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('File must be a JSON array');
      let inserted = 0, skipped = 0, errors: string[] = [];
      for (const row of data) {
        const matchedCase = cases.find(c => c.case_code === row.case_code);
        if (!matchedCase) { errors.push(`Case not found: ${row.case_code}`); skipped++; continue; }
        if (!row.model_name) { errors.push(`Missing model_name for case ${row.case_code}`); skipped++; continue; }
        const { error } = await supabase.from('llm_outputs').upsert({
          case_id: matchedCase.id,
          model_name: row.model_name,
          model_version: row.model_version || null,
          model_output_cp1: row.model_output_cp1 || '',
          model_output_cp2: row.model_output_cp2 || '',
          model_output_cp3: row.model_output_cp3 || '',
          model_output_cp4: row.model_output_cp4 || '',
        }, { onConflict: 'case_id,model_name' });
        if (error) { errors.push(`Error for ${row.case_code}/${row.model_name}: ${error.message}`); skipped++; }
        else inserted++;
      }
      await load();
      setBulkImportResult(
        `✅ Imported ${inserted} LLM outputs successfully.` +
        (skipped > 0 ? ` ⚠ ${skipped} skipped.` : '') +
        (errors.length > 0 ? `\nErrors:\n${errors.slice(0, 5).join('\n')}` : '')
      );
    } catch (err: any) {
      setBulkImportResult(`❌ Import failed: ${err.message}`);
    }
    setBulkImporting(false);
    e.target.value = '';
  }

  // ── One-click bulk auto-assign ───────────────────────────────
  // Creates assignments for all reviewer × case combinations
  // where the reviewer is NOT the case contributor.
  async function bulkAutoAssign() {
    if (!confirm(
      `Auto-assign all cases to all reviewers?\n\n` +
      `This will create assignments for every reviewer × case combination ` +
      `where the reviewer did not submit the case.\n\n` +
      `${reviewers.length} reviewers × ${cases.length} cases = up to ${reviewers.length * cases.length} assignments ` +
      `(minus ${cases.length} cross-validation blocks = ${reviewers.length * cases.length - cases.length} assignments).\n\n` +
      `Existing assignments will not be overwritten.`
    )) return;
    setAutoAssigning(true);
    setAutoAssignResult(null);
    let created = 0, skipped = 0, blocked = 0;
    const now = new Date().toISOString();
    for (const caseRow of cases) {
      for (const reviewer of reviewers) {
        // Block cross-validation violations
        if (caseRow.contributor_reviewer_id && caseRow.contributor_reviewer_id === reviewer.id) {
          blocked++;
          continue;
        }
        // Check if assignment already exists
        const exists = assignments.find(a => a.reviewer_id === reviewer.id && a.case_id === caseRow.id);
        if (exists) { skipped++; continue; }
        const { error } = await supabase.from('assignments').insert({
          reviewer_id: reviewer.id,
          case_id: caseRow.id,
          status: 'not_started',
          questionnaire_enabled: false,
          updated_at: now,
        });
        if (error) { skipped++; }
        else created++;
      }
    }
    await load();
    setAutoAssigning(false);
    setAutoAssignResult(
      `✅ Created ${created} new assignments. ` +
      `🚫 Blocked ${blocked} cross-validation violations. ` +
      (skipped > 0 ? `⚠ ${skipped} skipped (already existed or error).` : '')
    );
  }

  function downloadBlob(filename: string, content: string, type = 'text/csv') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Export 1: Progress overview (CSV)
  function exportProgressCsv() {
    const headers = ['reviewer_code', 'reviewer_name', 'case_code', 'case_title', 'case_contributor', 'task1_status', 'model_name', 'eval_status', 'answers_count'];
    const rows: any[] = [];
    assignments.forEach(a => {
      const cs = caseSubmissions.find(s => s.assignment_id === a.id);
      const outputs = llmOutputs.filter(o => o.case_id === a.case_id);
      const caseRow = cases.find(c => c.id === a.case_id);
      const contributor = reviewers.find(r => r.id === caseRow?.contributor_reviewer_id);
      if (outputs.length === 0) {
        rows.push([a.reviewers?.code, a.reviewers?.display_name, a.cases?.case_code, a.cases?.title, contributor?.code || '-', cs?.status || 'not_started', '-', '-', 0]);
      } else {
        outputs.forEach(o => {
          const ev = llmEvaluations.find(e => e.assignment_id === a.id && e.llm_output_id === o.id);
          rows.push([a.reviewers?.code, a.reviewers?.display_name, a.cases?.case_code, a.cases?.title, contributor?.code || '-', cs?.status || 'not_started', o.model_name, ev?.status || 'not_started', ev?.answers ? Object.keys(ev.answers).filter(k => !k.startsWith('private_notes')).length : 0]);
        });
      }
    });
    const csv = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
    downloadBlob('clineval_progress.csv', csv);
  }

  // Export 2: Task 1 — independent assessments (CSV)
  function exportTask1Csv() {
    const headers = ['reviewer_code', 'reviewer_name', 'case_code', 'case_title', 'status', 'submitted_at', 'diagnosis', 'differential_diagnosis', 'recommended_tests', 'treatment_plan', 'confidence_score', 'notes'];
    const rows = caseSubmissions.map(cs => {
      const assignment = assignments.find(a => a.id === cs.assignment_id);
      return [
        assignment?.reviewers?.code || '',
        assignment?.reviewers?.display_name || '',
        assignment?.cases?.case_code || '',
        assignment?.cases?.title || '',
        cs.status || '',
        cs.submitted_at || '',
        cs.diagnosis || '',
        cs.differential_diagnosis || '',
        cs.recommended_tests || '',
        cs.treatment_plan || '',
        cs.confidence_score || '',
        cs.notes || '',
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
    downloadBlob('clineval_task1_independent_assessments.csv', csv);
  }

  // Export 3: Task 2 — questionnaire answers (JSON, one object per evaluation)
  function exportTask2Json() {
    const data = llmEvaluations.map(ev => {
      const assignment = assignments.find(a => a.id === ev.assignment_id);
      const llmOutput = llmOutputs.find(o => o.id === ev.llm_output_id);
      // Filter out private notes from exported answers
      const publicAnswers = Object.fromEntries(
        Object.entries(ev.answers || {}).filter(([k]) => !k.startsWith('private_notes'))
      );
      return {
        reviewer_code: assignment?.reviewers?.code || '',
        reviewer_name: assignment?.reviewers?.display_name || '',
        case_code: assignment?.cases?.case_code || '',
        case_title: assignment?.cases?.title || '',
        model_name: llmOutput?.model_name || '',
        model_version: llmOutput?.model_version || '',
        status: ev.status,
        submitted_at: ev.submitted_at || '',
        answers: publicAnswers,
      };
    });
    downloadBlob('clineval_task2_questionnaire_answers.json', JSON.stringify(data, null, 2), 'application/json');
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'cases', label: 'Cases & LLMs' },
    { id: 'manage', label: 'Manage' },
  ];

  return (
    <main className="container-wide">
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>ClinEval Admin</h1>
          <div className="row">
            <button className="btn btn-secondary btn-small" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
            <button className="btn btn-secondary btn-small" onClick={exportProgressCsv} title="Export study progress overview">Progress CSV</button>
            <button className="btn btn-secondary btn-small" onClick={exportTask1Csv} title="Export independent assessments (Task 1)">Task 1 CSV</button>
            <button className="btn btn-primary btn-small" onClick={exportTask2Json} title="Export questionnaire answers (Task 2)">Task 2 JSON</button>
          </div>
        </div>
        {loadError && <div className="alert alert-warn" style={{ marginTop: 10 }}>{loadError}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginTop: 16 }}>
          {[
            { label: 'Reviewers', value: reviewers.length, color: 'var(--text)' },
            { label: 'Cases', value: cases.length, color: 'var(--text)' },
            { label: 'LLM outputs', value: llmOutputs.length, color: 'var(--text)' },
            { label: 'Task 1 done', value: `${totalCaseSubmissions}/${totalAssignments}`, color: totalCaseSubmissions === totalAssignments && totalAssignments > 0 ? 'var(--accent)' : 'var(--warn)' },
            { label: 'Evaluations', value: `${totalEvalSubmitted}/${totalEvals}`, color: totalEvalSubmitted === totalEvals && totalEvals > 0 ? 'var(--accent)' : 'var(--warn)' },
            { label: 'Corrections', value: totalCorrections, color: totalCorrections > 0 ? 'var(--danger)' : 'var(--muted)' },
          ].map(s => (
            <div key={s.label} style={{ background: '#f9f8f5', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)', marginTop: 20 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id as any)}
              style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                color: activeTab === t.id ? 'var(--accent)' : 'var(--muted)',
                borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB: Overview ── */}
      {activeTab === 'overview' && (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Assignments & Progress</h2>
            <input className="input" placeholder="Search reviewer or case..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16 }} />
            <p className="small" style={{ marginBottom: 8 }}>* Activate Q without Task 1 submission = admin override. 🚫 = cross-validation violation (reviewer is case author).</p>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ minWidth: 860, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 130 }} /><col style={{ width: 160 }} /><col style={{ width: 80 }} />
                  <col style={{ width: 80 }} /><col style={{ width: 210 }} /><col style={{ width: 200 }} />
                </colgroup>
                <thead>
                  <tr><th>Reviewer</th><th>Case</th><th>Task 1</th><th>Q active</th><th>LLM Evaluations</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredAssignments.map(assignment => {
                    const cs = caseSubmissions.find(s => s.assignment_id === assignment.id);
                    const task1Done = cs?.status === 'submitted';
                    const caseActive = assignment.cases?.is_active;
                    const outputs = llmOutputs.filter(o => o.case_id === assignment.case_id);
                    const evals = llmEvaluations.filter(e => e.assignment_id === assignment.id);
                    const submitted = evals.filter(e => e.status === 'submitted').length;
                    const emailSt = emailStatus[assignment.id];
                    // Check cross-validation: is this reviewer the case author?
                    const caseRow = cases.find(c => c.id === assignment.case_id);
                    const isCrossViolation = caseRow?.contributor_reviewer_id && caseRow.contributor_reviewer_id === assignment.reviewer_id;

                    return (
                      <tr key={assignment.id} className={!caseActive ? 'row-inactive' : ''}>
                        <td>
                          <strong>{assignment.reviewers?.display_name || '-'}</strong><br />
                          <span className="small">{assignment.reviewers?.code}</span>
                        </td>
                        <td>
                          <strong>{assignment.cases?.case_code}</strong>
                          {isCrossViolation && <span title="This reviewer submitted this case — cross-validation violation" style={{ marginLeft: 4 }}>🚫</span>}
                          <br />
                          <span className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{assignment.cases?.title}</span>
                          <span className={`status-pill ${caseActive ? 'status-submitted' : 'status-assigned'}`}>{caseActive ? 'Active' : 'Inactive'}</span>
                        </td>
                        <td>
                          {task1Done
                            ? <span className="status-pill status-submitted">Done</span>
                            : <span className="status-pill status-assigned">{cs ? 'Draft' : 'None'}</span>}
                        </td>
                        <td>
                          {assignment.questionnaire_enabled
                            ? <span className="status-pill status-submitted">Yes</span>
                            : <span className="status-pill status-assigned">No</span>}
                        </td>
                        <td>
                          {outputs.length === 0 ? (
                            <span className="small">No LLMs added</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {outputs.map(o => {
                                const ev = evals.find(e => e.llm_output_id === o.id);
                                const st = ev?.status || 'not_started';
                                return (
                                  <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span className={`status-pill ${st === 'submitted' ? 'status-submitted' : st === 'in_progress' ? 'status-in_progress' : 'status-assigned'}`} style={{ fontSize: 10 }}>
                                      {st === 'submitted' ? '✓' : st === 'in_progress' ? '…' : '○'}
                                    </span>
                                    <span style={{ fontSize: 12 }}>{o.model_name}</span>
                                  </div>
                                );
                              })}
                              <span className="small">{submitted}/{outputs.length} submitted</span>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                            {!caseActive ? (
                              <button className="btn btn-primary btn-small" disabled={updating === assignment.id} onClick={() => toggleCaseActive(assignment.cases, true)}>Activate case</button>
                            ) : (
                              <>
                                {!assignment.questionnaire_enabled ? (
                                  <button className="btn btn-primary btn-small" disabled={updating === assignment.id} onClick={() => toggleQuestionnaire(assignment, true)}
                                    title={!task1Done ? 'Task 1 not submitted — admin override' : ''}>
                                    Activate Q{!task1Done ? ' *' : ''}
                                  </button>
                                ) : (
                                  <button className="btn btn-secondary btn-small" disabled={updating === assignment.id} onClick={() => toggleQuestionnaire(assignment, false)}>Deactivate Q</button>
                                )}
                                <button className="btn btn-secondary btn-small" disabled={updating === assignment.id} onClick={() => resetAssignment(assignment)}>Reset</button>
                                {emailSt === 'no-email' ? <span className="small" style={{ color: 'var(--danger)' }}>No email</span>
                                  : emailSt === 'sending' ? <span className="small" style={{ color: 'var(--muted)' }}>Sending…</span>
                                  : emailSt === 'sent' ? <span className="small" style={{ color: 'var(--accent)' }}>✓ Sent</span>
                                  : emailSt === 'error' ? <button className="btn btn-secondary btn-small" style={{ color: 'var(--danger)' }} onClick={() => reminderEmail(assignment)}>Retry</button>
                                  : <button className="btn btn-secondary btn-small" onClick={() => reminderEmail(assignment)} title={assignment.reviewers?.email || 'No email'}>Email</button>}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAssignments.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No assignments match your search.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Correction Requests</h2>
            {messages.length === 0 ? <p className="small">None</p> : (
              <>
                {messages.length > 5 && <p className="small" style={{ marginBottom: 8 }}>Showing all {messages.length} requests</p>}
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {messages.map(m => (
                    <div key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                      <strong>{m.reviewers?.code}</strong> on {m.cases?.case_code}: {m.message}{' '}
                      <span className="small">({fmt(m.created_at)})</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── TAB: Cases & LLMs ── */}
      {activeTab === 'cases' && (
        <>
          {/* ── Bulk LLM Import ── */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Bulk Import LLM Outputs</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 8 }}>
              Upload a JSON file to import all LLM outputs at once. Each entry must include
              <code style={{ background: '#f1eee8', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}> case_code</code>,
              <code style={{ background: '#f1eee8', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}> model_name</code>, and
              <code style={{ background: '#f1eee8', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}> model_output_cp1</code> through
              <code style={{ background: '#f1eee8', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}> model_output_cp4</code>.
              Existing entries for the same case + model are updated.
            </p>
            <div style={{ background: '#f9f8f5', border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13 }}>
              <strong>Expected JSON format:</strong>
              <pre style={{ marginTop: 6, fontSize: 12, overflowX: 'auto' }}>{`[
  {
    "case_code": "CASE_001",
    "model_name": "GPT-4o",
    "model_version": "2024-11",
    "model_output_cp1": "Recommended workup: ...",
    "model_output_cp2": "Differential diagnosis: ...",
    "model_output_cp3": "Treatment recommendation: ...",
    "model_output_cp4": "Complication management: ..."
  }
]`}</pre>
            </div>
            {bulkImportResult && (
              <div className={`alert ${bulkImportResult.startsWith('✅') ? 'alert-success' : bulkImportResult.startsWith('⚠') ? 'alert-warn' : 'alert-danger'}`}
                style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                {bulkImportResult}
              </div>
            )}
            <div className="row" style={{ alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={handleBulkLLMImport}
                  disabled={bulkImporting}
                />
                <span className={`btn ${bulkImporting ? 'btn-secondary' : 'btn-primary'}`}>
                  {bulkImporting ? 'Importing…' : '📂 Upload JSON file'}
                </span>
              </label>
              <a
                href={`data:application/json,${encodeURIComponent(JSON.stringify([{ case_code: cases[0]?.case_code || 'CASE_001', model_name: 'GPT-4o', model_version: '2024-11', model_output_cp1: '', model_output_cp2: '', model_output_cp3: '', model_output_cp4: '' }], null, 2))}`}
                download="llm_outputs_template.json"
                className="btn btn-secondary btn-small"
              >
                Download template
              </a>
            </div>
          </div>

          {cases.map(caseRow => {
            const outputs = llmOutputs.filter(o => o.case_id === caseRow.id);
            const contributor = reviewers.find(r => r.id === caseRow.contributor_reviewer_id);
            return (
              <div key={caseRow.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{caseRow.case_code}</h2>
                    <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 2 }}>{caseRow.title}</div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="small">{caseRow.disease_category} · {caseRow.difficulty_level}</span>
                      {contributor && (
                        <span className="small" style={{ background: '#fff8e1', color: 'var(--warn)', padding: '2px 8px', borderRadius: 999, border: '1px solid #f0d080' }}>
                          ✍️ Submitted by {contributor.code} — cannot be assigned to them
                        </span>
                      )}
                      {caseRow.contributor_name && !contributor && (
                        <span className="small" style={{ color: 'var(--muted)' }}>Submitted by {caseRow.contributor_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="row">
                    <span className={`status-pill ${caseRow.is_active ? 'status-submitted' : 'status-assigned'}`}>{caseRow.is_active ? 'Active' : 'Inactive'}</span>
                    {caseRow.is_active
                      ? <button className="btn btn-secondary btn-small" onClick={() => toggleCaseActive(caseRow, false)}>Deactivate</button>
                      : <button className="btn btn-primary btn-small" onClick={() => toggleCaseActive(caseRow, true)}>Activate</button>}
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: 14 }}>LLM Outputs ({outputs.length})</strong>
                    <button className="btn btn-primary btn-small" onClick={() => setShowLLMForm(showLLMForm === caseRow.id ? null : caseRow.id)}>
                      {showLLMForm === caseRow.id ? 'Cancel' : '+ Add LLM Output'}
                    </button>
                  </div>
                  {outputs.length === 0 ? (
                    <p className="small">No LLM outputs added yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {outputs.map(o => {
                        const evalCount = llmEvaluations.filter(e => e.llm_output_id === o.id).length;
                        const submittedCount = llmEvaluations.filter(e => e.llm_output_id === o.id && e.status === 'submitted').length;
                        return (
                          <div key={o.id} style={{ background: '#f9f8f5', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                            <div>
                              <strong style={{ fontSize: 14 }}>{o.model_name}</strong>
                              {o.model_version && <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}>{o.model_version}</span>}
                              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{submittedCount}/{evalCount} evaluations submitted</div>
                            </div>
                            <button className="btn btn-secondary btn-small" style={{ color: 'var(--danger)' }} onClick={() => deleteLLMOutput(o.id, o.model_name)}>Delete</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {showLLMForm === caseRow.id && (
                    <div style={{ marginTop: 12, background: 'var(--accent-light)', border: '1px solid #a8d5bc', borderRadius: 12, padding: 16 }}>
                      <h3 style={{ marginTop: 0, fontSize: 15 }}>Add LLM Output for {caseRow.case_code}</h3>
                      <div className="row" style={{ marginBottom: 10 }}>
                        <input className="input" placeholder="Model name (e.g. GPT-4o)" style={{ flex: 2 }}
                          value={newLLM.model_name}
                          onChange={e => setNewLLM(n => ({ ...n, model_name: e.target.value, case_id: caseRow.id }))} />
                        <input className="input" placeholder="Version (optional)" style={{ flex: 1 }}
                          value={newLLM.model_version}
                          onChange={e => setNewLLM(n => ({ ...n, model_version: e.target.value }))} />
                      </div>
                      {['cp1', 'cp2', 'cp3', 'cp4'].map((cp, i) => (
                        <div key={cp} style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Checkpoint {i + 1} output</label>
                          <textarea className="input" placeholder={`Model output for checkpoint ${i + 1}…`}
                            value={(newLLM as any)[`model_output_${cp}`]}
                            onChange={e => setNewLLM(n => ({ ...n, [`model_output_${cp}`]: e.target.value, case_id: caseRow.id }))} />
                        </div>
                      ))}
                      <div className="row">
                        <button className="btn btn-primary" onClick={addLLMOutput} disabled={!newLLM.model_name}>Save LLM Output</button>
                        <button className="btn btn-secondary" onClick={() => setShowLLMForm(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {cases.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
              No cases yet. Cases are added via the case submission form at /case-submission.
            </div>
          )}
        </>
      )}

      {/* ── TAB: Manage ── */}
      {activeTab === 'manage' && (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Reviewers</h2>
            <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <input className="input" style={{ flex: '1 1 100px' }} placeholder="Code" value={newReviewer.code} onChange={e => setNewReviewer({ ...newReviewer, code: e.target.value })} />
              <input className="input" style={{ flex: '2 1 140px' }} placeholder="Name" value={newReviewer.display_name} onChange={e => setNewReviewer({ ...newReviewer, display_name: e.target.value })} />
              <input className="input" style={{ flex: '2 1 140px' }} placeholder="Email" value={newReviewer.email} onChange={e => setNewReviewer({ ...newReviewer, email: e.target.value })} />
              <input className="input" style={{ flex: '1 1 100px' }} placeholder="Specialty" value={newReviewer.specialty} onChange={e => setNewReviewer({ ...newReviewer, specialty: e.target.value })} />
              <button className="btn btn-primary" onClick={addReviewer}>+ Add</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Code</th><th>Name</th><th>Email</th><th>Specialty</th><th>Action</th></tr></thead>
                <tbody>
                  {reviewers.map(r => (
                    <tr key={r.id}>
                      <td><strong>{r.code}</strong></td>
                      <td>{r.display_name}</td>
                      <td>{r.email || '-'}</td>
                      <td>{r.specialty || '-'}</td>
                      <td><button className="btn btn-secondary btn-small" onClick={() => setEditReviewer(r)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Assign Case to Reviewer</h2>
            <div className="alert alert-info" style={{ marginBottom: 12 }}>
              Cross-validation is enforced — experts cannot be assigned to cases they submitted. The system will block such assignments automatically.
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <select className="input" style={{ flex: '1 1 180px' }} value={assignReviewerId} onChange={e => setAssignReviewerId(e.target.value)}>
                <option value="">Select reviewer</option>
                {reviewers.map(r => <option key={r.id} value={r.id}>{r.code} – {r.display_name}</option>)}
              </select>
              <select className="input" style={{ flex: '1 1 180px' }} value={assignCaseId} onChange={e => setAssignCaseId(e.target.value)}>
                <option value="">Select case</option>
                {cases.map(c => {
                  const contributor = reviewers.find(r => r.id === c.contributor_reviewer_id);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.case_code} – {c.title?.slice(0, 40)}{contributor ? ` (by ${contributor.code})` : ''}
                    </option>
                  );
                })}
              </select>
              <button className="btn btn-primary" onClick={assignCase}>Assign</button>
            </div>
          </div>

          {/* ── Bulk Auto-Assign ── */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Bulk Auto-Assign</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>
              Automatically creates assignments for all reviewer × case combinations,
              respecting cross-validation (authors are never assigned their own cases).
              Existing assignments are not overwritten.
            </p>
            {autoAssignResult && (
              <div className={`alert ${autoAssignResult.startsWith('✅') ? 'alert-success' : 'alert-warn'}`} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                {autoAssignResult}
              </div>
            )}
            <button
              className="btn btn-primary"
              onClick={bulkAutoAssign}
              disabled={autoAssigning || reviewers.length === 0 || cases.length === 0}
            >
              {autoAssigning ? 'Assigning…' : `Auto-assign all (${reviewers.length} reviewers × ${cases.length} cases)`}
            </button>
            {(reviewers.length === 0 || cases.length === 0) && (
              <p className="small" style={{ marginTop: 8 }}>Add reviewers and cases first.</p>
            )}
          </div>

          {editReviewer && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Edit — {editReviewer.code}</h2>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <input className="input" style={{ flex: '1 1 100px' }} value={editReviewer.code} onChange={e => setEditReviewer({ ...editReviewer, code: e.target.value })} />
                <input className="input" style={{ flex: '2 1 140px' }} value={editReviewer.display_name} onChange={e => setEditReviewer({ ...editReviewer, display_name: e.target.value })} />
                <input className="input" style={{ flex: '2 1 140px' }} value={editReviewer.email || ''} onChange={e => setEditReviewer({ ...editReviewer, email: e.target.value })} />
                <input className="input" style={{ flex: '1 1 100px' }} value={editReviewer.specialty || ''} onChange={e => setEditReviewer({ ...editReviewer, specialty: e.target.value })} />
              </div>
              <div className="row">
                <button className="btn btn-primary" onClick={async () => {
                  const { error } = await supabase.from('reviewers').update({ code: editReviewer.code, display_name: editReviewer.display_name, email: editReviewer.email, specialty: editReviewer.specialty }).eq('id', editReviewer.id);
                  if (error) return alert(error.message);
                  setEditReviewer(null); await load();
                }}>Save</button>
                <button className="btn btn-secondary" onClick={() => setEditReviewer(null)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
