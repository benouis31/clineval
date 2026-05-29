'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

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
  if (row.status === 'submitted') return 'Submitted';
  if (row.status === 'in_progress') return 'In progress';
  if (row.status === 'assigned') return 'Assigned';
  return row.status || 'Not started';
}

function nextReviewerCode(reviewers: any[]) {
  const nums = reviewers
    .map(r => r.code?.match(/^PROF_(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `PROF_${String(next).padStart(2, '0')}`;
}

export default function AdminPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newReviewer, setNewReviewer] = useState({ code: '', display_name: '', email: '', specialty: 'Hematology' });
  const [editReviewer, setEditReviewer] = useState<any | null>(null);
  const [assignReviewerId, setAssignReviewerId] = useState('');
  const [assignCaseId, setAssignCaseId] = useState('');
  const [messages, setMessages] = useState<any[]>([]);

  async function load() {
    setLoading(true);
    const [{ data: assignmentData }, { data: reviewerData }, { data: caseData }, { data: responseData }, { data: messageData }] = await Promise.all([
      supabase.from('assignments').select('*, reviewers(*), cases(*)').order('updated_at', { ascending: false }),
      supabase.from('reviewers').select('*').order('created_at', { ascending: true }),
      supabase.from('cases').select('id, case_code, title, disease_category, difficulty_level, is_active').order('created_at', { ascending: false }),
      supabase.from('responses').select('*'),
      supabase.from('reviewer_messages').select('*, reviewers(code, display_name, email), cases(case_code, title)').order('created_at', { ascending: false })
    ]);

    const responsesByAssignment = new Map(
      (responseData || []).map((resp: any) => [resp.assignment_id, resp])
    );

    const mergedRows = (assignmentData || []).map((assignment: any) => ({
      ...assignment,
      response: responsesByAssignment.get(assignment.id) || null
    }));

    setRows(mergedRows);
    const reviewerRows = reviewerData || [];
    setReviewers(reviewerRows);
    setCases(caseData || []);
    setMessages(messageData || []);
    setNewReviewer(prev => ({ ...prev, code: prev.code || nextReviewerCode(reviewerRows) }));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addReviewer() {
    if (!newReviewer.code || !newReviewer.display_name) return alert('Reviewer code and name are required.');
    const { error } = await supabase.from('reviewers').insert({
      code: newReviewer.code.trim(),
      display_name: newReviewer.display_name.trim(),
      email: newReviewer.email.trim() || null,
      specialty: newReviewer.specialty.trim() || null
    });
    if (error) return alert(error.message);
    setNewReviewer({ code: '', display_name: '', email: '', specialty: 'Hematology' });
    await load();
  }

  async function saveReviewer() {
    if (!editReviewer) return;
    const { error } = await supabase.from('reviewers').update({
      code: editReviewer.code.trim(),
      display_name: editReviewer.display_name.trim(),
      email: editReviewer.email?.trim() || null,
      specialty: editReviewer.specialty?.trim() || null
    }).eq('id', editReviewer.id);
    if (error) return alert(error.message);
    setEditReviewer(null);
    await load();
  }

  async function assignCase() {
    if (!assignReviewerId || !assignCaseId) return alert('Choose both reviewer and case.');
    const { error } = await supabase.from('assignments').upsert({
      reviewer_id: assignReviewerId,
      case_id: assignCaseId,
      status: 'assigned',
      current_checkpoint: 1,
      updated_at: new Date().toISOString()
    }, { onConflict: 'reviewer_id,case_id' });
    if (error) return alert(error.message);
    setAssignReviewerId('');
    setAssignCaseId('');
    await load();
  }

  async function toggleCaseActive(caseRow: any, nextActive: boolean) {
    const action = nextActive ? 'activate' : 'deactivate';
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${caseRow.case_code}?`)) return;

    const { error } = await supabase
      .from('cases')
      .update({ is_active: nextActive })
      .eq('id', caseRow.id);

    if (error) {
      alert(error.message);
      return;
    }

    await load();
  }

  async function resetAssignment(row: any) {
    if (!confirm(`Reset ${row.reviewers?.code} / ${row.cases?.case_code} to checkpoint 1?`)) return;
    const { error } = await supabase.from('assignments').update({
      status: 'assigned',
      current_checkpoint: 1,
      updated_at: new Date().toISOString()
    }).eq('id', row.id);
    if (error) return alert(error.message);
    await supabase.from('responses').delete().eq('assignment_id', row.id);
    await load();
  }

  function exportCsv() {
    const header = ['assignment_id','reviewer_code','reviewer','reviewer_email','case','status','current_checkpoint','progress_percent','last_update','submitted_at'];
    const body = rows.map(r => [
      r.id, r.reviewers?.code || '', r.reviewers?.display_name || '', r.reviewers?.email || '',
      r.cases?.case_code || '', statusLabel(r), r.current_checkpoint, progressPct(r), r.updated_at || '',
      r.response?.submitted_at || ''
    ].map(v => `"${String(v).replaceAll('"','""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'clineval-progress.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function exportResponses() {
    const payload = rows.map(r => ({ assignment_id: r.id, reviewer: r.reviewers, case: r.cases, assignment_status: r.status, current_checkpoint: r.current_checkpoint, response: r.response || null }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'clineval-responses.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function reminderEmail(row: any) {
    const email = row.reviewers?.email || '';
    const subject = encodeURIComponent(`Reminder: ClinEval review for ${row.cases?.case_code}`);
    const body = encodeURIComponent(`Dear ${row.reviewers?.display_name || 'Professor'},\n\nPlease continue your ClinEval review for case ${row.cases?.case_code}.\n\nPlatform: https://clineval-nine.vercel.app\nReviewer code: ${row.reviewers?.code}\n\nBest regards`);
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  }

  const total = rows.length;
  const submitted = rows.filter(r => r.status === 'submitted').length;
  const inProgress = rows.filter(r => r.status === 'in_progress').length;
  const notStarted = rows.filter(r => r.status !== 'submitted' && r.status !== 'in_progress').length;
  const avgProgress = total ? Math.round(rows.reduce((s, r) => s + progressPct(r), 0) / total) : 0;

  return <main className="container">
    <div className="card">
      <h1>Admin dashboard</h1>
      <p>Manage reviewers, assign cases, monitor progress, and export study data.</p>
      <div className="row">
        <button className="btn btn-secondary" onClick={load}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        <button className="btn btn-primary" onClick={exportCsv}>Export progress CSV</button>
        <button className="btn btn-secondary" onClick={exportResponses}>Export responses JSON</button>
      </div>
    </div>

    <div className="card">
      <h2>Reviewer Management</h2>
      <div className="form-grid">
        <label>Reviewer code<input value={newReviewer.code} onChange={e => setNewReviewer({ ...newReviewer, code: e.target.value })} /></label>
        <label>Name<input value={newReviewer.display_name} onChange={e => setNewReviewer({ ...newReviewer, display_name: e.target.value })} placeholder="Professor Name" /></label>
        <label>Email<input value={newReviewer.email} onChange={e => setNewReviewer({ ...newReviewer, email: e.target.value })} placeholder="professor@hospital.edu" /></label>
        <label>Specialty<input value={newReviewer.specialty} onChange={e => setNewReviewer({ ...newReviewer, specialty: e.target.value })} /></label>
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={addReviewer}>+ Add Reviewer</button>
        <button className="btn btn-secondary" onClick={() => setNewReviewer({ ...newReviewer, code: nextReviewerCode(reviewers) })}>Generate next code</button>
      </div>

      <table className="table" style={{ marginTop: 24 }}>
        <thead><tr><th>Code</th><th>Name</th><th>Email</th><th>Specialty</th><th>Action</th></tr></thead>
        <tbody>{reviewers.map(r => <tr key={r.id}>
          <td><strong>{r.code}</strong></td><td>{r.display_name}</td><td>{r.email || '-'}</td><td>{r.specialty || '-'}</td>
          <td><button className="btn btn-secondary btn-small" onClick={() => setEditReviewer(r)}>Edit</button></td>
        </tr>)}</tbody>
      </table>
    </div>

    {editReviewer && <div className="card">
      <h2>Edit Reviewer</h2>
      <div className="form-grid">
        <label>Reviewer code<input value={editReviewer.code} onChange={e => setEditReviewer({ ...editReviewer, code: e.target.value })} /></label>
        <label>Name<input value={editReviewer.display_name} onChange={e => setEditReviewer({ ...editReviewer, display_name: e.target.value })} /></label>
        <label>Email<input value={editReviewer.email || ''} onChange={e => setEditReviewer({ ...editReviewer, email: e.target.value })} /></label>
        <label>Specialty<input value={editReviewer.specialty || ''} onChange={e => setEditReviewer({ ...editReviewer, specialty: e.target.value })} /></label>
      </div>
      <div className="row"><button className="btn btn-primary" onClick={saveReviewer}>Save changes</button><button className="btn btn-secondary" onClick={() => setEditReviewer(null)}>Cancel</button></div>
    </div>}

    <div className="card">
      <h2>Assign Case to Reviewer</h2>
      <div className="form-grid">
        <label>Reviewer<select value={assignReviewerId} onChange={e => setAssignReviewerId(e.target.value)}><option value="">Select reviewer</option>{reviewers.map(r => <option key={r.id} value={r.id}>{r.code} - {r.display_name}</option>)}</select></label>
        <label>Case<select value={assignCaseId} onChange={e => setAssignCaseId(e.target.value)}><option value="">Select case</option>{cases.map(c => <option key={c.id} value={c.id}>{c.case_code} - {c.title}</option>)}</select></label>
      </div>
      <button className="btn btn-primary" onClick={assignCase}>Assign selected case</button>
    </div>

    <div className="card">
      <h2>Case Activation</h2>
      <p className="small">Only active cases are available for expert questionnaire review.</p>
      <table className="table">
        <thead><tr><th>Case</th><th>Title</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{cases.map(c => <tr key={c.id}>
          <td><strong>{c.case_code}</strong></td>
          <td>{c.title}</td>
          <td><span className={'status-pill ' + (c.is_active ? 'status-submitted' : 'status-assigned')}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
          <td>
            {c.is_active ? (
              <button className="btn btn-secondary btn-small" onClick={() => toggleCaseActive(c, false)}>Deactivate</button>
            ) : (
              <button className="btn btn-primary btn-small" onClick={() => toggleCaseActive(c, true)}>Activate</button>
            )}
          </td>
        </tr>)}</tbody>
      </table>
    </div>

    <div className="card">
      <h2>Correction Requests</h2>
      {messages.length === 0 ? <p className="small">No correction notes submitted.</p> : (
        <table className="table">
          <thead><tr><th>Reviewer</th><th>Case</th><th>Message</th><th>Submitted</th></tr></thead>
          <tbody>{messages.map(m => <tr key={m.id}>
            <td><strong>{m.reviewers?.display_name || '-'}</strong><br/><span className="small">{m.reviewers?.code || '-'}</span></td>
            <td>{m.cases?.case_code || '-'}</td>
            <td>{m.message}</td>
            <td>{fmt(m.created_at)}</td>
          </tr>)}</tbody>
        </table>
      )}
    </div>

    <div className="stats-grid">
      <div className="stat-card"><div className="stat-number">{total}</div><div className="small">Assignments</div></div>
      <div className="stat-card"><div className="stat-number">{submitted}</div><div className="small">Submitted</div></div>
      <div className="stat-card"><div className="stat-number">{inProgress}</div><div className="small">In progress</div></div>
      <div className="stat-card"><div className="stat-number">{notStarted}</div><div className="small">Not started</div></div>
      <div className="stat-card"><div className="stat-number">{avgProgress}%</div><div className="small">Average progress</div></div>
    </div>

    <div className="card">
      <h2>Assignments</h2>
      <table className="table">
        <thead><tr><th>Reviewer</th><th>Case</th><th>Status</th><th>Progress</th><th>Checkpoint</th><th>Last active</th><th>Action</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td><strong>{r.reviewers?.display_name}</strong><br/><span className="small">{r.reviewers?.code} | {r.reviewers?.email}</span></td>
          <td>{r.cases?.case_code}<br/><span className="small">{r.cases?.title}</span></td>
          <td><span className={'status-pill status-' + (r.status || 'assigned')}>{statusLabel(r)}</span></td>
          <td><div className="mini-progress"><div className="mini-progress-fill" style={{ width: `${progressPct(r)}%` }} /></div><span className="small">{progressPct(r)}%</span></td>
          <td>{r.status === 'submitted' ? 'Complete' : `CP${r.current_checkpoint || 1}`}</td>
          <td>{fmt(r.updated_at)}</td>
          <td><div className="row"><button className="btn btn-secondary btn-small" onClick={() => reminderEmail(r)}>Email</button><button className="btn btn-secondary btn-small" onClick={() => resetAssignment(r)}>Reset</button></div></td>
        </tr>)}</tbody>
      </table>
    </div>
  </main>;
}
