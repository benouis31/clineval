'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Helper functions (keep as they were)
function fmt(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function progressPct(row: any) {
  if (row.status === 'submitted') return 100;
  const cp = Math.max(1, Math.min(5, row.current_checkpoint || 1));
  return Math.round(((cp - 1) / 4) * 100);
}

function statusLabel(row: any) {
  if (row.status === 'submitted') return '✅ Submitted';
  if (row.status === 'in_progress') return '🟡 In progress';
  if (row.status === 'assigned') return '⚪ Assigned';
  return row.status || 'Not started';
}

function reviewerViewLabel(row: any) {
  if (!row.cases?.is_active) return '🔒 Case blocked (inactive)';
  if (!row.questionnaire_enabled) return '📝 Case Submission Form';
  if (row.status === 'submitted') return '📋 Submitted review';
  return '📊 Expert Questionnaire';
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
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);

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
    
    const responsesMap = new Map((responseData || []).map((r: any) => [r.assignment_id, r]));
    const merged = (assignmentData || []).map((a: any) => ({ ...a, response: responsesMap.get(a.id) }));
    setRows(merged);
    setReviewers(reviewerData || []);
    setCases(caseData || []);
    setMessages(messageData || []);
    setAuditLog(auditData || []);
    setCaseSubmissions(caseSubmissionData || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows;
    return rows.filter(r => 
      r.reviewers?.display_name?.toLowerCase().includes(q) ||
      r.reviewers?.code?.toLowerCase().includes(q) ||
      r.cases?.case_code?.toLowerCase().includes(q) ||
      statusLabel(r).toLowerCase().includes(q)
    );
  }, [rows, search]);

  async function addReviewer() {
    if (!newReviewer.code || !newReviewer.display_name) return alert('Code and name required');
    const { error } = await supabase.from('reviewers').insert(newReviewer);
    if (error) alert(error.message);
    else {
      setNewReviewer({ code: '', display_name: '', email: '', specialty: 'Hematology' });
      await load();
    }
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
    else {
      setAssignReviewerId('');
      setAssignCaseId('');
      await load();
    }
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
        alert('Cannot activate: reviewer has not submitted the independent case assessment yet.');
        return;
      }
      if (!row.cases?.is_active) {
        alert('Cannot activate: case is inactive. Please activate the case first.');
        return;
      }
    }
    const { error } = await supabase.from('assignments').update({ questionnaire_enabled: enable }).eq('id', row.id);
    if (error) alert(error.message);
    else await load();
  }

  async function resetAssignment(row: any) {
    if (!confirm(`Reset assignment for ${row.reviewers?.code}? This will delete questionnaire answers.`)) return;
    await supabase.from('assignments').update({ status: 'assigned', current_checkpoint: 1, questionnaire_enabled: false }).eq('id', row.id);
    await supabase.from('responses').delete().eq('assignment_id', row.id);
    await load();
  }

  function exportCsv() {
    const headers = ['assignment_id','reviewer','case','status','questionnaire_enabled','progress','last_active'];
    const body = rows.map(r => [r.id, r.reviewers?.code, r.cases?.case_code, statusLabel(r), r.questionnaire_enabled, progressPct(r), r.updated_at]);
    const csv = [headers, ...body].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'clineval.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="container">
      <div className="card">
        <h1>🧪 ClinEval Admin Dashboard</h1>
        <p>Manage reviewers, assign cases, activate questionnaires, and export data.</p>
        <div className="row">
          <button className="btn btn-secondary" onClick={load}>{loading ? '...' : 'Refresh'}</button>
          <button className="btn btn-primary" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      {/* Reviewer Management */}
      <div className="card">
        <h2>👥 Reviewers</h2>
        <div className="form-grid">
          <input placeholder="Code" value={newReviewer.code} onChange={e => setNewReviewer({...newReviewer, code: e.target.value})} />
          <input placeholder="Name" value={newReviewer.display_name} onChange={e => setNewReviewer({...newReviewer, display_name: e.target.value})} />
          <input placeholder="Email" value={newReviewer.email} onChange={e => setNewReviewer({...newReviewer, email: e.target.value})} />
          <input placeholder="Specialty" value={newReviewer.specialty} onChange={e => setNewReviewer({...newReviewer, specialty: e.target.value})} />
          <button className="btn btn-primary" onClick={addReviewer}>+ Add Reviewer</button>
        </div>
        <table className="table">
          <thead><tr><th>Code</th><th>Name</th><th>Email</th><th>Specialty</th><th>Action</th></tr></thead>
          <tbody>
            {reviewers.map(r => <tr key={r.id}><td>{r.code}</td><td>{r.display_name}</td><td>{r.email || '-'}</td><td>{r.specialty || '-'}</td><td><button className="btn btn-secondary btn-small" onClick={() => setEditReviewer(r)}>Edit</button></td></tr>)}
          </tbody>
        </table>
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

      {/* All-in-one Assignments Table */}
      <div className="card">
        <h2>📋 Assignments & Questionnaire Control</h2>
        <input className="input" placeholder="Search reviewer or case..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16 }} />
        <table className="table">
          <thead>
            <tr>
              <th>Reviewer</th>
              <th>Case</th>
              <th>Status</th>
              <th>What reviewer sees</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(r => {
              const caseActive = r.cases?.is_active;
              const submissionDone = caseSubmissions.find(cs => cs.assignment_id === r.id)?.status === 'submitted';
              return (
                <tr key={r.id} className={!caseActive ? 'row-inactive' : ''}>
                  <td><strong>{r.reviewers?.display_name}</strong><br/><span className="small">{r.reviewers?.code}</span></td>
                  <td><strong>{r.cases?.case_code}</strong><br/><span className="small">{r.cases?.title}</span><br/>
                    {!caseActive && <span className="status-pill status-assigned">🔒 Inactive</span>}
                    {caseActive && <span className="status-pill status-submitted">✅ Active</span>}
                  </td>
                  <td>{statusLabel(r)}</td>
                  <td>{reviewerViewLabel(r)}</td>
                  <td>
                    <div className="row">
                      {!caseActive ? (
                        <button className="btn btn-primary btn-small" onClick={() => toggleCaseActive(r.cases, true)}>🔓 Activate Case</button>
                      ) : (
                        <>
                          {!r.questionnaire_enabled ? (
                            <button className="btn btn-primary btn-small" disabled={!submissionDone} onClick={() => toggleQuestionnaire(r, true)}>
                              {submissionDone ? '📝 Activate Questionnaire' : '⏳ Waiting for case submission'}
                            </button>
                          ) : (
                            <button className="btn btn-secondary btn-small" onClick={() => toggleQuestionnaire(r, false)}>🔒 Deactivate Questionnaire</button>
                          )}
                          <button className="btn btn-secondary btn-small" onClick={() => resetAssignment(r)}>🔄 Reset</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Correction notes & audit log - keep short */}
      <div className="card">
        <h2>💬 Correction Requests</h2>
        {messages.length === 0 ? <p className="small">None</p> : messages.map(m => <div key={m.id}><strong>{m.reviewers?.code}</strong>: {m.message} <span className="small">({fmt(m.created_at)})</span></div>)}
      </div>
    </main>
  );
}