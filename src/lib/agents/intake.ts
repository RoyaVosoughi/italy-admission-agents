// Agent 1 — Intake. Pure extraction from the resume and intake note into ClientProfile.
// Low temperature: there is nothing creative about reading a GPA off a transcript.
import { runAgentJSON } from "../ai";
import { findPii, redactPii } from "../rules/pii";
import type { ClientDocument } from "../docs/read";
import { ClientProfile } from "./types";
import type { RunContext } from "./context";

const ROLE = `
You are the intake officer. Read the client's documents (resume, intake note — often in Persian) and
extract the client profile exactly as stated. Do not guess: if a value is not in the documents, use null
(or "none"/[] where the schema requires) and add a short English description of it to "missing" when it
is critical (GPA of the qualifying degree, target degree level, language test status, field of study).

Rules:
- displayName: first name + initial of the last name only (e.g. "Sara M."). Never copy national ID
  (کد ملی), phone numbers, emails or addresses into any field.
- Iranian grades are on a 0–20 scale with pass mark 10 unless the document says otherwise.
- Old Iranian system: diploma (11 years) + Pish-Daneshgahi = 12 years of schooling; new 6-3-3 system = 12.
- If the intake year is not stated, use the intake given in the request.
- Persian text: translate field names and institutions to English.
- preferences.cities / preferences.regions: ONLY places the client or advisor says they want. An admission
  letter, offer or previous application is a fact about the past, not a preference — never copy its city or
  region into preferences (leave them empty when the client names no place).
- family.* in toman, only if the note states it (used later for the ISEE estimate).
`;

function scrub<T>(value: T): T {
  if (typeof value === "string") {
    let s: string = value;
    for (const p of findPii(s)) s = s.replace(p.match, "[removed]");
    return s as T;
  }
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)])) as T;
  }
  return value;
}

export async function runIntake(ctx: RunContext, docs: ClientDocument[], notes?: string): Promise<ClientProfile> {
  const prompt = [
    `Intake to plan for: ${ctx.intake} (today is ${ctx.today}).`,
    notes ? `Notes from the advisor:\n${redactPii(notes)}` : "",
    ...docs.map((d) => `=== Document: ${d.name} ===\n${redactPii(d.text.slice(0, 30_000))}`),
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data, usage } = await runAgentJSON(ClientProfile, {
    agent: "intake",
    role: ROLE,
    prompt,
    temperature: 0.1,
    lessons: await ctx.lessons("intake"),
  });
  ctx.addUsage(usage);
  // Belt and braces: the prompt forbids PII, the code removes any that slipped through.
  const profile = scrub(data);
  const [first, ...rest] = profile.displayName.trim().split(/\s+/);
  profile.displayName = rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
  return profile;
}
