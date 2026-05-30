'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';

const DISEASE_CATEGORIES = [
  'Acute lymphoblastic leukemia',
  'Acute myeloid leukemia',
  'Aggressive lymphoma',
  'Chronic lymphoid leukemia',
  'Chronic myeloid leukemia',
  "Hodgkin's lymphoma",
  'Indolent lymphoma',
  'Myelodysplastic syndrome',
  'Myeloma',
  'Myeloproliferative neoplasm',
];

const DIFFICULTY_LEVELS = [
  'Specialist level',
  'Disease expert level',
  'Highly complex',
];

const PROFESSIONAL_ROLES = [
  'Specialist / Attending',
  'Senior Specialist / Consultant',
  'Professor / Department Head',
  'Other',
];

// Blueprint example texts for dropdown reference
const EXAMPLES = {
  cp1: `A 67-year-old male presents to the emergency department with a two-week history of progressive fatigue, increasing dyspnea on exertion, and easy bruising. He also reports intermittent low-grade fevers and occasional gingival bleeding. His past medical history is notable for well-controlled hypertension and type 2 diabetes mellitus treated with metformin, as well as mild chronic kidney disease with a baseline estimated glomerular filtration rate of approximately 55 mL/min. He is functionally independent and has an ECOG performance status of 1.\n\nOn physical examination, the patient appears pale and fatigued. There are scattered petechiae over the lower extremities, and mild hepatosplenomegaly is noted. No significant lymphadenopathy is present.\n\nInitial laboratory studies reveal a hemoglobin of 7.8 g/dL, leukocytosis of 42,000/µL with circulating blasts suspected on peripheral smear, and thrombocytopenia of 38,000/µL. Lactate dehydrogenase is elevated, and uric acid is increased. C-reactive protein is mildly elevated. Renal function is stable compared to baseline with a creatinine of 1.4 mg/dL. Peripheral blood smear demonstrates approximately 35% myeloblasts with Auer rods.`,
  cp2: `Bone marrow examination subsequently demonstrates a hypercellular marrow with approximately 85% blasts. Flow cytometry reveals an immunophenotype characterized by CD34, CD117, CD13, CD33, and myeloperoxidase positivity, with HLA-DR expression. Cytogenetic analysis demonstrates a normal karyotype. Molecular testing identifies a nucleophosmin 1 (NPM1) mutation with a low allelic ratio FLT3-ITD mutation.`,
  cp3diagnosis: `The correct final diagnosis is acute myeloid leukemia (AML).`,
  cp4: `Bone marrow aspirate following one cycle of induction shows 0.2% blasts. During the neutropenic phase, the patient develops a fever of 39.2°C accompanied by hypotension with a blood pressure of 100/60 mmHg and hypoxia requiring oxygen insufflation of 2 l/min. Laboratory testing reveals profound neutropenia at 0.04 GPt/l, elevated inflammatory markers including a C-reactive protein at 212 mg/l and procalcitonin of 2.6 µg/ml. Blood cultures have been obtained but are still pending. A computed tomography scan of the chest shows bilateral pulmonary infiltrates without clear evidence of cavitation or established fungal disease.`,
};

type FormData = {
  // Section 1
  full_name: string;
  affiliation: string;
  email: string;
  professional_role: string;
  professional_role_other: string;
  // Section 2
  case_title: string;
  disease_category: string;
  difficulty_level: string;
  // Section 3
  vignette_cp1: string;
  // Section 4
  vignette_cp2: string;
  // Section 5
  vignette_cp3_diagnosis: string;
  vignette_cp3_other: string;
  // Section 6
  vignette_cp4: string;
};

const empty: FormData = {
  full_name: '', affiliation: '', email: '', professional_role: '', professional_role_other: '',
  case_title: '', disease_category: '', difficulty_level: '',
  vignette_cp1: '', vignette_cp2: '',
  vignette_cp3_diagnosis: '', vignette_cp3_other: '',
  vignette_cp4: '',
};

function ExampleDropdown({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        className="btn btn-secondary btn-small"
        onClick={() => setOpen(o => !o)}
        style={{ marginBottom: open ? 8 : 0 }}
      >
        {open ? 'Hide example' : 'Show blueprint example'}
      </button>
      {open && (
        <div className="notice" style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>
          {text}
        </div>
      )}
    </div>
  );
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="field-label">
      <strong>{label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}</strong>
      {hint && <span className="small" style={{ display: 'block', marginBottom: 4 }}>{hint}</span>}
      {children}
    </label>
  );
}

function RadioGroup({ options, value, onChange }: {
  options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {options.map(o => (
        <label key={o} className="check">
          <input
            type="radio"
            name={o}
            checked={value === o}
            onChange={() => onChange(o)}
          />
          {o}
        </label>
      ))}
    </div>
  );
}

export default function CaseSubmissionPage() {
  const [form, setForm] = useState<FormData>(empty);
  const [step, setStep] = useState(1); // 1–7
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  function set(key: keyof FormData, value: string) {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: '' }));
  }

  function validateStep(s: number): boolean {
    const errs: Partial<Record<keyof FormData, string>> = {};
    if (s === 1) {
      if (!form.full_name.trim()) errs.full_name = 'Required';
      if (!form.affiliation.trim()) errs.affiliation = 'Required';
      if (!form.email.trim()) errs.email = 'Required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email address';
      if (!form.professional_role) errs.professional_role = 'Required';
      if (form.professional_role === 'Other' && !form.professional_role_other.trim())
        errs.professional_role_other = 'Please specify your role';
    }
    if (s === 2) {
      if (!form.case_title.trim()) errs.case_title = 'Required';
      if (!form.disease_category) errs.disease_category = 'Required';
      if (!form.difficulty_level) errs.difficulty_level = 'Required';
    }
    if (s === 3 && !form.vignette_cp1.trim()) errs.vignette_cp1 = 'Required';
    if (s === 4 && !form.vignette_cp2.trim()) errs.vignette_cp2 = 'Required';
    if (s === 5 && !form.vignette_cp3_diagnosis.trim()) errs.vignette_cp3_diagnosis = 'Required';
    if (s === 6 && !form.vignette_cp4.trim()) errs.vignette_cp4 = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function next() {
    if (validateStep(step)) setStep(s => s + 1);
  }
  function back() { setStep(s => s - 1); }

  async function submit() {
    if (!validateStep(6)) return;
    setSubmitting(true);

    // Build the combined cp3 vignette
    const vignette_cp3 = [
      form.vignette_cp3_diagnosis.trim(),
      form.vignette_cp3_other.trim()
    ].filter(Boolean).join('\n\n');

    // Generate a case code from the title + timestamp
    const slug = form.case_title
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .slice(0, 30);
    const case_code = `CASE_${slug}_${Date.now().toString(36).toUpperCase()}`;

    const { error } = await supabase.from('cases').insert({
      case_code,
      title: form.case_title.trim(),
      disease_category: form.disease_category,
      difficulty_level: form.difficulty_level,
      vignette_cp1: form.vignette_cp1.trim(),
      vignette_cp2: form.vignette_cp2.trim(),
      vignette_cp3: vignette_cp3,
      vignette_cp4: form.vignette_cp4.trim(),
      // Store contributor info in reference_standard field as metadata
      reference_standard: {
        contributor: {
          full_name: form.full_name.trim(),
          affiliation: form.affiliation.trim(),
          email: form.email.trim(),
          professional_role: form.professional_role === 'Other'
            ? form.professional_role_other.trim()
            : form.professional_role,
        }
      },
    });

    setSubmitting(false);
    if (error) { alert('Submission failed: ' + error.message); return; }
    setSubmitted(true);
    setStep(7);
  }

  function downloadSubmission() {
    const payload = {
      submitted_at: new Date().toISOString(),
      contributor: {
        full_name: form.full_name,
        affiliation: form.affiliation,
        email: form.email,
        professional_role: form.professional_role === 'Other' ? form.professional_role_other : form.professional_role,
      },
      case_title: form.case_title,
      disease_category: form.disease_category,
      difficulty_level: form.difficulty_level,
      checkpoint_1_presentation: form.vignette_cp1,
      checkpoint_2_diagnostics: form.vignette_cp2,
      checkpoint_3_diagnosis: form.vignette_cp3_diagnosis,
      checkpoint_3_other: form.vignette_cp3_other,
      checkpoint_4_followup: form.vignette_cp4,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clineval_case_${form.case_title.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (submitted) {
    return (
      <main className="container">
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h1>Your case has been successfully submitted.</h1>
          <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 15 }}>
            Thank you for your contribution, <strong>{form.full_name}</strong>.<br />
            Your case will be reviewed by the study team. You may be contacted for clarification.
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 24, gap: 12 }}>
            <button className="btn btn-primary" onClick={downloadSubmission}>
              Download my submission
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => { setForm(empty); setStep(1); setSubmitted(false); }}
            >
              Submit another case
            </button>
          </div>
        </div>
        <div className="card" style={{ background: '#f9f8f5' }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>What happens next?</h2>
          <ol style={{ paddingLeft: 20, lineHeight: 2, color: 'var(--muted)', fontSize: 15 }}>
            <li>The study team reviews your case for completeness and anonymisation.</li>
            <li>Your case is assigned to expert reviewers for evaluation.</li>
            <li>You will be contacted if any clarification is needed.</li>
            <li>Contributing authors will be acknowledged in the final publication.</li>
          </ol>
        </div>
      </main>
    );
  }

  const totalSteps = 6;
  const progressPercent = ((step - 1) / totalSteps) * 100;

  return (
    <main className="container">
      {/* Progress header */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h1 style={{ margin: 0 }}>Case Submission</h1>
          <span className="small">Section {step} of {totalSteps}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="progress-meta" style={{ marginTop: 8 }}>
          {[
            'Contributor', 'Case Metadata',
            'CP1: Presentation', 'CP2: Diagnostics',
            'CP3: Treatment', 'CP4: Complication'
          ].map((label, i) => (
            <span key={i} style={{
              background: step === i + 1 ? 'var(--accent)' : step > i + 1 ? 'var(--accent-light)' : '#f1eee8',
              color: step === i + 1 ? 'white' : step > i + 1 ? 'var(--accent)' : 'var(--muted)',
              fontWeight: step === i + 1 ? 600 : 400,
            }}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Section 1 – Contributor Information */}
      {step === 1 && (
        <div className="card">
          <h2>Section 1 – Contributor Information</h2>
          <Field label="Full name (as it should appear in a publication)" required>
            <input
              className="input"
              value={form.full_name}
              onChange={e => set('full_name', e.target.value)}
              placeholder="e.g. Prof. Dr. Maria Schmidt"
            />
            {errors.full_name && <span className="small" style={{ color: 'var(--danger)' }}>{errors.full_name}</span>}
          </Field>
          <Field label="Institutional affiliation(s)" required>
            <input
              className="input"
              value={form.affiliation}
              onChange={e => set('affiliation', e.target.value)}
              placeholder="e.g. University Hospital Frankfurt, Department of Hematology"
            />
            {errors.affiliation && <span className="small" style={{ color: 'var(--danger)' }}>{errors.affiliation}</span>}
          </Field>
          <Field label="Email address" required>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="e.g. m.schmidt@uniklinik-frankfurt.de"
            />
            {errors.email && <span className="small" style={{ color: 'var(--danger)' }}>{errors.email}</span>}
          </Field>
          <Field label="Professional role" required>
            <RadioGroup
              options={PROFESSIONAL_ROLES}
              value={form.professional_role}
              onChange={v => set('professional_role', v)}
            />
            {form.professional_role === 'Other' && (
              <input
                className="input"
                style={{ marginTop: 8 }}
                value={form.professional_role_other}
                onChange={e => set('professional_role_other', e.target.value)}
                placeholder="Please specify your role"
              />
            )}
            {errors.professional_role && <span className="small" style={{ color: 'var(--danger)' }}>{errors.professional_role}</span>}
            {errors.professional_role_other && <span className="small" style={{ color: 'var(--danger)' }}>{errors.professional_role_other}</span>}
          </Field>
        </div>
      )}

      {/* Section 2 – Case Metadata */}
      {step === 2 && (
        <div className="card">
          <h2>Section 2 – Case Metadata</h2>
          <Field
            label="Case title"
            required
            hint="The title will not be forwarded to the model — it is used for internal identification only."
          >
            <input
              className="input"
              value={form.case_title}
              onChange={e => set('case_title', e.target.value)}
              placeholder='e.g. "AML with mutated NPM1 and FLT3-ITD with neutropenic fever during induction"'
            />
            {errors.case_title && <span className="small" style={{ color: 'var(--danger)' }}>{errors.case_title}</span>}
          </Field>
          <Field label="Disease category" required>
            <select
              className="input"
              value={form.disease_category}
              onChange={e => set('disease_category', e.target.value)}
            >
              <option value="">Select category</option>
              {DISEASE_CATEGORIES.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            {errors.disease_category && <span className="small" style={{ color: 'var(--danger)' }}>{errors.disease_category}</span>}
          </Field>
          <Field label="Difficulty level" required>
            <RadioGroup
              options={DIFFICULTY_LEVELS}
              value={form.difficulty_level}
              onChange={v => set('difficulty_level', v)}
            />
            {errors.difficulty_level && <span className="small" style={{ color: 'var(--danger)' }}>{errors.difficulty_level}</span>}
            <div className="notice" style={{ marginTop: 12, fontSize: 13 }}>
              <strong>Specialist level</strong> — solvable by any board-certified hematologist<br />
              <strong>Disease expert level</strong> — requires niche knowledge, likely only solvable by a disease expert<br />
              <strong>Highly complex</strong> — requires in-depth knowledge of the disease or subtype, or involves a very challenging clinical scenario
            </div>
          </Field>
        </div>
      )}

      {/* Section 3 – Checkpoint 1 */}
      {step === 3 && (
        <div className="card">
          <h2>Section 3 – Checkpoint 1: Initial Presentation</h2>
          <div className="warning" style={{ marginBottom: 16 }}>
            At this stage, the LLM will be asked to recommend further diagnostic steps based on the information you provide.
          </div>
          <Field
            label="Initial clinical presentation"
            required
            hint="Include: age and sex, relevant comorbidities, ECOG performance status, presenting symptoms, physical examination findings, initial laboratory results, imaging findings (if available), current medications (if relevant)."
          >
            <ExampleDropdown text={EXAMPLES.cp1} />
            <textarea
              className="input"
              style={{ minHeight: 220 }}
              value={form.vignette_cp1}
              onChange={e => set('vignette_cp1', e.target.value)}
              placeholder="Describe the patient's initial presentation..."
            />
            {errors.vignette_cp1 && <span className="small" style={{ color: 'var(--danger)' }}>{errors.vignette_cp1}</span>}
          </Field>
        </div>
      )}

      {/* Section 4 – Checkpoint 2 */}
      {step === 4 && (
        <div className="card">
          <h2>Section 4 – Checkpoint 2: Diagnostic Confirmation</h2>
          <div className="warning" style={{ marginBottom: 16 }}>
            The LLM will be asked to provide a ranked differential diagnosis. Please provide diagnostic results that lead toward — but do not state — the final diagnosis.
          </div>
          <Field
            label="Diagnostic results"
            required
            hint="Include: bone marrow aspirate (if available), pathology, cytogenetics / molecular findings, staging imaging results, other key diagnostics."
          >
            <ExampleDropdown text={EXAMPLES.cp2} />
            <textarea
              className="input"
              style={{ minHeight: 180 }}
              value={form.vignette_cp2}
              onChange={e => set('vignette_cp2', e.target.value)}
              placeholder="Describe the diagnostic results..."
            />
            {errors.vignette_cp2 && <span className="small" style={{ color: 'var(--danger)' }}>{errors.vignette_cp2}</span>}
          </Field>
        </div>
      )}

      {/* Section 5 – Checkpoint 3 */}
      {step === 5 && (
        <div className="card">
          <h2>Section 5 – Checkpoint 3: Treatment-Relevant Data</h2>
          <div className="warning" style={{ marginBottom: 16 }}>
            The LLM will now be asked to select the most appropriate treatment and justify the choice. Provide the correct final diagnosis and any additional treatment-relevant information not already given.
          </div>
          <Field label="Correct final diagnosis" required>
            <ExampleDropdown text={EXAMPLES.cp3diagnosis} />
            <textarea
              className="input"
              style={{ minHeight: 80 }}
              value={form.vignette_cp3_diagnosis}
              onChange={e => set('vignette_cp3_diagnosis', e.target.value)}
              placeholder='e.g. "The correct final diagnosis is acute myeloid leukemia (AML) with NPM1 mutation and FLT3-ITD."'
            />
            {errors.vignette_cp3_diagnosis && <span className="small" style={{ color: 'var(--danger)' }}>{errors.vignette_cp3_diagnosis}</span>}
          </Field>
          <Field
            label="Other treatment-relevant findings (optional)"
            hint="Include if applicable and not already provided: organ function (renal, hepatic, cardiac), contraindications, prior therapies, frailty / ECOG updates, biomarkers / mutations."
          >
            <textarea
              className="input"
              style={{ minHeight: 120 }}
              value={form.vignette_cp3_other}
              onChange={e => set('vignette_cp3_other', e.target.value)}
              placeholder="Leave blank if all relevant information has already been provided in checkpoints 1 and 2."
            />
          </Field>
        </div>
      )}

      {/* Section 6 – Checkpoint 4 */}
      {step === 6 && (
        <div className="card">
          <h2>Section 6 – Checkpoint 4: Complication / Relapse</h2>
          <div className="warning" style={{ marginBottom: 16 }}>
            The LLM will be asked to identify the complication or relapse and recommend a management strategy. Avoid combining multiple unrelated complications.
          </div>
          <Field
            label="Follow-up clinical course"
            required
            hint="Include: timeline, new symptoms and clinical findings, laboratory changes, imaging findings (if applicable)."
          >
            <ExampleDropdown text={EXAMPLES.cp4} />
            <textarea
              className="input"
              style={{ minHeight: 200 }}
              value={form.vignette_cp4}
              onChange={e => set('vignette_cp4', e.target.value)}
              placeholder="Describe the follow-up clinical course and complication or relapse..."
            />
            {errors.vignette_cp4 && <span className="small" style={{ color: 'var(--danger)' }}>{errors.vignette_cp4}</span>}
          </Field>
        </div>
      )}

      {/* Navigation */}
      <div className="card">
        <div className="row nav-row">
          {step > 1 ? (
            <button className="btn btn-secondary" onClick={back}>Back</button>
          ) : (
            <div />
          )}
          {step < totalSteps ? (
            <button className="btn btn-primary" onClick={next}>Continue</button>
          ) : (
            <button className="btn btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit case'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
