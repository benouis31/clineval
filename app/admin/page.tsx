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
  return Math.round(((cp - 1) / 5) * 100);
}

function statusLabel(row: any) {
  if (row.status === 'submitted') return 'Submitted';
  if (row.status === 'in_progress') return 'In progress';
  if (row.status === 'assigned') return 'Assigned';
  return row.status || 'Not started';
}

export default function AdminPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('assignments')
      .select('*, reviewers(*), cases(*), responses(*)')
      .order('updated_at', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function exportCsv() {
    const header = ['assignment_id','reviewer','reviewer_email','case','status','current_checkpoint','progress_percent','last_update','submitted_at'];
    const body = rows.map(r => [
      r.id,
      r.reviewers?.display_name || '',
      r.reviewers?.email || '',
      r.cases?.case_code || '',
      statusLabel(r),
      r.current_checkpoint,
      progressPct(r),
      r.updated_at || '',
      r.responses?.[0]?.submitted_at || ''
    ].map(v => `"${String(v).replaceAll('"','""')}"`).join(','));
    const csv = [header.join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clineval-progress.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportResponses() {
    const payload = rows.map(r => ({
      assignment_id: r.id,
      reviewer: r.reviewers,
      case: r.cases,
      assignment_status: r.status,
      current_checkpoint: r.current_checkpoint,
      response: r.responses?.[0] || null
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clineval-responses.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function reminderEmail(row: any) {
    const email = row.reviewers?.email || '';
    const subject = encodeURIComponent(`Reminder: ClinEval review for ${row.cases?.case_code}`);
    const body = encodeURIComponent(`Dear ${row.reviewers?.display_name || 'Professor'},\n\nThis is a brief reminder to continue your ClinEval review for case ${row.cases?.case_code}.\n\nYou can access the platform using your reviewer code.\n\nBest regards`);
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
      <p>Monitor reviewer progress, last activity, and submission status.</p>
      <div className="row"><button className="btn btn-secondary" onClick={load}>{loading ? 'Refreshing...' : 'Refresh'}</button><button className="btn btn-primary" onClick={exportCsv}>Export progress CSV</button><button className="btn btn-secondary" onClick={exportResponses}>Export responses JSON</button></div>
    </div>

    <div className="stats-grid">
      <div className="stat-card"><div className="stat-number">{total}</div><div className="small">Assignments</div></div>
      <div className="stat-card"><div className="stat-number">{submitted}</div><div className="small">Submitted</div></div>
      <div className="stat-card"><div className="stat-number">{inProgress}</div><div className="small">In progress</div></div>
      <div className="stat-card"><div className="stat-number">{notStarted}</div><div className="small">Not started</div></div>
      <div className="stat-card"><div className="stat-number">{avgProgress}%</div><div className="small">Average progress</div></div>
    </div>

    <div className="card">
      <table className="table">
        <thead><tr><th>Reviewer</th><th>Case</th><th>Status</th><th>Progress</th><th>Checkpoint</th><th>Last active</th><th>Action</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td><strong>{r.reviewers?.display_name}</strong><br/><span className="small">{r.reviewers?.email}</span></td>
          <td>{r.cases?.case_code}<br/><span className="small">{r.cases?.title}</span></td>
          <td><span className={'status-pill status-' + (r.status || 'assigned')}>{statusLabel(r)}</span></td>
          <td><div className="mini-progress"><div className="mini-progress-fill" style={{ width: `${progressPct(r)}%` }} /></div><span className="small">{progressPct(r)}%</span></td>
          <td>{r.status === 'submitted' ? 'Complete' : `CP${r.current_checkpoint || 1}`}</td>
          <td>{fmt(r.updated_at)}</td>
          <td><button className="btn btn-secondary btn-small" onClick={() => reminderEmail(r)}>Email reminder</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </main>;
}
