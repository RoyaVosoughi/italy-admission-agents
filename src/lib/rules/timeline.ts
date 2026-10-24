// Backward planning from deadlines. Missed intakes almost always come from lead times
// (CIMEA, legalisation, consular income documents), not from the deadline itself, so the
// "start by" dates are computed here rather than guessed by a model.

export const LEAD_DAYS = {
  cimea: 90, // statement of comparability + verification: 1–3 months
  translationLegalisation: 21, // certified translation (~4 working days) + Justice/MFA stamps
  consularFamilyDocs: 45, // family income/asset documents legalised for the ISEE Parificato
  languageTestResult: 30, // booking + result
  visaAppointment: 30, // VisaMetric email after Universitaly validation
} as const;

const DAY = 86_400_000;
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => toIso(new Date(toDate(iso).getTime() + days * DAY));
export const daysBetween = (fromIso: string, toIsoStr: string) => Math.round((toDate(toIsoStr).getTime() - toDate(fromIso).getTime()) / DAY);

export interface PlannedTask {
  task: string;
  deadline: string;
  startBy: string;
  daysLeft: number;
  late: boolean;
}

export function planBackwards(deadline: string, tasks: { task: string; leadDays: number }[], today: string): PlannedTask[] {
  return tasks
    .map((t) => {
      const startBy = addDays(deadline, -t.leadDays);
      return { task: t.task, deadline, startBy, daysLeft: daysBetween(today, startBy), late: startBy < today };
    })
    .sort((a, b) => a.startBy.localeCompare(b.startBy));
}

/** Calendar conflicts between admission and scholarship that have cost clients a year. */
export function calendarRisks(d: {
  admissionDeadline?: string | null;
  enrolmentDeadline?: string | null;
  dsuDeadline?: string | null;
  dsuRequiresVisa?: boolean;
  visaDeadline?: string | null;
  today: string;
}): string[] {
  const risks: string[] = [];
  if (d.admissionDeadline && d.admissionDeadline < d.today) risks.push(`Admission deadline ${d.admissionDeadline} has already passed.`);
  if (d.dsuDeadline && d.dsuDeadline < d.today) risks.push(`Scholarship deadline ${d.dsuDeadline} has already passed.`);
  if (d.dsuDeadline && d.enrolmentDeadline && d.dsuDeadline < d.enrolmentDeadline) {
    risks.push(
      `The scholarship closes (${d.dsuDeadline}) before enrolment closes (${d.enrolmentDeadline}): apply for the scholarship before enrolling, don't wait.`,
    );
  }
  if (d.dsuRequiresVisa && d.dsuDeadline && d.visaDeadline && d.dsuDeadline < d.visaDeadline) {
    risks.push(
      `The scholarship requires a copy of the visa but closes (${d.dsuDeadline}) before the visa window ends (${d.visaDeadline}): the visa must be obtained early.`,
    );
  }
  if (d.dsuDeadline && d.dsuDeadline >= d.today) {
    const tooLate = planBackwards(d.dsuDeadline, [{ task: "consular family documents", leadDays: LEAD_DAYS.consularFamilyDocs }], d.today);
    if (tooLate[0].late) risks.push(`Too little time left to legalise family documents before the scholarship deadline ${d.dsuDeadline}.`);
  }
  return risks;
}
