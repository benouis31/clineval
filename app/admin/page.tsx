'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
export const dynamic = 'force-dynamic';

function fmt(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
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

function reviewerDisplay(row: any) {
  return `${row.reviewers?.display_name || ''} ${row.reviewers?.code || ''} ${row.reviewers?.email || ''}`.toLowerCase();
}

function caseDisplay(row: any) {
  return `${row.cases?.case_code || ''} ${row.cases?.title || ''}`.toLowerCase();
}

function nextReviewerCode(reviewers: any[]) {
  const nums = reviewers
    .map(r => r.code?.match(/^PROF_(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number);

  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `PROF_${String(next).padStart(2, '0')}`;
}

function reviewerViewLabel(row: any) {
  if (!row.cases?.is_active) return 'Blocked: case inactive';
  if (!row.questionnaire_enabled) return 'Case Submission Form';
  if (row.status === 'submitted') return 'Submitted review';
  return 'Expert Questionnaire';
}

export default function AdminPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignmentFilter, setAssignmentFilter] = useState('');
  const [newReviewer, setNewReviewer] = useState({
    code: '',
    display_name: '',
    email: '',
    specialty: 'Hematology'
  });
  const [editReviewer, setEditReviewer] = useState<any | null>(null);
  const [assignReviewerId, setAssignReviewerId] = useState('');
  const [assignCaseId, setAssignCaseId] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [caseSubmissions, setCaseSubmissions] = useState<any[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);
  const [updatingAssignmentId, setUpdatingAssignmentId] = useState<string>('');

  async function load() {
    setLoading(true);

    const [
      { data: assignmentData, error: assignmentError },
      { data: reviewerData, error: reviewerError },
      { data: caseData, error: caseError },
      { data: responseData, error: responseError },
      { data: messageData, error: messageError },
      { data: auditData, error: auditError },
      { data: caseSubmissionData, error: caseSubmissionError }
    ] = await Promise.all([
      supabase
        .from('assignments')
        .select('*, reviewers(*), cases(*)')
        .order('id', { ascending: true }),

      supabase
        .from('reviewers')
        .select('*')
        .order('created_at', { ascending: true }),

      supabase
        .from('cases')
        .select('id, case_code, title, disease_category, difficulty_level, is_active, specialty, disease_area, template_name')
        .order('created_at', { ascending: false }),

      supabase
        .from('responses')
        .select('*'),

      supabase
        .from('reviewer_messages')
        .select('*, reviewers(code, display_name, email), cases(case_code, title)')
        .order('created_at', { ascending: false }),

      supabase
        .from('reviewer_audit_log')
        .select('*, reviewers(code, display_name), cases(case_code, title)')
        .order('created_at', { ascending: false })
        .limit(100),

      supabase
        .from('case_submissions')
        .select('*, reviewers(code, display_name), cases(case_code, title)')
        .order('created_at', { ascending: false })
    ]);

    if (assignmentError) alert(assignmentError.message);
    if (reviewerError) alert(reviewerError.message);
    if (caseError) alert(caseError.message);
    if (responseError) alert(responseError.message);
    if (messageError) alert(messageError.message);
    if (auditError) console.warn(auditError.message);
    if (caseSubmissionError) console.warn(caseSubmissionError.message);

    const responsesByAssignment = new Map(
      (responseData || []).map((resp: any) => [resp.assignment_id, resp])
    );

    const mergedRows = (assignmentData || []).map((assignment: any) => ({
      ...assignment,
      response: responsesByAssignment.get(assignment.id) || null
    }));

    const reviewerRows = reviewerData || [];

    setRows(mergedRows);
    setReviewers(reviewerRows);
    setCases(caseData || []);
    setMessages(messageData || []);
    setAuditLog(auditData || []);
    setCaseSubmissions(caseSubmissionData || []);
    setNewReviewer(prev => ({
      ...prev,
      code: prev.code || nextReviewerCode(reviewerRows)
    }));

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filteredRows = useMemo(() => {
    const q = assignmentFilter.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter(row => {
      return (
        reviewerDisplay(row).includes(q) ||
        caseDisplay(row).includes(q) ||
        statusLabel(row).toLowerCase().includes(q) ||
        reviewerViewLabel(row).toLowerCase().includes(q)
      );
    });
  }, [rows, assignmentFilter]);

  function responseForAssignment(row: any) {
    return row.response || null;
  }

  function caseSubmissionForAssignment(row: any) {
    return caseSubmissions.find(cs => cs.assignment_id === row.id) || null;
  }

  function missingQualityItems(row: any) {
    const issues: string[] = [];
    const response = responseForAssignment(row);
    const submission = caseSubmissionForAssignment(row);

    if (!row.cases?.is_active) issues.push('Case is inactive');
    if (!submission) issues.push('No independent case submission');
    if (submission && submission.status !== 'submitted') issues.push('Case submission not submitted');
    if (row.questionnaire_enabled && !submission) issues.push('Questionnaire activated before case submission');
    if (row.status === 'submitted' && !response?.submitted_at) issues.push('Submitted status but missing response timestamp');
    if (row.status === 'submitted' && !response?.answers) issues.push('Submitted status but missing answers');

    return issues;
  }

  async function writeAdminAudit(eventType: string, row: any, payload: Record<string, any> = {}) {
    await supabase.from('reviewer_audit_log').insert({
      assignment_id: row?.id || null,
      reviewer_id: row?.reviewer_id || null,
      case_id: row?.case_id || row?.id || null,
      event_type: eventType,
      event_payload: payload,
      created_at: new Date().toISOString()
    });
  }

  function validateBeforeExport() {
    const issues = rows.flatMap(row =>
      missingQualityItems(row).map(issue => ({
        assignment: row.id,
        reviewer: row.reviewers?.code || '-',
        case: row.cases?.case_code || '-',
        issue
      }))
    );

    if (issues.length === 0) {
      alert('Validation passed. No quality-control issues detected.');
      return true;
    }

    const preview = issues
      .slice(0, 12)
      .map(i => `${i.reviewer} / ${i.case}: ${i.issue}`)
      .join('\n');

    return confirm(
      `Quality-control warnings detected (${issues.length}).\n\n${preview}\n\nContinue export anyway?`
    );
  }

  function openAssignmentDetail(row: any) {
    if (!row) {
      alert('No assignment row selected.');
      return;
    }

    setSelectedAssignment(prev =>
      prev?.id === row.id ? null : row
    );
  }

  async function addReviewer() {
    if (!newReviewer.code || !newReviewer.display_name) {
      alert('Reviewer code and name are required.');
      return;
    }

    const { error } = await supabase.from('reviewers').insert({
      code: newReviewer.code.trim(),
      display_name: newReviewer.display_name.trim(),
      email: newReviewer.email.trim() || null,
      specialty: newReviewer.specialty.trim() || null
    });

    if (error) {
      alert(error.message);
      return;
    }

    setNewReviewer({
      code: '',
      display_name: '',
      email: '',
      specialty: 'Hematology'
    });

    await load();
  }

  async function saveReviewer() {
    if (!editReviewer) return;

    const { error } = await supabase
      .from('reviewers')
      .update({
        code: editReviewer.code.trim(),
        display_name: editReviewer.display_name.trim(),
        email: editReviewer.email?.trim() || null,
        specialty: editReviewer.specialty?.trim() || null
      })
      .eq('id', editReviewer.id);

    if (error) {
      alert(error.message);
      return;
    }

    setEditReviewer(null);
    await load();
  }

  async function assignCase() {
    if (!assignReviewerId || !assignCaseId) {
      alert('Choose both reviewer and case.');
      return;
    }

    const selectedReviewer = reviewers.find(r => r.id === assignReviewerId);
    const selectedCase = cases.find(c => c.id === assignCaseId);

    if (!confirm(`Assign ${selectedCase?.case_code || 'this case'} to ${selectedReviewer?.code || 'this reviewer'}?`)) return;

    const { error } = await supabase.from('assignments').upsert({
      reviewer_id: assignReviewerId,
      case_id: assignCaseId,
      status: 'assigned',
      current_checkpoint: 1,
      questionnaire_enabled: false,
      updated_at: new Date().toISOString()
    }, { onConflict: 'reviewer_id,case_id' });

    if (error) {
      alert(error.message);
      return;
    }

    await writeAdminAudit('admin_assigned_case', { id: '', reviewer_id: assignReviewerId, case_id: assignCaseId }, { reviewer_id: assignReviewerId, case_id: assignCaseId });
    setAssignReviewerId('');
    setAssignCaseId('');
    await load();
  }

  async function toggleCaseActive(caseRow: any, nextActive: boolean) {
    const action = nextActive ? 'activate' : 'deactivate';
    const consequence = nextActive
      ? 'Reviewers assigned to this case will be able to access it.'
      : 'Reviewers assigned to this case will be blocked from accessing it.';

    console.log('CASE ACCESS UPDATE REQUEST:', { caseRow, nextActive });

    if (!confirm(`${action.toUpperCase()} ${caseRow.case_code}?\n\n${consequence}`)) return;

    const { data, error } = await supabase
      .from('cases')
      .update({ is_active: nextActive })
      .eq('id', caseRow.id)
      .select('id, case_code, is_active')
      .single();

    console.log('CASE ACCESS UPDATE RESULT:', { data, error });

    if (error) {
      alert(error.message);
      return;
    }

    if (!data) {
      alert('No case row was updated. Check Supabase update permissions for the cases table.');
      return;
    }

    setCases(prev =>
      prev.map(c =>
        c.id === caseRow.id
          ? { ...c, is_active: nextActive }
          : c
      )
    );

    await supabase.from('reviewer_audit_log').insert({
      assignment_id: null,
      reviewer_id: null,
      case_id: caseRow.id,
      event_type: nextActive ? 'admin_case_opened' : 'admin_case_closed',
      event_payload: { case_code: caseRow.case_code, is_active: nextActive },
      created_at: new Date().toISOString()
    });
  }

  async function toggleQuestionnaire(row: any, nextEnabled: boolean) {
    if (!row?.id) {
      alert('Missing assignment id. Please refresh the page.');
      return;
    }

    const reviewerCode = row.reviewers?.code || 'reviewer';
    const caseCode = row.cases?.case_code || 'case';
    const action = nextEnabled ? 'ACTIVATE' : 'DEACTIVATE';

    const explanation = nextEnabled
      ? 'The reviewer will now see the Expert Questionnaire instead of the Case Submission Form.'
      : 'The reviewer will return to the Case Submission Form and the Expert Questionnaire will be hidden.';

    if (!confirm(`${action} questionnaire for ${reviewerCode} / ${caseCode}?\n\n${explanation}`)) return;

    setUpdatingAssignmentId(row.id);

    const { data, error } = await supabase
      .from('assignments')
      .update({
        questionnaire_enabled: nextEnabled
      })
      .eq('id', row.id)
      .select('id, questionnaire_enabled')
      .single();

    setUpdatingAssignmentId('');

    if (error) {
      alert(error.message);
      return;
    }

    if (!data || data.id !== row.id) {
      alert('Unexpected update result. Please refresh and verify the assignment.');
      await load();
      return;
    }

    setRows(prev =>
      prev.map(item =>
        item.id === row.id
          ? {
              ...item,
              questionnaire_enabled: nextEnabled
            }
          : item
      )
    );

  }

  async function resetAssignment(row: any) {
    if (!confirm(`Reset ${row.reviewers?.code} / ${row.cases?.case_code}?\n\nThis deletes questionnaire responses and returns the assignment to checkpoint 1. The independent case submission is kept.`)) return;

    const { error } = await supabase
      .from('assignments')
      .update({
        status: 'assigned',
        current_checkpoint: 1,
        questionnaire_enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', row.id);

    if (error) {
      alert(error.message);
      return;
    }

    await supabase.from('responses').delete().eq('assignment_id', row.id);
    await writeAdminAudit('admin_assignment_reset', row, { reset_to_checkpoint: 1, questionnaire_enabled: false });
    await load();
  }

  function exportCsv() {
    if (!validateBeforeExport()) return;

    const header = [
      'assignment_id',
      'reviewer_code',
      'reviewer',
      'reviewer_email',
      'case',
      'status',
      'questionnaire_enabled',
      'reviewer_current_view',
      'current_checkpoint',
      'progress_percent',
      'last_update',
      'submitted_at'
    ];

    const body = rows.map(r => [
      r.id,
      r.reviewers?.code || '',
      r.reviewers?.display_name || '',
      r.reviewers?.email || '',
      r.cases?.case_code || '',
      statusLabel(r),
      r.questionnaire_enabled ? 'true' : 'false',
      reviewerViewLabel(r),
      r.current_checkpoint,
      progressPct(r),
      r.updated_at || '',
      r.response?.submitted_at || ''
    ].map(v => `"${String(v).replaceAll('"', '""')}"`).join(','));

    const blob = new Blob([[header.join(','), ...body].join('\n')], {
      type: 'text/csv'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clineval-progress.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportResponses() {
    if (!validateBeforeExport()) return;

    const payload = rows.map(r => ({
      assignment_id: r.id,
      reviewer: r.reviewers,
      case: r.cases,
      assignment_status: r.status,
      questionnaire_enabled: !!r.questionnaire_enabled,
      reviewer_current_view: reviewerViewLabel(r),
      current_checkpoint: r.current_checkpoint,
      response: r.response || null
    }));

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });

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
    const body = encodeURIComponent(
      `Dear ${row.reviewers?.display_name || 'Professor'},\n\nPlease continue your ClinEval review for case ${row.cases?.case_code}.\n\nPlatform: https://clineval-nine.vercel.app\nReviewer code: ${row.reviewers?.code}\n\nBest regards`
    );

    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  }

  const total = rows.length;
  const submitted = rows.filter(r => r.status === 'submitted').length;
  const inProgress = rows.filter(r => r.status === 'in_progress').length;
  const questionnaireEnabled = rows.filter(r => r.questionnaire_enabled).length;
  const awaitingActivate = rows.filter(r => r.status !== 'submitted' && !r.questionnaire_enabled).length;
  const avgProgress = total ? Math.round(rows.reduce((s, r) => s + progressPct(r), 0) / total) : 0;

  return (
    <main className="container">
      <div className="card">
        <h1>ClinEval Admin Dashboard</h1>
        <p>
          Manage reviewers, assign cases, activate questionnaires, monitor progress, review correction notes,
          and export study data.
        </p>

        <div className="warning">
          <strong>Study workflow:</strong><br />
          1. Add reviewer → 2. Assign case → 3. Activate case → 4. Reviewer completes Case Submission Form → 5. Activate Expert Questionnaire → 6. Export results.
        </div>

        <div className="row">
          <button className="btn btn-secondary" onClick={load}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button className="btn btn-primary" onClick={exportCsv}>
            Export progress CSV
          </button>
          <button className="btn btn-secondary" onClick={exportResponses}>
            Export responses JSON
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-number">{total}</div>
          <div className="small">Assignments</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{submitted}</div>
          <div className="small">Submitted</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{inProgress}</div>
          <div className="small">In progress</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{awaitingActivate}</div>
          <div className="small">Awaiting questionnaire activation</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{questionnaireEnabled}</div>
          <div className="small">Questionnaires activated</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{avgProgress}%</div>
          <div className="small">Average progress</div>
        </div>
      </div>

      <div className="card">
        <h2>Reviewer Management</h2>
        <p className="small">Create anonymous reviewer access codes and optionally store email/specialty metadata.</p>

        <div className="form-grid">
          <label>
            Reviewer code
            <input
              value={newReviewer.code}
              onChange={e => setNewReviewer({ ...newReviewer, code: e.target.value })}
            />
          </label>

          <label>
            Name
            <input
              value={newReviewer.display_name}
              onChange={e => setNewReviewer({ ...newReviewer, display_name: e.target.value })}
              placeholder="Professor Name"
            />
          </label>

          <label>
            Email
            <input
              value={newReviewer.email}
              onChange={e => setNewReviewer({ ...newReviewer, email: e.target.value })}
              placeholder="professor@hospital.edu"
            />
          </label>

          <label>
            Specialty
            <input
              value={newReviewer.specialty}
              onChange={e => setNewReviewer({ ...newReviewer, specialty: e.target.value })}
            />
          </label>
        </div>

        <div className="row">
          <button className="btn btn-primary" onClick={addReviewer}>
            + Add Reviewer
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setNewReviewer({ ...newReviewer, code: nextReviewerCode(reviewers) })}
          >
            Generate next code
          </button>
        </div>

        <table className="table" style={{ marginTop: 24 }}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Email</th>
              <th>Specialty</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {reviewers.length === 0 ? (
              <tr><td colSpan={5}>No reviewers yet.</td></tr>
            ) : reviewers.map(r => (
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

      {editReviewer && (
        <div className="card">
          <h2>Edit Reviewer</h2>

          <div className="form-grid">
            <label>
              Reviewer code
              <input
                value={editReviewer.code}
                onChange={e => setEditReviewer({ ...editReviewer, code: e.target.value })}
              />
            </label>

            <label>
              Name
              <input
                value={editReviewer.display_name}
                onChange={e => setEditReviewer({ ...editReviewer, display_name: e.target.value })}
              />
            </label>

            <label>
              Email
              <input
                value={editReviewer.email || ''}
                onChange={e => setEditReviewer({ ...editReviewer, email: e.target.value })}
              />
            </label>

            <label>
              Specialty
              <input
                value={editReviewer.specialty || ''}
                onChange={e => setEditReviewer({ ...editReviewer, specialty: e.target.value })}
              />
            </label>
          </div>

          <div className="row">
            <button className="btn btn-primary" onClick={saveReviewer}>
              Save changes
            </button>
            <button className="btn btn-secondary" onClick={() => setEditReviewer(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Assign Case to Reviewer</h2>
        <p className="small">
          New assignments start with the Expert Questionnaire disabled. The reviewer first sees the Case Submission Form.
        </p>

        <div className="form-grid">
          <label>
            Reviewer
            <select value={assignReviewerId} onChange={e => setAssignReviewerId(e.target.value)}>
              <option value="">Select reviewer</option>
              {reviewers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.code} - {r.display_name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Case
            <select value={assignCaseId} onChange={e => setAssignCaseId(e.target.value)}>
              <option value="">Select case</option>
              {cases.map(c => (
                <option key={c.id} value={c.id}>
                  {c.case_code} - {c.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button className="btn btn-primary" onClick={assignCase}>
          Assign selected case
        </button>
      </div>

      <div className="card">
        <h2>Case Access Control</h2>
        <p className="small">
          Active cases are visible to assigned reviewers. Inactive cases are completely blocked, even if the reviewer has an assignment.
        </p>

        <table className="table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Title</th>
              <th>Access Status</th>
              <th>Reviewer Access</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {cases.length === 0 ? (
              <tr><td colSpan={5}>No cases found.</td></tr>
            ) : cases.map(c => (
              <tr key={c.id}>
                <td><strong>{c.case_code}</strong></td>
                <td>{c.title}</td>
                <td>
                  <span className={'status-pill ' + (c.is_active ? 'status-submitted' : 'status-assigned')}>
                    {c.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>{c.is_active ? 'Can enter assigned case' : 'Blocked before case submission'}</td>
                <td>
                  {c.is_active ? (
                    <button className="btn btn-secondary btn-small" onClick={() => toggleCaseActive(c, false)}>
                      Deactivate case
                    </button>
                  ) : (
                    <button className="btn btn-primary btn-small" onClick={() => toggleCaseActive(c, true)}>
                      Activate case
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Assignments & Questionnaire Activation</h2>
        <p className="small">
          Use this table to activate the Expert Questionnaire only after the reviewer has completed the independent Case Submission Form.
          Each button affects only the assignment ID shown under that reviewer.
        </p>

        <input
          className="input"
          value={assignmentFilter}
          onChange={e => setAssignmentFilter(e.target.value)}
          placeholder="Search reviewer, case, status, or current reviewer view..."
          style={{ marginBottom: 16 }}
        />

        <table className="table">
          <thead>
            <tr>
              <th>Reviewer</th>
              <th>Case</th>
              <th>Assignment Status</th>
              <th>Questionnaire</th>
              <th>Reviewer Currently Sees</th>
              <th>Progress</th>
              <th>Checkpoint</th>
              <th>Last Active</th>
              <th>Quality</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredRows.length === 0 ? (
              <tr><td colSpan={10}>No assignments match this view.</td></tr>
            ) : filteredRows.map(r => (
              <Fragment key={r.id}>
              <tr>
                <td>
                  <strong>{r.reviewers?.display_name || '-'}</strong>
                  <br />
                  <span className="small">{r.reviewers?.code || '-'} | {r.reviewers?.email || '-'}</span>
                  <br />
                  <span className="small">Assignment ID: {r.id}</span>
                </td>

                <td>
                  {r.cases?.case_code || '-'}
                  <br />
                  <span className="small">{r.cases?.title || '-'}</span>
                </td>

                <td>
                  <span className={'status-pill status-' + (r.status || 'assigned')}>
                    {statusLabel(r)}
                  </span>
                </td>

                <td>
                  <span className={'status-pill ' + (r.questionnaire_enabled ? 'status-submitted' : 'status-assigned')}>
                    {r.questionnaire_enabled ? 'Activated' : 'Deactivated'}
                  </span>
                </td>

                <td>{reviewerViewLabel(r)}</td>

                <td>
                  <div className="mini-progress">
                    <div className="mini-progress-fill" style={{ width: `${progressPct(r)}%` }} />
                  </div>
                  <span className="small">{progressPct(r)}%</span>
                </td>

                <td>{r.status === 'submitted' ? 'Complete' : `CP${r.current_checkpoint || 1}`}</td>

                <td>{fmt(r.updated_at)}</td>

                <td>
                  {missingQualityItems(r).length === 0 ? (
                    <span className="status-pill status-submitted">OK</span>
                  ) : (
                    <span className="status-pill status-assigned">{missingQualityItems(r).length} warning(s)</span>
                  )}
                </td>

                <td>
                  <div className="row">
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => openAssignmentDetail(r)}>
                      Manage
                    </button>
                    <button className="btn btn-secondary btn-small" onClick={() => reminderEmail(r)}>
                      Email
                    </button>

                    {r.questionnaire_enabled ? (
                      <button
                        className="btn btn-secondary btn-small"
                        disabled={updatingAssignmentId === r.id}
                        onClick={() => toggleQuestionnaire(r, false)}
                      >
                        {updatingAssignmentId === r.id ? 'Updating...' : 'Deactivate Questionnaire'}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-small"
                        disabled={updatingAssignmentId === r.id}
                        onClick={() => toggleQuestionnaire(r, true)}
                      >
                        {updatingAssignmentId === r.id ? 'Updating...' : 'Activate Questionnaire'}
                      </button>
                    )}

                    <button className="btn btn-secondary btn-small" onClick={() => resetAssignment(r)}>
                      Reset
                    </button>
                  </div>
                </td>
              </tr>
              {selectedAssignment?.id === r.id && (
                <tr>
                  <td colSpan={10}>
                    <div className="card" style={{ margin: '12px 0' }}>
                      <h3>Selected Assignment Detail</h3>
                      <p className="small">
                        Reviewer: {r.reviewers?.code || '-'} | Case: {r.cases?.case_code || '-'} | Assignment: {r.id}
                      </p>

                      <div className="stats-grid">
                        <div className="stat-card">
                          <div className="stat-number">{statusLabel(r)}</div>
                          <div className="small">Assignment status</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-number">{r.questionnaire_enabled ? 'Activated' : 'Deactivated'}</div>
                          <div className="small">Questionnaire</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-number">{progressPct(r)}%</div>
                          <div className="small">Progress</div>
                        </div>
                      </div>

                      <h4>Quality-control checks</h4>
                      {missingQualityItems(r).length === 0 ? (
                        <p className="small">No quality-control warnings for this assignment.</p>
                      ) : (
                        <ul>
                          {missingQualityItems(r).map((issue, idx) => (
                            <li key={idx}>{issue}</li>
                          ))}
                        </ul>
                      )}

                      <h4>Independent case submission</h4>
                      <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                        {JSON.stringify(caseSubmissionForAssignment(r) || 'No case submission found', null, 2)}
                      </pre>

                      <h4>Questionnaire response</h4>
                      <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                        {JSON.stringify(responseForAssignment(r) || 'No questionnaire response found', null, 2)}
                      </pre>

                      <h4>Recent audit events</h4>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Event</th>
                            <th>Payload</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditLog
                            .filter(a => a.assignment_id === r.id)
                            .slice(0, 20)
                            .map(a => (
                              <tr key={a.id}>
                                <td>{fmt(a.created_at)}</td>
                                <td>{a.event_type}</td>
                                <td>
                                  <pre style={{ whiteSpace: 'pre-wrap' }}>
                                    {JSON.stringify(a.event_payload || {}, null, 2)}
                                  </pre>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>

                      <button className="btn btn-secondary btn-small" onClick={() => setSelectedAssignment(null)}>
                        Close detail
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>


      <div className="card">
        <h2>Correction Requests</h2>
        <p className="small">Post-submission correction notes sent by reviewers.</p>

        {messages.length === 0 ? (
          <p className="small">No correction notes submitted.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Case</th>
                <th>Message</th>
                <th>Submitted</th>
              </tr>
            </thead>

            <tbody>
              {messages.map(m => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.reviewers?.display_name || '-'}</strong>
                    <br />
                    <span className="small">{m.reviewers?.code || '-'}</span>
                  </td>
                  <td>{m.cases?.case_code || '-'}</td>
                  <td>{m.message}</td>
                  <td>{fmt(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Recent Audit Log</h2>
        <p className="small">Most recent platform events. Use this to investigate saves, submissions, resets, and admin actions.</p>
        {auditLog.length === 0 ? (
          <p className="small">No audit events recorded yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Reviewer</th>
                <th>Case</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.slice(0, 30).map(a => (
                <tr key={a.id}>
                  <td>{fmt(a.created_at)}</td>
                  <td>{a.reviewers?.code || '-'}</td>
                  <td>{a.cases?.case_code || '-'}</td>
                  <td>{a.event_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </main>
  );
}
