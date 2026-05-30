'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Helper functions
function fmt(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(row: any) {
  if (row.status === 'submitted') return '✅ Submitted';
  if (row.status === 'in_progress') return '🟡 In progress';
  if (row.status === 'assigned') return '⚪ Assigned';
  return row.status || 'Not started';
}

function reviewerViewLabel(row: any, hasCaseSubmission: boolean, caseSubmissionSubmitted: boolean) {
  if (!row.cases?.is_active) return '🔒 Case inactive';
  if (!row.questionnaire_enabled) {
    if (caseSubmissionSubmitted) return '📋 Case submitted (waiting)';
    return '📝 Case Submission Form';
  }
  if (row.status === 'submitted') return '📊 Submitted review';
  return '📊 Expert Questionnaire';
}

function caseSubmissionProgress(caseSubmission: any) {
  let filled = 0;
  if (caseSubmission?.diagnosis?.trim()) filled++;
  if (caseSubmission?.recommended_tests?.trim()) filled++;
  if (caseSubmission?.confidence_score) filled++;
  if (caseSubmission?.differential_diagnosis?.trim()) filled++;
  return { filled, total: 4 };
}

function nextReviewerCode(reviewers: any[]) {
  const nums = reviewers.map(r => r.code?.match(/^PROF_(\d+)$/)?.[1]).filter(Boolean).map(Number);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `PROF_${String(next).padStart(2, '0')}`;
}

export default function AdminPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [newReviewer, setNewReviewer] = useState({ code: '', display_name: '', email: '', specialty: 'Hematology' });
  const [editReviewer, setEditReviewer] = useState<any | null>(null);
  const [assignReviewerId, setAssignReviewerId] = useState('');
  const [assignCaseId, setAssignCaseId] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [caseSubmissions, setCaseSubmissions] = useState<any[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [
      { data: assignmentData },
      { data: reviewerData },
      { data: caseData },
      { data: responseData },
      { data: messageData },
      { data: auditData },
      { data: caseSubmissionData }
    ] = await Promise.all([
      supabase.from('assignments').select('*, reviewers(*), cases(*)'),
      supabase.from('reviewers').select('*').order('created_at'),
      supabase.from('cases').select('*').order('created_at', { ascending: false }),
      supabase.from('responses').select('*'),
      supabase.from('reviewer_messages').select('*, reviewers(code, display_name), cases(case_code)'),
      supabase.from('reviewer_audit_log').select('*, reviewers(code), cases(case_code)').limit(100),
      supabase.from('case_submissions').select('*')
    ]);

    // Deduplicate assignments by reviewer_id+case_id (keep latest updated_at)
    const uniqueMap = new Map();
    (assignmentData || []).forEach((a: any) => {
      const key = `${a.reviewer_id}|${a.case_id}`;
      const existing = uniqueMap.get(key);
      if (!existing || new Date(a.updated_at) > new Date(existing.updated_at)) {
        uniqueMap.set(key, a);
      }
    });
    const deduped = Array.from(uniqueMap.values());

    const responsesMap = new Map((responseData || []).map((r: any) => [r.assignment_id, r]));
    const merged = deduped.map((a: any) => ({ ...a, response: responsesMap.get(a.id) }));
    setRows(merged);
    setReviewers(reviewerData || []);
    setCases(caseData || []);
    setMessages(messageData || []);
    setAuditLog(auditData || []);
    setCaseSubmissions(caseSubmissionData || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Persist search filter
  useEffect(() => {
    const saved = sessionStorage.getItem('adminSearch');
    if (saved) setSearch(saved);
  }, []);
  useEffect(() => { sessionStorage.setItem('adminSearch', search); }, [search]);

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.reviewers?.display_name?.toLowerCase().includes(q) ||
      r.reviewers?.code?.toLowerCase().includes(q) ||
      r.cases?.case_code?.toLowerCase().includes(q) ||
      r.cases?.title?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Actions
  async function addReviewer() {
    if (!newReviewer.code || !newReviewer.display_name) return alert('Code and name required');
    const { error } = await supabase.from('reviewers').insert(newReviewer);
    if (error) alert(error.message);
    else { setNewReviewer({ code: '', display_name: '', email: '', specialty: 'Hematology' }); await load(); }
  }

  async function assignCase() {
    if (!assignReviewerId || !assignCaseId) return alert('Select both');
    const { error } = await supabase.from('assignments').upsert({
      reviewer_id: assignReviewerId,
      case_id: assignCaseId,
      status: 'assigned',
      current_checkpoint: 1,
      questionnaire_enabled: false,
      updated_at: new Date().toISOString()
    }, { onConflict: 'reviewer_id,case_id' });
    if (error) alert(error.message);
    else { setAssignReviewerId(''); setAssignCaseId(''); await load(); }
  }

  async function toggleCaseActive(caseRow: any, active: boolean) {
    if (!confirm(`${active ? 'Activate' : 'Deactivate'} case ${caseRow.case_code}?`)) return;
    const { error } = await supabase.from('cases').update({ is_active: active }).eq('id', caseRow.id);
    if (error) alert(error.message);
    else await load();
  }

  async function toggleQuestionnaire(row: any, enable: boolean) {
    if (enable) {
      const submission = caseSubmissions.find(cs => cs.assignment_id === row.id);
      if (!submission || submission.status !== 'submitted') {
        alert('Cannot activate: reviewer has not submitted the independent case assessment.');
        return;
      }
      if (!row.cases?.is_active) {
        alert('Cannot activate: case is inactive. Please activate the case first.');
        return;
      }
    }
    setUpdating(row.id);
    const { error } = await supabase.from('assignments').update({ questionnaire_enabled: enable }).eq('id', row.id);
    if (error) alert(error.message);
    await load();
    setUpdating(null);
  }

  async function resetAssignment(row: any) {
    if (!confirm(`Reset assignment for ${row.reviewers?.code}? This will delete questionnaire answers and reset checkpoint.`)) return;
    setUpdating(row.id);
    await supabase.from('assignments').update({ status: 'assigned', current_checkpoint: 1, questionnaire_enabled: false }).eq('id', row.id);
    await supabase.from('responses').delete().eq('assignment_id', row.id);
    await load();
    setUpdating(null);
  }

  function exportCsv() {
    const headers = ['assignment_id', 'reviewer_code', 'reviewer_name', 'case_code', 'case_title', 'status', 'questionnaire_enabled', 'case_submission_status', 'progress_pct', 'last_active'];
    const body = rows.map(r => {
      const submission = caseSubmissions.find(cs => cs.assignment_id === r.id);
      return [r.id, r.reviewers?.code, r.reviewers?.display_name, r.cases?.case_code, r.cases?.title, r.status, r.questionnaire_enabled, submission?.status || 'none', '?', r.updated_at];
    });
    const csv = [headers, ...body].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'clineval_assignments.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function reminderEmail(row: any) {
    const email = row.reviewers?.email;
    if (!email) return alert('No email address for this reviewer');
    window.location.href = `mailto:${email}?subject=ClinEval%20reminder&body=Please%20continue%20your%20review%20for%20case%20${row.cases?.case_code}`;
  }

  return (
    <main className="container">
      <div className="card">
        <h1>🧪 ClinEval Admin Dashboard</h1>
        <div className="row">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>{loading ? '...' : 'Refresh'}</button>
          <button className="btn btn-primary" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      {/* Reviewer Management */}
      <div className="card">
        <h2>👥 Reviewers</h2>
        <div className="form-grid">
          <input placeholder="Code" value={newReviewer.code} onChange={e => setNewReviewer({ ...newReviewer, code: e.target.value })} />
          <input placeholder="Name" value={newReviewer.display_name} onChange={e => setNewReviewer({ ...newReviewer, display_name: e.target.value })} />
          <input placeholder="Email" value={newReviewer.email} onChange={e => setNewReviewer({ ...newReviewer, email: e.target.value })} />
          <input placeholder="Specialty" value={newReviewer.specialty} onChange={e => setNewReviewer({ ...newReviewer, specialty: e.target.value })} />
          <button className="btn btn-primary" onClick={addReviewer}>+ Add Reviewer</button>
        </div>
        <div className="table-wrapper">
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

      {/* Assign Case */}
      <div className="card">
        <h2>📎 Assign Case to Reviewer</h2>
        <div className="form-grid">
          <select value={assignReviewerId} onChange={e => setAssignReviewerId(e.target.value)}>
            <option value="">Select reviewer</option>
            {reviewers.map(r => <option key={r.id} value={r.id}>{r.code} - {r.display_name}</option>)}
          </select>
          <select value={assignCaseId} onChange={e => setAssignCaseId(e.target.value)}>
            <option value="">Select case</option>
            {cases.map(c => <option key={c.id} value={c.id}>{c.case_code} - {c.title}</option>)}
          </select>
          <button className="btn btn-primary" onClick={assignCase}>Assign</button>
        </div>
      </div>

      {/* Assignments Table - Redesigned */}
      <div className="card">
        <h2>📋 Assignments & Controls</h2>
        <input className="input" placeholder="Search by reviewer or case..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16 }} />
        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="table assignments-table">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Case</th>
                <th>Status</th>
                <th>Case Sub.</th>
                <th>Progress</th>
                <th>Reviewer View</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                const submission = caseSubmissions.find(cs => cs.assignment_id === row.id);
                const caseSubmissionDone = submission?.status === 'submitted';
                const caseActive = row.cases?.is_active;
                const questionnaireEnabled = row.questionnaire_enabled;
                const isSubmitted = row.status === 'submitted';
                const { filled, total } = caseSubmissionProgress(submission);
                const caseProgressPercent = Math.round((filled / total) * 100);
                const answeredCount = row.response?.answers ? Object.keys(row.response.answers).filter(k => row.response.answers[k] && row.response.answers[k] !== '').length : 0;
                const questionnaireTotal = 30; // approximate; you could compute exactly
                const questionnairePercent = Math.round((answeredCount / questionnaireTotal) * 100);

                return (
                  <tr key={row.id} className={!caseActive ? 'row-inactive' : ''}>
                    <td>
                      <strong>{row.reviewers?.display_name || '-'}</strong><br />
                      <span className="small">{row.reviewers?.code}</span>
                    </td>
                    <td>
                      <strong>{row.cases?.case_code}</strong><br />
                      <span className="small">{row.cases?.title?.slice(0, 50)}</span><br />
                      {caseActive ? <span className="status-pill status-submitted">✅ Active</span> : <span className="status-pill status-assigned">🔒 Inactive</span>}
                    </td>
                    <td>{statusLabel(row)}</td>
                    <td>
                      {!submission ? (
                        <span className="status-pill status-assigned">⬜ Not started</span>
                      ) : caseSubmissionDone ? (
                        <span className="status-pill status-submitted">✅ Submitted</span>
                      ) : (
                        <span>
                          <span className="status-pill status-in_progress">✏️ Draft</span>
                          <div className="mini-progress" style={{ marginTop: 4 }}><div className="mini-progress-fill" style={{ width: `${caseProgressPercent}%` }} /></div>
                          <span className="small">{filled}/{total} fields</span>
                        </span>
                      )}
                    </td>
                    <td>
                      {questionnaireEnabled ? (
                        <>
                          <div className="mini-progress"><div className="mini-progress-fill" style={{ width: `${questionnairePercent}%` }} /></div>
                          <span className="small">{answeredCount} / ~30 answered</span>
                        </>
                      ) : (
                        <span className="small">—</span>
                      )}
                    </td>
                    <td>{reviewerViewLabel(row, !!submission, caseSubmissionDone)}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {!caseActive && (
                          <button className="btn btn-primary btn-small" onClick={() => toggleCaseActive(row.cases, true)} disabled={updating === row.id}>
                            🔓 Activate Case
                          </button>
                        )}
                        {caseActive && !isSubmitted && (
                          <>
                            {!questionnaireEnabled ? (
                              <button
                                className="btn btn-primary btn-small"
                                disabled={!caseSubmissionDone || updating === row.id}
                                onClick={() => toggleQuestionnaire(row, true)}
                                title={!caseSubmissionDone ? "Need case submission first" : ""}
                              >
                                📝 Activate Q
                              </button>
                            ) : (
                              <button className="btn btn-secondary btn-small" onClick={() => toggleQuestionnaire(row, false)} disabled={updating === row.id}>
                                🔒 Deactivate Q
                              </button>
                            )}
                            <button className="btn btn-secondary btn-small" onClick={() => resetAssignment(row)} disabled={updating === row.id}>
                              🔄 Reset
                            </button>
                            <button className="btn btn-secondary btn-small" onClick={() => reminderEmail(row)}>📧 Email</button>
                          </>
                        )}
                        {isSubmitted && <span className="small">✅ Complete</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && <tr><td colSpan={7}>No assignments match your search.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Correction Requests (compact) */}
      <div className="card">
        <h2>💬 Correction Requests</h2>
        {messages.length === 0 ? <p className="small">None</p> : (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {messages.map(m => <div key={m.id}><strong>{m.reviewers?.code}</strong> on {m.cases?.case_code}: {m.message} <span className="small">({fmt(m.created_at)})</span></div>)}
          </div>
        )}
      </div>

      {/* Edit Reviewer Modal (inline) */}
      {editReviewer && (
        <div className="card">
          <h2>Edit Reviewer</h2>
          <div className="form-grid">
            <input value={editReviewer.code} onChange={e => setEditReviewer({ ...editReviewer, code: e.target.value })} />
            <input value={editReviewer.display_name} onChange={e => setEditReviewer({ ...editReviewer, display_name: e.target.value })} />
            <input value={editReviewer.email || ''} onChange={e => setEditReviewer({ ...editReviewer, email: e.target.value })} />
            <input value={editReviewer.specialty || ''} onChange={e => setEditReviewer({ ...editReviewer, specialty: e.target.value })} />
            <button className="btn btn-primary" onClick={async () => {
              await supabase.from('reviewers').update(editReviewer).eq('id', editReviewer.id);
              setEditReviewer(null);
              await load();
            }}>Save</button>
            <button className="btn btn-secondary" onClick={() => setEditReviewer(null)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}