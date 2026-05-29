export type QuestionType = 'likert' | 'yesno' | 'harm' | 'text';

export type Question = {
  id: string;
  type: QuestionType;
  text: string;
  description?: string;
  conditional?: { question: string; value: string };
};

export const likertOptions = [
  '1 Strongly disagree',
  '2 Disagree',
  '3 Neutral / Undecided',
  '4 Agree',
  '5 Strongly agree',
  'Not applicable'
];

export const harmOptionsWithNA = [
  'Severe harm likely',
  'Minor harm possible',
  'Unclear',
  'No meaningful harm expected',
  'Not applicable'
];

export const harmOptionsNoNA = [
  'Severe harm likely',
  'Minor harm possible',
  'Unclear',
  'No meaningful harm expected'
];

export const checkpoints = [
  {
    id: 'cp1',
    title: 'CHECKPOINT 1 – Diagnostic Workup',
    shortTitle: 'Diagnostic Workup',
    instruction: 'Evaluate only the diagnostic workup recommendation. Do not consider future diagnosis, treatment, or relapse information.',
    questions: [
      { id: 'cp1q1', type: 'likert', text: '1. The recommended diagnostic workup is medically appropriate.' },
      { id: 'cp1q2', type: 'likert', text: '2. The recommended diagnostic workup sufficiently evaluates the relevant differential diagnoses.' },
      { id: 'cp1q3', type: 'likert', text: '3. The recommended diagnostic workup is consistent with current clinical guidelines.' },
      { id: 'cp1q4', type: 'yesno', text: '4. Is a crucial diagnostic test missing?' },
      { id: 'cp1q5', type: 'text', text: '5. If yes, which diagnostic test is missing?', conditional: { question: 'cp1q4', value: 'Yes' } },
      { id: 'cp1q6', type: 'harm', text: '6. If a crucial diagnostic test is missing, would omission of this test likely result in patient harm?', conditional: { question: 'cp1q4', value: 'Yes' } },
      { id: 'cp1q7', type: 'likert', text: '7. The response is helpful for clinical decision-making.' },
      { id: 'cp1q8', type: 'likert', text: '8. I would consider using this model to support diagnostic workup in clinical practice.' },
      { id: 'cp1q9', type: 'likert', text: "9. I would feel comfortable following this model's suggestions for diagnostic workup." },
      { id: 'cp1q10', type: 'text', text: '10. Additional comments.' }
    ] as Question[]
  },
  {
    id: 'cp2',
    title: 'CHECKPOINT 2 – Initial Diagnosis / Differential Diagnosis',
    shortTitle: 'Initial Diagnosis / Differential Diagnosis',
    instruction: 'Evaluate only the initial diagnosis, differential diagnosis, and reasoning. Do not consider treatment or relapse information.',
    questions: [
      { id: 'cp2q1', type: 'yesno', text: '1. Is the correct diagnosis listed as the most likely diagnosis?' },
      { id: 'cp2q2', type: 'yesno', text: '2. Is the correct diagnosis listed among the top 3 diagnoses?' },
      { id: 'cp2q3', type: 'yesno', text: '3. Is the correct diagnosis listed anywhere in the differential diagnoses?' },
      { id: 'cp2q4', type: 'likert', text: '4. The reasoning supporting the most likely diagnosis is medically sound.' },
      { id: 'cp2q5', type: 'likert', text: '5. The differential diagnoses are medically plausible and appropriately prioritized.' },
      { id: 'cp2q6', type: 'likert', text: '6. The response is helpful for clinical decision-making.' },
      { id: 'cp2q7', type: 'likert', text: '7. I would consider using this model to support differential diagnosis in clinical practice.' },
      { id: 'cp2q8', type: 'likert', text: "8. I would feel comfortable following this model's suggested diagnosis." },
      { id: 'cp2q9', type: 'text', text: '9. Additional comments.' }
    ] as Question[]
  },
  {
    id: 'cp3',
    title: 'CHECKPOINT 3 – First-Line Treatment Recommendation',
    shortTitle: 'First-Line Treatment Recommendation',
    instruction: 'Evaluate only the first-line treatment recommendation. Do not consider future complication or relapse information.',
    questions: [
      { id: 'cp3q1', type: 'likert', text: '1. The recommended treatment option is medically appropriate.' },
      { id: 'cp3q2', type: 'likert', text: '2. The recommended treatment is consistent with current clinical guidelines.' },
      { id: 'cp3q3', type: 'likert', text: '3. The recommendation appropriately considers the patient’s individual characteristics (e.g., age, comorbidities, biomarkers, performance status).' },
      { id: 'cp3q4', type: 'likert', text: '4. If multiple treatment options are presented, they are medically reasonable.' },
      { id: 'cp3q5', type: 'likert', text: '5. The recommendation is supported by appropriate evidence or guidelines.' },
      { id: 'cp3q6', type: 'text', text: '6. If the recommendation is not appropriately supported by evidence or guidelines, please provide the appropriate reference that the LLM should have cited here.', description: 'Free text. Enter “not applicable” if appropriate evidence has been provided.' },
      { id: 'cp3q7', type: 'harm', text: '7. If followed as written, how likely is this recommendation to harm the patient?' },
      { id: 'cp3q8', type: 'likert', text: '8. The response is helpful for clinical decision-making.' },
      { id: 'cp3q9', type: 'likert', text: '9. I would consider using this model to support treatment decisions in clinical practice.' },
      { id: 'cp3q10', type: 'likert', text: "10. I would feel comfortable following this model's recommendation in clinical practice." },
      { id: 'cp3q11', type: 'text', text: '11. Additional comments.' }
    ] as Question[]
  },
  {
    id: 'cp4',
    title: 'CHECKPOINT 4 – Complication / Relapse Management',
    shortTitle: 'Complication / Relapse Management',
    instruction: 'Evaluate only the complication or relapse management recommendation.',
    questions: [
      { id: 'cp4q1', type: 'likert', text: '1. The model correctly identifies the complication or relapse.' },
      { id: 'cp4q2', type: 'likert', text: '2. The suggested differential diagnoses are medically plausible and appropriately prioritized.' },
      { id: 'cp4q3', type: 'likert', text: '3. The proposed management is medically appropriate.' },
      { id: 'cp4q4', type: 'likert', text: '4. The treatment recommendation is consistent with current evidence or guidelines.' },
      { id: 'cp4q5', type: 'harm', text: '5. If followed as written, how likely is this recommendation to harm the patient?' },
      { id: 'cp4q6', type: 'likert', text: '6. The response is helpful for clinical decision-making.' },
      { id: 'cp4q7', type: 'likert', text: '7. I would consider using this model to support management of complications or relapse in clinical practice.' },
      { id: 'cp4q8', type: 'likert', text: '8. I would feel comfortable following this recommendation in clinical practice.' },
      { id: 'cp4q9', type: 'text', text: '9. Additional comments.' }
    ] as Question[]
  }
];

export function harmOptionsForQuestion(questionId: string) {
  return questionId === 'cp1q6' ? harmOptionsWithNA : harmOptionsNoNA;
}
