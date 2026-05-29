'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';

const diseaseOptions = [
  'Acute lymphoblastic leukemia',
  'Acute myeloid leukemia',
  'Aggressive lymphoma',
  'Chronic lymphoid leukemia',
  'Chronic myeloid leukemia',
  'Hodgkin’s lymphoma',
  'Indolent lymphoma',
  'Myelodysplastic syndrome',
  'Myeloma',
  'Myeloproliferative neoplasm'
];

const difficultyOptions = ['Specialist level', 'Disease expert level', 'Highly complex'];
const roleOptions = ['Specialist / Attending', 'Senior Specialist / Consultant', 'Professor / Department Head', 'Other'];

const initialForm = {
  full_name: '',
  affiliation: '',
  email: '',
  professional_role: '',
  case_code: '',
  case_title: '',
  disease_category: '',
  difficulty_level: '',
  cp1_presentation: '',
  cp2_diagnostics: '',
  cp3_final_diagnosis: '',
  cp3_treatment_relevant: '',
  cp4_follow_up: '',
  model_output_cp1: '',
  model_output_cp2: '',
  model_output_cp3: '',
  model_output_cp4: '',
  anonymized: false,
  sufficient_info: false,
  preferred_solution: false
};

type FormState = typeof initialForm;

function TextInput({ label, value, onChange, required = false, placeholder = '' }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string }) {
  return <label className="field-label"><strong>{label}{required ? ' *' : ''}</strong><input className="input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>;
}

function TextArea({ label, value, onChange, required = false, placeholder = '', rows = 5 }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string; rows?: number }) {
  return <label className="field-label"><strong>{label}{required ? ' *' : ''}</strong><textarea className="input" rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>;
}

function SelectInput({ label, value, onChange, options, required = false }: { label: string; value: string; onChange: (v: string) => void; options: string[]; required?: boolean }) {
  return <label className="field-label"><strong>{label}{required ? ' *' : ''}</strong><select className="input" value={value} onChange={e => onChange(e.target.value)}><option value="">Select...</option>{options.map(o => <option key={o} value={o}>{o}</option>)}</select></label>;
}

export default function CaseSubmissionPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function validate() {
    const required = ['full_name', 'affiliation', 'email', 'professional_role', 'case_title', 'disease_category', 'difficulty_level', 'cp1_presentation', 'cp2_diagnostics', 'cp3_final_diagnosis', 'cp4_follow_up'];
    const missing = required.filter(k => !String((form as any)[k] || '').trim());
    if (missing.length) return 'Please complete all required fields.';
    if (!form.anonymized || !form.sufficient_info || !form.preferred_solution) return 'Please confirm anonymization, sufficient information, and preferred solution.';
    return '';
  }

  async function submit() {
    const validation = validate();
    if (validation) { setMessage(validation); return; }
    setSaving(true);
    setMessage('');
    const caseCode = form.case_code.trim() || `CASE_${Date.now()}`;
    const { error } = await supabase.from('cases').insert({
      case_code: caseCode,
      title: form.case_title,
      disease_category: form.disease_category,
      difficulty_level: form.difficulty_level,
      vignette_cp1: form.cp1_presentation,
      vignette_cp2: form.cp2_diagnostics,
      vignette_cp3: `${form.cp3_final_diagnosis}\n\n${form.cp3_treatment_relevant}`.trim(),
      vignette_cp4: form.cp4_follow_up,
      model_output_cp1: form.model_output_cp1,
      model_output_cp2: form.model_output_cp2,
      model_output_cp3: form.model_output_cp3,
      model_output_cp4: form.model_output_cp4,
      reference_standard: {
        contributor: {
          full_name: form.full_name,
          affiliation: form.affiliation,
          email: form.email,
          professional_role: form.professional_role
        },
        correct_final_diagnosis: form.cp3_final_diagnosis,
        treatment_relevant_findings: form.cp3_treatment_relevant,
        confirmations: {
          anonymized: form.anonymized,
          sufficient_information: form.sufficient_info,
          preferred_solution_exists: form.preferred_solution
        }
      }
    });
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    setMessage('Your case has been successfully submitted. Thank you for your contribution!');
    setForm(initialForm);
  }

  return <main className="container">
    <div className="card">
      <h1>Case Submission Form</h1>
      <p>Submit one anonymized real-world hematology/oncology case structured across four sequential checkpoints.</p>
      <p className="small">Cases should be clinically relevant, specialist-level, solvable, and contain a clearly defined preferred solution. Do not include patient identifiers, exact dates, record numbers, hospital identifiers, or unusual personal information.</p>
      <Link href="/" className="btn btn-secondary btn-small">Back home</Link>
    </div>

    <div className="card"><h2>SECTION 1 – Contributor Information</h2><TextInput label="1. Full Name (as it should appear in a publication)" value={form.full_name} onChange={v => update('full_name', v)} required /><TextInput label="2. Institutional Affiliation(s)" value={form.affiliation} onChange={v => update('affiliation', v)} required /><TextInput label="3. Email Address" value={form.email} onChange={v => update('email', v)} required /><SelectInput label="4. Professional Role" value={form.professional_role} onChange={v => update('professional_role', v)} options={roleOptions} required /></div>

    <div className="card"><h2>SECTION 2 – Case Metadata</h2><TextInput label="Internal Case Code" value={form.case_code} onChange={v => update('case_code', v)} placeholder="Optional, e.g. CASE_002. If empty, generated automatically." /><TextInput label="5. Case Title" value={form.case_title} onChange={v => update('case_title', v)} required placeholder="e.g. AML with mutated NPM1 and FLT3-ITD with neutropenic fever" /><SelectInput label="6. Disease Category" value={form.disease_category} onChange={v => update('disease_category', v)} options={diseaseOptions} required /><SelectInput label="7. Difficulty Level" value={form.difficulty_level} onChange={v => update('difficulty_level', v)} options={difficultyOptions} required /></div>

    <div className="card"><h2>SECTION 3 – CHECKPOINT 1: INITIAL PRESENTATION</h2><p className="small">Include age and sex, relevant comorbidities, ECOG performance status, presenting symptoms, physical examination findings, initial laboratory results, imaging if available, and current medications if relevant.</p><TextArea label="8. Initial Clinical Presentation" value={form.cp1_presentation} onChange={v => update('cp1_presentation', v)} required rows={8} /><TextArea label="Model Output for CP1 – Diagnostic Workup" value={form.model_output_cp1} onChange={v => update('model_output_cp1', v)} rows={5} placeholder="Admin/study team can paste the generated blinded model output here." /></div>

    <div className="card"><h2>SECTION 4 – CHECKPOINT 2: DIAGNOSTIC CONFIRMATION</h2><p className="small">Provide diagnostic results without directly stating the final diagnosis. Include bone marrow aspirate, pathology, cytogenetics/molecular findings, staging-relevant imaging, and other key diagnostics if relevant.</p><TextArea label="9. Diagnostic Results" value={form.cp2_diagnostics} onChange={v => update('cp2_diagnostics', v)} required rows={7} /><TextArea label="Model Output for CP2 – Differential Diagnosis" value={form.model_output_cp2} onChange={v => update('model_output_cp2', v)} rows={5} placeholder="Admin/study team can paste the generated blinded model output here." /></div>

    <div className="card"><h2>SECTION 5 – CHECKPOINT 3: TREATMENT RELEVANT DATA</h2><TextArea label="10. Correct final diagnosis" value={form.cp3_final_diagnosis} onChange={v => update('cp3_final_diagnosis', v)} required rows={3} /><TextArea label="11. Other treatment relevant findings" value={form.cp3_treatment_relevant} onChange={v => update('cp3_treatment_relevant', v)} rows={5} placeholder="Organ function, contraindications, prior therapies, frailty/ECOG updates, biomarkers/mutations if applicable." /><TextArea label="Model Output for CP3 – First-Line Treatment Recommendation" value={form.model_output_cp3} onChange={v => update('model_output_cp3', v)} rows={5} placeholder="Admin/study team can paste the generated blinded model output here." /></div>

    <div className="card"><h2>SECTION 6 – CHECKPOINT 4: COMPLICATION / RELAPSE</h2><p className="small">Include timeline, new symptoms and clinical findings, laboratory changes, and imaging findings if applicable. Avoid combining multiple unrelated complications.</p><TextArea label="12. Follow-Up Clinical Course" value={form.cp4_follow_up} onChange={v => update('cp4_follow_up', v)} required rows={7} /><TextArea label="Model Output for CP4 – Complication / Relapse Management" value={form.model_output_cp4} onChange={v => update('model_output_cp4', v)} rows={5} placeholder="Admin/study team can paste the generated blinded model output here." /></div>

    <div className="card"><h2>SECTION 7 – Confirmation</h2><label className="check"><input type="checkbox" checked={form.anonymized} onChange={e => update('anonymized', e.target.checked)} /> This case is fully anonymized and contains no directly identifiable patient information.</label><label className="check"><input type="checkbox" checked={form.sufficient_info} onChange={e => update('sufficient_info', e.target.checked)} /> The information provided is sufficient for specialist interpretation at each checkpoint.</label><label className="check"><input type="checkbox" checked={form.preferred_solution} onChange={e => update('preferred_solution', e.target.checked)} /> A preferred solution/reference standard exists for this case.</label><br />{message && <p className="notice">{message}</p>}<button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Submitting...' : 'Submit case'}</button></div>
  </main>;
}
