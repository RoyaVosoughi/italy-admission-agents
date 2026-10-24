// Contracts between agents. One agent's output is the next one's input, so these
// schemas play the role interfaces play in ordinary code: the orchestrator can only
// wire agents together because every hand-off has a validated shape.
import { z } from "zod";

const nullableNum = z.number().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
export const Confidence = z.enum(["CONFIRMED", "PARTIAL", "GAP", "PROJECTED"]);

// ---------- 1. Intake ----------
export const Education = z.object({
  level: z.enum(["high_school", "associate", "bachelor", "master", "phd"]),
  field: z.string(),
  institution: z.string().nullable(),
  country: z.string().nullable(),
  graduationYear: nullableNum,
  gpa: nullableNum,
  gpaScale: nullableNum.describe("maximum of the scale, e.g. 20 for Iranian grades, 4 for US GPA"),
  gpaMinPass: nullableNum.describe("pass mark of the scale, e.g. 10 for Iranian grades"),
  schoolingYears: nullableNum.describe("total years of schooling up to this qualification"),
  completed: z.boolean(),
});

export const LanguageCert = z.object({
  test: z.enum(["IELTS", "TOEFL_iBT", "Duolingo", "Cambridge", "PTE", "CILS", "CELI", "PLIDA", "Other"]),
  overall: nullableNum,
  minSkill: nullableNum,
  date: isoDate.nullable(),
  planned: z.boolean().describe("true if the client only plans to take it"),
});

export const ClientProfile = z.object({
  displayName: z.string().describe("first name + last initial; never national ID or phone"),
  targetLevel: z.enum(["bachelor", "master", "phd"]),
  targetFields: z.array(z.string()).min(1),
  intake: z.string().describe('academic year, e.g. "2027/28"'),
  education: z.array(Education),
  languageCerts: z.array(LanguageCert),
  italianLevel: z.enum(["none", "A1", "A2", "B1", "B2", "C1", "C2"]),
  workExperience: z.array(z.object({ role: z.string(), organisation: z.string().nullable(), years: z.number(), relevant: z.boolean() })),
  publications: z.number().int(),
  skills: z.array(z.string()),
  birthYear: nullableNum,
  budgetEurPerYear: nullableNum,
  family: z.object({
    householdSize: nullableNum,
    annualIncomeToman: nullableNum,
    assetsToman: nullableNum,
  }),
  preferences: z.object({
    cities: z.array(z.string()),
    regions: z.array(z.string()),
    languageOfInstruction: z.enum(["english", "italian", "either"]),
  }),
  missing: z.array(z.string()).describe("critical facts not found in the documents"),
});
export type ClientProfile = z.infer<typeof ClientProfile>;

// ---------- 2. Assessor ----------
export const Assessment = z.object({
  eligibleTracks: z.array(z.object({ level: z.enum(["bachelor", "master", "phd"]), eligible: z.boolean(), reason: z.string() })),
  strengths: z.array(z.string()),
  weaknesses: z.array(
    z.object({ issue: z.string(), severity: z.enum(["high", "medium", "low"]), fix: z.string(), byWhen: z.string().nullable() }),
  ),
  redFlags: z.array(z.string()),
  degreeClasses: z.array(z.object({ code: z.string().describe("e.g. LM-23"), name: z.string() })),
  searchThemes: z.array(z.string()).min(1).describe("program areas to search for, in English"),
});
export type Assessment = z.infer<typeof Assessment>;

// ---------- 3. Scout ----------
export const Candidate = z.object({
  id: z.string(),
  university: z.string(),
  city: z.string(),
  region: z.string(),
  programArea: z.string(),
  programName: z.string().nullable(),
  language: z.enum(["english", "italian", "unknown"]),
  whyFit: z.string(),
  sourceChunkIds: z.array(z.string()),
  needsWebCheck: z.boolean().describe("true when the program itself is not described in the knowledge base"),
});
export type Candidate = z.infer<typeof Candidate>;
export const ScoutOutput = z.object({ candidates: z.array(Candidate).min(1).max(20) });

// ---------- 4. Analyst ----------
// The LLM extracts features; rules/chance.ts turns them into a score. The model
// never picks the number itself, so the rubric stays transparent and tunable.
export const ChanceFeatures = z.object({
  fieldMatch: z.enum(["exact", "related", "weak"]),
  gpaRequirement30: nullableNum.describe("minimum GPA on the Italian /30 scale if stated, else null"),
  languageStatus: z.enum(["met", "close", "missing"]),
  entranceTest: z.enum(["none", "required", "unknown"]),
  competitiveness: z.enum(["low", "medium", "high", "very_high", "unknown"]),
  nonEuQuota: z.enum(["ample", "limited", "very_limited", "unknown"]),
  prerequisites: z.enum(["met", "partial", "missing", "unknown"]),
  rationale: z.string(),
});
export type ChanceFeatures = z.infer<typeof ChanceFeatures>;

export const Tier = z.enum(["High", "Medium", "Reach", "Unlikely"]);
export type Tier = z.infer<typeof Tier>;

export interface ChanceRating {
  candidateId: string;
  features: ChanceFeatures;
  score: number;
  tier: Tier;
  factors: { factor: string; points: number }[];
  improve: string[];
}

// ---------- 5. Scholarship ----------
export const ScholarshipPlan = z.object({
  candidateId: z.string(),
  dsuBody: z.string(),
  portal: z.string().nullable(),
  // Numbers the code checks (ISEE verdict, calendar risks) — copied from the sources, not judged.
  limits: z.object({
    iseeMax: nullableNum,
    ispeMax: nullableNum,
    confidence: Confidence.nullable(),
    sourceChunkId: z.string().nullable(),
  }),
  deadlines: z.object({
    admission: isoDate.nullable().describe("program application deadline for the client's intake"),
    enrolment: isoDate.nullable(),
    dsu: isoDate.nullable(),
    dsuRequiresVisa: z.boolean(),
    confidence: Confidence.describe("PROJECTED when shifted from last year's dates"),
  }),
  amounts: z.array(z.object({ label: z.string(), eur: z.number(), confidence: Confidence })),
  steps: z.array(
    z.object({
      order: z.number().int(),
      title: z.string(),
      detail: z.string(),
      due: isoDate.nullable(),
      dueConfidence: Confidence.nullable(),
      sourceChunkIds: z.array(z.string()),
    }),
  ),
  meritAwards: z.array(z.object({ name: z.string(), value: z.string(), how: z.string(), sourceChunkIds: z.array(z.string()) })),
  risks: z.array(z.string()),
});
export type ScholarshipPlan = z.infer<typeof ScholarshipPlan>;

// ---------- 6. Costs ----------
export const CostItem = z.object({
  label: z.string(),
  side: z.enum(["iran", "italy"]),
  currency: z.enum(["TOMAN", "EUR"]),
  min: z.number(),
  max: z.number(),
  kind: z.enum(["cost", "cash_flow", "income"]),
  reliability: z.enum(["fixed", "variable", "estimate"]),
  source: z.string().describe("knowledge-base chunk id the figure comes from, e.g. costs#3"),
  needsLiveCheck: z.boolean(),
});
export type CostItem = z.infer<typeof CostItem>;

export const AgencyFeeInput = z.object({
  lines: z.array(z.object({ service: z.string(), bandMin: z.number(), bandMax: z.number() })),
  upliftReasons: z.array(z.string()),
  addOns: z.array(z.object({ service: z.string(), eur: z.string() })),
});
export type AgencyFeeInput = z.infer<typeof AgencyFeeInput>;

export const CostPlannerOutput = z.object({ clientItems: z.array(CostItem), agency: AgencyFeeInput });

// ---------- 7. Evidence ----------
export const Evidence = z.object({
  claimId: z.string(),
  claim: z.string(),
  kbValue: z.string().nullable(),
  liveValue: z.string().nullable(),
  url: z.string().nullable(),
  quote: z.string().nullable().describe("verbatim sentence copied from the official page"),
  status: z.enum(["verified", "changed", "not_found", "conflict"]),
  academicYear: z.string().nullable(),
});
export type Evidence = z.infer<typeof Evidence>;

// ---------- 9. Manager ----------
export const ReworkAgent = z.enum(["scout", "analyst", "scholarship", "cost", "verifier", "writer"]);
export const ManagerDecision = z.object({
  verdict: z.enum(["approve", "rework", "block"]),
  writingScore: z.number().min(0).max(100).describe("quality of the writing: honesty, usefulness, Iranian specifics, consistency, clarity"),
  claimAudit: z.array(
    z.object({
      claimId: z.string(),
      status: z.enum(["verified", "wrong", "unverifiable", "stale"]),
      evidenceIds: z.array(z.string()).describe("ids (E1, E2…) of the evidence that supports a 'verified' status"),
      note: z.string(),
    }),
  ),
  reworkOrders: z.array(z.object({ agent: ReworkAgent, target: z.string(), instruction: z.string() })),
  blockReason: z.string().nullable(),
});
export type ManagerDecision = z.infer<typeof ManagerDecision>;

// ---------- 12. Critic ----------
export const CriticOutput = z.object({
  lessons: z
    .array(
      z.object({
        agent: z.enum(["intake", "assessor", "scout", "analyst", "scholarship", "cost", "verifier", "writer", "manager", "translator"]),
        lesson: z.string(),
      }),
    )
    .max(3),
});
