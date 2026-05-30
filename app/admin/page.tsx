'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

function fmt(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(row: any) {
  if (row.status === 'submitted') return 'Submitted';
  if (row.status === 'in_progress') return 'In progress';
  if (row.status === 'assigned') return 'Assigned';
  return row.status || 'Not started';
}

function reviewerViewLabel(row: any, caseSubmissionSubmitted: boolean) {
  if (!row.cases?.is_active) return 'Case inactive';
  if (!row.questionnaire_enabled) {
    if (caseSubmissionSubmitted) return 'Case submitted (waiting)';
    return 'Case Submission Form';
  }
  if (row.status === 'submitted') return 'Submitted review';
  return 'Expert Questionnaire';
}

function caseSubmissionProgress(caseSubmission: any) {
  let filled = 0;
  if (caseSubmission?.diagnosis?.trim()) filled++;
  if (caseSubmission?.recommended_tests?.trim()) filled++;
  if (caseSubmission?.confidence_score) filled++;
  if (caseSubmission?.differential_diagnosis?.trim()) filled++;
  return { filled, total: 4 };
}

// FIX: escape double-quotes inside CSV cell values to prevent malformed CSV output
function csvCell(value: any) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

// FIX: private_notes_* and _explanation keys inflate the answered count;
// only count keys that correspond to real question IDs
function countQuestionnaireAnswers(answers: Record<string, any>) {
  return Object.entries(answers).filter(([k, v]) =>
    !k.startsWith('private_notes_') &&
    !k.endsWith('_explanation') &&
    v !== undefined && v !== ''
  ).length;
}

export default function AdminPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [newReviewer, setNewReviewer] = useState({ code: '', display_name: '', email: '', specialty: 'Hematology' });
  const [editReviewer, setEditReviewer] = useState<any | null>(null);
  // FIX: ref to scroll edit panel into view when it opens
  const editPanelRef = useRef<HTMLDivElement>(null);
  const [assignReviewerId, setAssignReviewerId] = useState('');
  const [assignCaseId, setAssignCaseId] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [caseSubmissions, setCaseSubmissions] = useState<any[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);
  // FIX: removed auditLog state — fetched but never rendered, dead dead weight

  // FIX: sessionStorage access on mount is safe because this is a 'use client' component,
  // but guard with typeof check anyway for safety in edge SSR scenarios
  useEffect(() => {
    if (typeof sessionStorage !== 'undefined') {
      const saved = sessionStorage.getItem('adminSearch');
      if (saved) setSearch(saved);
    }
  }, []);
  useEffect(() => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('adminSearch', search);
    }
  }, [search]);

  // FIX: scroll edit panel into view when editReviewer is set
  useEffect(() => {
    if (editReviewer && editPanelRef.current) {
      editPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [editReviewer]);

  async function load() {
    setLoading(true);
    setLoadError('');
    // FIX: removed reviewer_audit_log fetch — state was never used in the render
    const [
      { data: assignmentData, error: e1 },
      { data: reviewerData, error: e2 },
      { data: caseData, error: e3 },
      { data: responseData, error: e4 },
      { data: messageData, error: e5 },
      { data: caseSubmissionData, error: e6 }
    ] = await Promise.all([
      supabase.from('assignments').select('*, reviewers(*), cases(*)'),
      supabase.from('reviewers').select('*').order('created_at'),
      supabase.from('cases').select('*').order('created_at', { ascending: false }),
      supabase.from('responses').select('*'),
      supabase.from('reviewer_messages').select('*, reviewers(code, display_name), cases(case_code)'),
      supabase.from('case_submissions').select('*')
    ]);

    // FIX: was silently ignoring all errors; now surfaces the first failure
    const firstError = e1 || e2 || e3 || e4 || e5 || e6;
    if (firstError) {
      setLoadError('Failed to load data: ' + firstError.message);
      setLoading(false);
      return;
    }

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
      r.cases?.title?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  async function addReviewer() {
    if (!newReviewer.code || !newReviewer.display_name) return alert('Code and name required');
    const { error } = await supabase.from('reviewers').insert(newReviewer);
    if (error) alert(error.message);
    else { setNewReviewer({ code: '', display_name: '', email: '', specialty: 'Hematology' }); await load(); }
  }

  async function saveEditReviewer() {
    if (!editReviewer) return;
    const { error } = await supabase.from('reviewers').update({
      code: editReviewer.code,
      display_name: editReviewer.display_name,
      email: editReviewer.email,
      specialty: editReviewer.specialty,
    }).eq('id', editReviewer.id);
    if (error) { alert(error.message); return; }
    setEditReviewer(null);
    await load();
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
      // FIX: re-fetch case submission fresh rather than relying on potentially stale state
      const { data: freshSubmission } = await supabase
        .from('case_submissions')
        .select('status')
        .eq('assignment_id', row.id)
        .maybeSingle();
      if (!freshSubmission || freshSubmission.status !== 'submitted') {
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
    if (!confirm(`Reset assignment for ${row.reviewers?.code}? This will delete questionnaire answers and case submission, and reset checkpoint.`)) return;
    setUpdating(row.id);
    await supabase.from('assignments').update({
      status: 'assigned', current_checkpoint: 1, questionnaire_enabled: false
    }).eq('id', row.id);
    await supabase.from('responses').delete().eq('assignment_id', row.id);
    // FIX: was not deleting case_submissions row on reset, leaving stale "Submitted" state
    // that would immediately re-enable the questionnaire on next load
    await supabase.from('case_submissions').delete().eq('assignment_id', row.id);
    await load();
    setUpdating(null);
  }

  function exportCsv() {
    const headers = ['assignment_id', 'reviewer_code', 'reviewer_name', 'case_code', 'case_title', 'status', 'questionnaire_enabled', 'case_submission_status', 'last_active'];
    const body = rows.map(r => {
      const submission = caseSubmissions.find(cs => cs.assignment_id === r.id);
      return [
        r.id, r.reviewers?.code, r.reviewers?.display_name,
        r.cases?.case_code, r.cases?.title,
        r.status, r.questionnaire_enabled,
        submission?.status || 'none', r.updated_at
      ];
    });
    // FIX: was using template literal `"${cell}"` with no quote escaping inside values;
    // replaced with csvCell() which escapes internal double-quotes correctly
    const csv = [headers, ...body].map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    // FIX: same download reliability fix as reviewer page — defer revokeObjectURL
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clineval_assignments.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function reminderEmail(row: any) {
    const email = row.reviewers?.email;
    if (!email) return alert('No email address for this reviewer');
    // FIX: window.location.href = mailto: navigates away in some browsers;
    // use a hidden anchor click instead which opens the mail client without leaving the page
    const a = document.createElement('a');
    a.href = `mailto:${email}?subject=ClinEval%20reminder&body=Please%20continue%20your%20review%20for%20case%20${row.cases?.case_code}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <main className="container">
      <div className="card">
        <h1>ClinEval Admin Dashboard</h1>
        {loadError && (
          <div className="warning" style={{ marginBottom: 12 }}>{loadError}</div>
        )}
        <div className="row">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button className="btn btn-primary" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="card">
        <h2>Reviewers</h2>
        <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <input
            className="input"
            style={{ flex: '1 1 100px' }}
            placeholder="Code"
            value={newReviewer.code}
            onChange={e => setNewReviewer({ ...newReviewer, code: e.target.value })}
          />
          <input
            className="input"
            style={{ flex: '2 1 140px' }}
            placeholder="Name"
            value={newReviewer.display_name}
            onChange={e => setNewReviewer({ ...newReviewer, display_name: e.target.value })}
          />
          <input
            className="input"
            style={{ flex: '2 1 140px' }}
            placeholder="Email"
            value={newReviewer.email}
            onChange={e => setNewReviewer({ ...newReviewer, email: e.target.value })}
          />
          <input
            className="input"
            style={{ flex: '1 1 100px' }}
            placeholder="Specialty"
            value={newReviewer.specialty}
            onChange={e => setNewReviewer({ ...newReviewer, specialty: e.target.value })}
          />
          <button className="btn btn-primary" onClick={addReviewer}>+ Add Reviewer</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr><th>Code</th><th>Name</th><th>Email</th><th>Specialty</th><th>Action</th></tr>
            </thead>
            <tbody>
              {reviewers.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.code}</strong></td>
                  <td>{r.display_name}</td>
                  <td>{r.email || '-'}</td>
                  <td>{r.specialty || '-'}</td>
                  <td>
                    <button className="btn btn-secondary btn-small" onClick={() => setEditReviewer(r)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Assign Case to Reviewer</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select
            className="input"
            style={{ flex: '1 1 180px' }}
            value={assignReviewerId}
            onChange={e => setAssignReviewerId(e.target.value)}
          >
            <option value="">Select reviewer</option>
            {reviewers.map(r => <option key={r.id} value={r.id}>{r.code} – {r.display_name}</option>)}
          </select>
          <select
            className="input"
            style={{ flex: '1 1 180px' }}
            value={assignCaseId}
            onChange={e => setAssignCaseId(e.target.value)}
          >
            <option value="">Select case</option>
            {cases.map(c => <option key={c.id} value={c.id}>{c.case_code} – {c.title}</option>)}
          </select>
          <button className="btn btn-primary" onClick={assignCase}>Assign</button>
        </div>
      </div>

      <div className="card">
        <h2>Assignments &amp; Controls</h2>
        <input
          className="input"
          placeholder="Search by reviewer or case..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Case</th>
                <th>Status</th>
                <th>Case sub.</th>
                <th>Progress</th>
                <th>Reviewer view</th>
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
                // FIX: was counting all non-empty answer keys including private_notes_* and
                // _explanation suffixes, inflating the count vs the ~30 denominator
                const answeredCount = row.response?.answers
                  ? countQuestionnaireAnswers(row.response.answers)
                  : 0;
                const questionnaireTotal = 30;
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
                      {caseActive
                        ? <span className="status-pill status-submitted">Active</span>
                        : <span className="status-pill status-assigned">Inactive</span>}
                    </td>
                    <td>
                      <span className={`status-pill status-${row.status || 'not_started'}`}>
                        {statusLabel(row)}
                      </span>
                    </td>
                    <td>
                      {!submission ? (
                        <span className="status-pill status-assigned">Not started</span>
                      ) : caseSubmissionDone ? (
                        <span className="status-pill status-submitted">Submitted</span>
                      ) : (
                        <>
                          <span className="status-pill status-in_progress">Draft</span>
                          <div className="mini-progress" style={{ marginTop: 4 }}>
                            <div className="mini-progress-fill" style={{ width: `${caseProgressPercent}%` }} />
                          </div>
                          <span className="small">{filled}/{total} fields</span>
                        </>
                      )}
                    </td>
                    <td>
                      {questionnaireEnabled ? (
                        <>
                          <div className="mini-progress">
                            <div className="mini-progress-fill" style={{ width: `${questionnairePercent}%` }} />
                          </div>
                          <span className="small">{answeredCount} / ~{questionnaireTotal} answered</span>
                        </>
                      ) : <span className="small">—</span>}
                    </td>
                    <td>
                      <span className="small">{reviewerViewLabel(row, caseSubmissionDone)}</span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {!caseActive && (
                          <button
                            className="btn btn-primary btn-small"
                            onClick={() => toggleCaseActive(row.cases, true)}
                            disabled={updating === row.id}
                          >
                            Activate case
                          </button>
                        )}
                        {caseActive && !isSubmitted && (
                          <>
                            {!questionnaireEnabled ? (
                              <button
                                className="btn btn-primary btn-small"
                                disabled={!caseSubmissionDone || updating === row.id}
                                onClick={() => toggleQuestionnaire(row, true)}
                                title={!caseSubmissionDone ? 'Need case submission first' : ''}
                              >
                                Activate Q
                              </button>
                            ) : (
                              <button
                                className="btn btn-secondary btn-small"
                                onClick={() => toggleQuestionnaire(row, false)}
                                disabled={updating === row.id}
                              >
                                Deactivate Q
                              </button>
                            )}
                            <button
                              className="btn btn-secondary btn-small"
                              onClick={() => resetAssignment(row)}
                              disabled={updating === row.id}
                            >
                              Reset
                            </button>
                            <button
                              className="btn btn-secondary btn-small"
                              onClick={() => reminderEmail(row)}
                            >
                              Email
                            </button>
                          </>
                        )}
                        {isSubmitted && <span className="small">Complete</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>No assignments match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Correction Requests</h2>
        {/* FIX: show total count so hidden messages are visible at a glance */}
        {messages.length === 0 ? (
          <p className="small">None</p>
        ) : (
          <>
            {messages.length > 5 && (
              <p className="small" style={{ marginBottom: 8 }}>
                Showing all {messages.length} requests
              </p>
            )}
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

      {/* FIX: edit panel now has a ref so it can be scrolled into view on open;
          also extracted save logic into saveEditReviewer() with error handling */}
      {editReviewer && (
        <div className="card" ref={editPanelRef}>
          <h2>Edit Reviewer — {editReviewer.code}</h2>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              style={{ flex: '1 1 100px' }}
              placeholder="Code"
              value={editReviewer.code}
              onChange={e => setEditReviewer({ ...editReviewer, code: e.target.value })}
            />
            <input
              className="input"
              style={{ flex: '2 1 140px' }}
              placeholder="Name"
              value={editReviewer.display_name}
              onChange={e => setEditReviewer({ ...editReviewer, display_name: e.target.value })}
            />
            <input
              className="input"
              style={{ flex: '2 1 140px' }}
              placeholder="Email"
              value={editReviewer.email || ''}
              onChange={e => setEditReviewer({ ...editReviewer, email: e.target.value })}
            />
            <input
              className="input"
              style={{ flex: '1 1 100px' }}
              placeholder="Specialty"
              value={editReviewer.specialty || ''}
              onChange={e => setEditReviewer({ ...editReviewer, specialty: e.target.value })}
            />
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={saveEditReviewer}>Save</button>
            <button className="btn btn-secondary" onClick={() => setEditReviewer(null)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}
