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
  const [llmEvaluations, setLlmEvaluations] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<Record<string, 'sending' | 'sent' | 'no-email' | 'error'>>({});
  const [activeTab, setActiveTab] = useState<'overview' | 'cases' | 'manage'>('overview');
  const [newReviewer, setNewReviewer] = useState({ code: '', display_name: '', email: '', specialty: 'Hematology', disease_entity: '' });
  const [editReviewer, setEditReviewer] = useState<any | null>(null);
  const [assignReviewerId, setAssignReviewerId] = useState('');
  const [assignCaseId, setAssignCaseId] = useState('');
  const [newLLM, setNewLLM] = useState({ case_id: '', model_name: '', model_version: '', model_output_cp1: '', model_output_cp2: '', model_output_cp3: '', model_output_cp4: '' });
  const [showLLMForm, setShowLLMForm] = useState<string | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportResult, setBulkImportResult] = useState<string | null>(null);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<string | null>(null);

  const DISEASE_ENTITIES = ['AML', 'MDS', 'CML', 'ALL', 'CLL', 'Myeloma', 'DLBCL', 'Hodgkin', 'Indolent Lymphoma', 'MF'];

  async function load() {
    setLoading(true); setLoadError('');
    const [
      { data: revData, error: e1 },
      { data: caseData, error: e2 },
      { data: llmData, error: e3 },
      { data: asgnData, error: e4 },
      { data: evalData, error: e5 },
      { data: msgData, error: e6 },
    ] = await Promise.all([
      supabase.from('reviewers').select('*').order('disease_entity').order('created_at'),
      supabase.from('cases').select('*').order('disease_entity').order('created_at', { ascending: false }),
      supabase.from('llm_outputs').select('*').order('model_name'),
      supabase.from('assignments').select('*, reviewers(*), cases(*)').order('created_at'),
      supabase.from('llm_evaluations').select('*'),
      supabase.from('reviewer_messages').select('*, reviewers(code,display_name), cases(case_code)').order('created_at', { ascending: false }),
    ]);
    const firstError = e1 || e2 || e3 || e4 || e5 || e6;
    if (firstError) { setLoadError('Failed to load: ' + firstError.message); setLoading(false); return; }
    setReviewers(revData || []);
    setCases(caseData || []);
    setLlmOutputs(llmData || []);
    setAssignments(asgnData || []);
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

  // Stats
  const totalEvalSubmitted = llmEvaluations.filter(e => e.status === 'submitted').length;
  const totalEvals = llmEvaluations.length;
  const totalCorrections = messages.length;

  const filteredAssignments = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return assignments;
    return assignments.filter(a =>
      a.reviewers?.display_name?.toLowerCase().includes(q) ||
      a.reviewers?.code?.toLowerCase().includes(q) ||
      a.reviewers?.disease_entity?.toLowerCase().includes(q) ||
      a.cases?.case_code?.toLowerCase().includes(q) ||
      a.cases?.title?.toLowerCase().includes(q)
    );
  }, [assignments, search]);

  async function addReviewer() {
    if (!newReviewer.code || !newReviewer.display_name) return alert('Code and name required');
    if (!newReviewer.disease_entity) return alert('Disease entity required');
    const { error } = await supabase.from('reviewers').insert(newReviewer);
    if (error) return alert(error.message);
    setNewReviewer({ code: '', display_name: '', email: '', specialty: 'Hematology', disease_entity: '' });
    await load();
  }

  async function assignCase() {
    if (!assignReviewerId || !assignCaseId) return alert('Select both reviewer and case');
    const { error } = await supabase.from('assignments').upsert({
      reviewer_id: assignReviewerId, case_id: assignCaseId,
      status: 'not_started', questionnaire_enabled: true,
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

  async function resetAssignment(assignment: any) {
    if (!confirm(`Reset all evaluations for ${assignment.reviewers?.code} on ${assignment.cases?.case_code}? This deletes all questionnaire answers.`)) return;
    setUpdating(assignment.id);
    await supabase.from('assignments').update({ status: 'not_started', updated_at: new Date().toISOString() }).eq('id', assignment.id);
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
    } catch {
      setEmailStatus(s => ({ ...s, [assignment.id]: 'error' }));
    }
  }

  async function handleBulkLLMImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkImporting(true); setBulkImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('File must be a JSON array');
      let inserted = 0, skipped = 0, errors: string[] = [];
      for (const row of data) {
        const matchedCase = cases.find(c => c.case_code === row.case_code);
        if (!matchedCase) { errors.push(`Case not found: ${row.case_code}`); skipped++; continue; }
        if (!row.model_name) { errors.push(`Missing model_name for ${row.case_code}`); skipped++; continue; }
        const { error } = await supabase.from('llm_outputs').upsert({
          case_id: matchedCase.id, model_name: row.model_name,
          model_version: row.model_version || null,
          model_output_cp1: row.model_output_cp1 || '',
          model_output_cp2: row.model_output_cp2 || '',
          model_output_cp3: row.model_output_cp3 || '',
          model_output_cp4: row.model_output_cp4 || '',
        }, { onConflict: 'case_id,model_name' });
        if (error) { errors.push(`Error ${row.case_code}/${row.model_name}: ${error.message}`); skipped++; }
        else inserted++;
      }
      await load();
      setBulkImportResult(`✅ Imported ${inserted} outputs.${skipped > 0 ? ` ⚠ ${skipped} skipped.` : ''}${errors.length > 0 ? '\n' + errors.slice(0, 5).join('\n') : ''}`);
    } catch (err: any) {
      setBulkImportResult(`❌ Import failed: ${err.message}`);
    }
    setBulkImporting(false);
    e.target.value = '';
  }

  async function bulkAutoAssign() {
    if (!confirm(
      `Auto-assign all cases to all reviewers in the same disease entity?\n\n` +
      `Each reviewer will be assigned to ALL cases in their disease (both their own and their partner's).\n` +
      `Existing assignments will not be overwritten.`
    )) return;
    setAutoAssigning(true); setAutoAssignResult(null);
    let created = 0, skipped = 0;
    const now = new Date().toISOString();
    for (const reviewer of reviewers) {
      const diseaseCases = cases.filter(c => c.disease_entity === reviewer.disease_entity);
      for (const caseRow of diseaseCases) {
        const exists = assignments.find(a => a.reviewer_id === reviewer.id && a.case_id === caseRow.id);
        if (exists) { skipped++; continue; }
        const { error } = await supabase.from('assignments').insert({
          reviewer_id: reviewer.id, case_id: caseRow.id,
          status: 'not_started', questionnaire_enabled: true, updated_at: now,
        });
        if (error) skipped++;
        else created++;
      }
    }
    await load();
    setAutoAssigning(false);
    setAutoAssignResult(`✅ Created ${created} new assignments.${skipped > 0 ? ` ⚠ ${skipped} skipped (already existed).` : ''}`);
  }

  function downloadBlob(filename: string, content: string, type = 'text/csv') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportProgressCsv() {
    const headers = ['disease_entity', 'reviewer_code', 'reviewer_name', 'case_code', 'case_title', 'model_name', 'eval_status', 'answers_count'];
    const rows: any[] = [];
    assignments.forEach(a => {
      const outputs = llmOutputs.filter(o => o.case_id === a.case_id);
      if (outputs.length === 0) {
        rows.push([a.reviewers?.disease_entity || '', a.reviewers?.code, a.reviewers?.display_name, a.cases?.case_code, a.cases?.title, '-', '-', 0]);
      } else {
        outputs.forEach(o => {
          const ev = llmEvaluations.find(e => e.assignment_id === a.id && e.llm_output_id === o.id);
          rows.push([a.reviewers?.disease_entity || '', a.reviewers?.code, a.reviewers?.display_name, a.cases?.case_code, a.cases?.title, o.model_name, ev?.status || 'not_started', ev?.answers ? Object.keys(ev.answers).filter(k => !k.startsWith('private_notes')).length : 0]);
        });
      }
    });
    const csv = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
    downloadBlob('clineval_progress.csv', csv);
  }

  function exportTask2Json() {
    const data = llmEvaluations.map(ev => {
      const assignment = assignments.find(a => a.id === ev.assignment_id);
      const llmOutput = llmOutputs.find(o => o.id === ev.llm_output_id);
      const publicAnswers = Object.fromEntries(
        Object.entries(ev.answers || {}).filter(([k]) => !k.startsWith('private_notes'))
      );
      return {
        disease_entity: assignment?.reviewers?.disease_entity || '',
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
    downloadBlob('clineval_evaluations.json', JSON.stringify(data, null, 2), 'application/json');
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'cases', label: 'Cases & LLMs' },
    { id: 'manage', label: 'Manage' },
  ];

  return (
    <main className="container-wide">
      {/* Header */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>ClinEval Admin</h1>
          <div className="row">
            <button className="btn btn-secondary btn-small" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
            <button className="btn btn-secondary btn-small" onClick={exportProgressCsv}>Progress CSV</button>
            <button className="btn btn-primary btn-small" onClick={exportTask2Json}>Export JSON</button>
          </div>
        </div>
        {loadError && <div className="alert alert-warn" style={{ marginTop: 10 }}>{loadError}</div>}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 16 }}>
          {[
            { label: 'Reviewers', value: reviewers.length, color: 'var(--text)' },
            { label: 'Disease entities', value: DISEASE_ENTITIES.filter(d => reviewers.some(r => r.disease_entity === d)).length, color: 'var(--text)' },
            { label: 'Cases', value: cases.length, color: 'var(--text)' },
            { label: 'LLM outputs', value: llmOutputs.length, color: 'var(--text)' },
            { label: 'Evaluations', value: `${totalEvalSubmitted}/${totalEvals}`, color: totalEvalSubmitted === totalEvals && totalEvals > 0 ? 'var(--accent)' : 'var(--warn)' },
            { label: 'Corrections', value: totalCorrections, color: totalCorrections > 0 ? 'var(--danger)' : 'var(--muted)' },
          ].map(s => (
            <div key={s.label} style={{ background: '#f9f8f5', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
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
            <input className="input" placeholder="Search by disease, reviewer, or case..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16 }} />
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ minWidth: 860, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 80 }} /><col style={{ width: 130 }} /><col style={{ width: 160 }} />
                  <col style={{ width: 210 }} /><col style={{ width: 200 }} />
                </colgroup>
                <thead>
                  <tr><th>Disease</th><th>Reviewer</th><th>Case</th><th>LLM Evaluations</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredAssignments.map(assignment => {
                    const caseActive = assignment.cases?.is_active;
                    const outputs = llmOutputs.filter(o => o.case_id === assignment.case_id);
                    const evals = llmEvaluations.filter(e => e.assignment_id === assignment.id);
                    const submitted = evals.filter(e => e.status === 'submitted').length;
                    const emailSt = emailStatus[assignment.id];

                    return (
                      <tr key={assignment.id} className={!caseActive ? 'row-inactive' : ''}>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-light)', padding: '2px 8px', borderRadius: 999 }}>
                            {assignment.reviewers?.disease_entity || '-'}
                          </span>
                        </td>
                        <td>
                          <strong>{assignment.reviewers?.display_name || '-'}</strong><br />
                          <span className="small">{assignment.reviewers?.code}</span>
                        </td>
                        <td>
                          <strong>{assignment.cases?.case_code}</strong><br />
                          <span className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{assignment.cases?.title}</span>
                          <span className={`status-pill ${caseActive ? 'status-submitted' : 'status-assigned'}`}>{caseActive ? 'Active' : 'Inactive'}</span>
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
                              <button className="btn btn-primary btn-small" disabled={updating === assignment.id} onClick={() => toggleCaseActive(assignment.cases, true)}>Activate</button>
                            ) : (
                              <>
                                <button className="btn btn-secondary btn-small" disabled={updating === assignment.id} onClick={() => resetAssignment(assignment)}>Reset</button>
                                {emailSt === 'no-email' ? <span className="small" style={{ color: 'var(--danger)' }}>No email</span>
                                  : emailSt === 'sending' ? <span className="small" style={{ color: 'var(--muted)' }}>Sending…</span>
                                  : emailSt === 'sent' ? <span className="small" style={{ color: 'var(--accent)' }}>✓ Sent</span>
                                  : emailSt === 'error' ? <button className="btn btn-secondary btn-small" style={{ color: 'var(--danger)' }} onClick={() => reminderEmail(assignment)}>Retry</button>
                                  : <button className="btn btn-secondary btn-small" onClick={() => reminderEmail(assignment)}>Email</button>}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAssignments.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>No assignments match your search.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Corrections */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Correction Requests</h2>
            {messages.length === 0 ? <p className="small">None</p> : (
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {messages.map(m => (
                  <div key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <strong>{m.reviewers?.code}</strong> on {m.cases?.case_code}: {m.message}{' '}
                    <span className="small">({fmt(m.created_at)})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TAB: Cases & LLMs ── */}
      {activeTab === 'cases' && (
        <>
          {/* Bulk import */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Bulk Import LLM Outputs</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 8 }}>
              Upload a JSON file with all LLM outputs at once. Each entry needs
              <code style={{ background: '#f1eee8', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}> case_code</code>,
              <code style={{ background: '#f1eee8', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}> model_name</code>, and
              <code style={{ background: '#f1eee8', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}> model_output_cp1–cp4</code>.
            </p>
            {bulkImportResult && (
              <div className={`alert ${bulkImportResult.startsWith('✅') ? 'alert-success' : 'alert-warn'}`} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                {bulkImportResult}
              </div>
            )}
            <div className="row" style={{ alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleBulkLLMImport} disabled={bulkImporting} />
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

          {/* Cases grouped by disease */}
          {DISEASE_ENTITIES.map(disease => {
            const diseaseCases = cases.filter(c => c.disease_entity === disease);
            if (diseaseCases.length === 0) return null;
            return (
              <div key={disease}>
                <div style={{ padding: '8px 4px', fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginTop: 8 }}>
                  {disease} — {diseaseCases.length} case{diseaseCases.length > 1 ? 's' : ''}
                </div>
                {diseaseCases.map(caseRow => {
                  const outputs = llmOutputs.filter(o => o.case_id === caseRow.id);
                  return (
                    <div key={caseRow.id} className="card" style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                        <div>
                          <h2 style={{ margin: 0, fontSize: 16 }}>{caseRow.case_code}</h2>
                          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{caseRow.title}</div>
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)' }}>{caseRow.difficulty_level}</div>
                        </div>
                        <div className="row">
                          <span className={`status-pill ${caseRow.is_active ? 'status-submitted' : 'status-assigned'}`}>{caseRow.is_active ? 'Active' : 'Inactive'}</span>
                          {caseRow.is_active
                            ? <button className="btn btn-secondary btn-small" onClick={() => toggleCaseActive(caseRow, false)}>Deactivate</button>
                            : <button className="btn btn-primary btn-small" onClick={() => toggleCaseActive(caseRow, true)}>Activate</button>}
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <strong style={{ fontSize: 13 }}>LLM Outputs ({outputs.length})</strong>
                          <button className="btn btn-primary btn-small" onClick={() => setShowLLMForm(showLLMForm === caseRow.id ? null : caseRow.id)}>
                            {showLLMForm === caseRow.id ? 'Cancel' : '+ Add LLM Output'}
                          </button>
                        </div>
                        {outputs.length === 0 ? (
                          <p className="small">No LLM outputs added yet.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {outputs.map(o => {
                              const evalCount = llmEvaluations.filter(e => e.llm_output_id === o.id).length;
                              const submittedCount = llmEvaluations.filter(e => e.llm_output_id === o.id && e.status === 'submitted').length;
                              return (
                                <div key={o.id} style={{ background: '#f9f8f5', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                                  <div>
                                    <strong style={{ fontSize: 13 }}>{o.model_name}</strong>
                                    {o.model_version && <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>{o.model_version}</span>}
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{submittedCount}/{evalCount} evaluations submitted</div>
                                  </div>
                                  <button className="btn btn-secondary btn-small" style={{ color: 'var(--danger)' }} onClick={() => deleteLLMOutput(o.id, o.model_name)}>Delete</button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {showLLMForm === caseRow.id && (
                          <div style={{ marginTop: 12, background: 'var(--accent-light)', border: '1px solid #a8d5bc', borderRadius: 12, padding: 16 }}>
                            <h3 style={{ marginTop: 0, fontSize: 14 }}>Add LLM Output for {caseRow.case_code}</h3>
                            <div className="row" style={{ marginBottom: 10 }}>
                              <select className="input" style={{ flex: 2 }}
                                value={newLLM.model_name}
                                onChange={e => setNewLLM(n => ({ ...n, model_name: e.target.value, case_id: caseRow.id }))}>
                                <option value="">Select model</option>
                                {['GPT-4o', 'GPT-4-turbo', 'Claude 3.5 Sonnet', 'Claude 3 Opus', 'Gemini 1.5 Pro', 'Gemini 2.0 Flash', 'Other'].map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                              <input className="input" placeholder="Version (optional)" style={{ flex: 1 }}
                                value={newLLM.model_version}
                                onChange={e => setNewLLM(n => ({ ...n, model_version: e.target.value }))} />
                            </div>
                            {['cp1', 'cp2', 'cp3', 'cp4'].map((cp, i) => (
                              <div key={cp} style={{ marginBottom: 10 }}>
                                <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>Checkpoint {i + 1} output</label>
                                <textarea className="input" style={{ minHeight: 100 }} placeholder={`Model output for checkpoint ${i + 1}…`}
                                  value={(newLLM as any)[`model_output_${cp}`]}
                                  onChange={e => setNewLLM(n => ({ ...n, [`model_output_${cp}`]: e.target.value, case_id: caseRow.id }))} />
                              </div>
                            ))}
                            <div className="row">
                              <button className="btn btn-primary" onClick={addLLMOutput} disabled={!newLLM.model_name || newLLM.model_name === 'Other'}>Save</button>
                              <button className="btn btn-secondary" onClick={() => { setShowLLMForm(null); setNewLLM({ case_id: '', model_name: '', model_version: '', model_output_cp1: '', model_output_cp2: '', model_output_cp3: '', model_output_cp4: '' }); }}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {cases.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
              No cases yet. Cases are submitted via /case-submission.
            </div>
          )}
        </>
      )}

      {/* ── TAB: Manage ── */}
      {activeTab === 'manage' && (
        <>
          {/* Reviewers */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Reviewers</h2>
            <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <input className="input" style={{ flex: '1 1 90px' }} placeholder="Code (e.g. AML_01)" value={newReviewer.code} onChange={e => setNewReviewer({ ...newReviewer, code: e.target.value })} />
              <input className="input" style={{ flex: '2 1 140px' }} placeholder="Name" value={newReviewer.display_name} onChange={e => setNewReviewer({ ...newReviewer, display_name: e.target.value })} />
              <input className="input" style={{ flex: '2 1 140px' }} placeholder="Email" value={newReviewer.email} onChange={e => setNewReviewer({ ...newReviewer, email: e.target.value })} />
              <select className="input" style={{ flex: '1 1 120px' }} value={newReviewer.disease_entity} onChange={e => setNewReviewer({ ...newReviewer, disease_entity: e.target.value })}>
                <option value="">Disease entity *</option>
                {DISEASE_ENTITIES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <button className="btn btn-primary" onClick={addReviewer}>+ Add</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Disease</th><th>Code</th><th>Name</th><th>Email</th><th>Action</th></tr></thead>
                <tbody>
                  {DISEASE_ENTITIES.concat(['Other']).flatMap(disease => {
                    const group = reviewers.filter(r => (r.disease_entity || 'Other') === disease);
                    if (group.length === 0) return [];
                    return group.map((r, ri) => (
                      <tr key={r.id} style={{ borderTop: ri === 0 ? '2px solid var(--line)' : undefined }}>
                        {ri === 0 && (
                          <td rowSpan={group.length} style={{ background: 'var(--accent-light)', fontWeight: 700, color: 'var(--accent)', verticalAlign: 'middle', textAlign: 'center', fontSize: 13 }}>
                            {disease}
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{group.length} reviewer{group.length > 1 ? 's' : ''}</div>
                          </td>
                        )}
                        <td><strong>{r.code}</strong></td>
                        <td>{r.display_name}</td>
                        <td style={{ fontSize: 12 }}>{r.email || <span style={{ color: 'var(--danger)' }}>No email</span>}</td>
                        <td><button className="btn btn-secondary btn-small" onClick={() => setEditReviewer(r)}>Edit</button></td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Assign case */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Assign Case to Reviewer</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
              Manually assign a specific case to a reviewer. Use Auto-assign below to create all assignments at once.
            </p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <select className="input" style={{ flex: '1 1 180px' }} value={assignReviewerId} onChange={e => setAssignReviewerId(e.target.value)}>
                <option value="">Select reviewer</option>
                {DISEASE_ENTITIES.flatMap(d => reviewers.filter(r => r.disease_entity === d).map(r => (
                  <option key={r.id} value={r.id}>[{r.disease_entity}] {r.code} – {r.display_name}</option>
                )))}
              </select>
              <select className="input" style={{ flex: '1 1 180px' }} value={assignCaseId} onChange={e => setAssignCaseId(e.target.value)}>
                <option value="">Select case</option>
                {DISEASE_ENTITIES.flatMap(d => cases.filter(c => c.disease_entity === d).map(c => (
                  <option key={c.id} value={c.id}>[{c.disease_entity}] {c.case_code} – {c.title?.slice(0, 35)}</option>
                )))}
              </select>
              <button className="btn btn-primary" onClick={assignCase}>Assign</button>
            </div>
          </div>

          {/* Bulk auto-assign */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Bulk Auto-Assign</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>
              Automatically assigns all cases to both reviewers within each disease entity.
              Both experts will see all cases for their disease. Existing assignments are not overwritten.
            </p>
            {autoAssignResult && (
              <div className={`alert ${autoAssignResult.startsWith('✅') ? 'alert-success' : 'alert-warn'}`} style={{ marginBottom: 12 }}>
                {autoAssignResult}
              </div>
            )}
            <button className="btn btn-primary" onClick={bulkAutoAssign} disabled={autoAssigning || reviewers.length === 0 || cases.length === 0}>
              {autoAssigning ? 'Assigning…' : `Auto-assign all (${reviewers.length} reviewers, ${cases.length} cases)`}
            </button>
          </div>

          {/* Edit reviewer */}
          {editReviewer && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Edit — {editReviewer.code}</h2>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <input className="input" style={{ flex: '1 1 100px' }} value={editReviewer.code} onChange={e => setEditReviewer({ ...editReviewer, code: e.target.value })} />
                <input className="input" style={{ flex: '2 1 140px' }} value={editReviewer.display_name} onChange={e => setEditReviewer({ ...editReviewer, display_name: e.target.value })} />
                <input className="input" style={{ flex: '2 1 140px' }} value={editReviewer.email || ''} onChange={e => setEditReviewer({ ...editReviewer, email: e.target.value })} />
                <select className="input" style={{ flex: '1 1 120px' }} value={editReviewer.disease_entity || ''} onChange={e => setEditReviewer({ ...editReviewer, disease_entity: e.target.value })}>
                  <option value="">Disease entity</option>
                  {DISEASE_ENTITIES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="row">
                <button className="btn btn-primary" onClick={async () => {
                  const { error } = await supabase.from('reviewers').update({
                    code: editReviewer.code, display_name: editReviewer.display_name,
                    email: editReviewer.email, specialty: editReviewer.specialty,
                    disease_entity: editReviewer.disease_entity
                  }).eq('id', editReviewer.id);
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
