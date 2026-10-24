import { htmlToText } from "../tools/tavily";
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertGpa, cefrOf, englishStatus, missingCriticalFacts, profileFacts } from "./profile";
import { rateChance, tierOf } from "./chance";
import { shortlist } from "./ranking";
import { checkIsee, equivalenceScale, estimateIsee } from "./isee";
import { calendarRisks, planBackwards } from "./timeline";
import { agencyFee, summariseClientCosts } from "./costs";
import { stripDataKeyTags } from "../report/label";
import { acceptanceEstimate } from "./chance";
import { assertNoPii, findPii, redactPii } from "./pii";
import { extractClaims } from "./claims";
import { isOfficialUrl, quoteInPage } from "./evidence";
import { checkReport, REQUIRED_SECTIONS } from "./report-checks";
import { checkTranslation } from "./translation-checks";
import type { ChanceFeatures, ClientProfile } from "../agents/types";

const cert = (test: ClientProfile["languageCerts"][number]["test"], overall: number, planned = false) => ({
  test,
  overall,
  minSkill: null,
  date: null,
  planned,
});

const profile: ClientProfile = {
  displayName: "Sara M.",
  targetLevel: "master",
  targetFields: ["Civil Engineering"],
  intake: "2027/28",
  education: [
    { level: "high_school", field: "Math", institution: null, country: "Iran", graduationYear: 2018, gpa: 18, gpaScale: 20, gpaMinPass: 10, schoolingYears: 12, completed: true },
    { level: "bachelor", field: "Civil Engineering", institution: "Univ. of Tabriz", country: "Iran", graduationYear: 2023, gpa: 16.5, gpaScale: 20, gpaMinPass: 10, schoolingYears: 16, completed: true },
  ],
  languageCerts: [cert("IELTS", 6.5)],
  italianLevel: "none",
  workExperience: [],
  publications: 0,
  skills: [],
  birthYear: 2000,
  budgetEurPerYear: null,
  family: { householdSize: 4, annualIncomeToman: null, assetsToman: null },
  preferences: { cities: ["Turin"], regions: [], languageOfInstruction: "english" },
  missing: [],
};

const features = (o: Partial<ChanceFeatures> = {}): ChanceFeatures => ({
  fieldMatch: "exact",
  gpaRequirement30: null,
  languageStatus: "met",
  entranceTest: "none",
  competitiveness: "medium",
  nonEuQuota: "unknown",
  prerequisites: "met",
  rationale: "",
  ...o,
});

test("GPA conversion: Iranian /20 → Italian /30, /110, German", () => {
  const g = convertGpa(16.5, 20);
  assert.equal(g.italian30, 25.8);
  assert.equal(g.italian110, 95);
  assert.equal(g.germanGrade, 2.1);
  assert.equal(convertGpa(20).italian30, 30);
  assert.equal(convertGpa(10).italian30, 18);
});

test("language: CEFR and embassy minimums", () => {
  assert.equal(cefrOf(cert("IELTS", 6.5)), "B2");
  assert.equal(cefrOf(cert("TOEFL_iBT", 96)), "C1");
  assert.equal(englishStatus([cert("IELTS", 5.5)]).meetsEmbassyMinimum, false);
  assert.equal(englishStatus([cert("TOEFL_iBT", 78)]).meetsEmbassyMinimum, true);
  assert.equal(englishStatus([cert("IELTS", 7, true)]).meetsEmbassyMinimum, false, "planned tests don't count");
});

test("profile facts pick the qualifying degree and flag gaps", () => {
  const f = profileFacts(profile);
  assert.equal(f.qualifyingDegree?.level, "bachelor");
  assert.equal(f.gpa?.italian30, 25.8);
  assert.equal(f.issues.length, 0);
  const noLang = { ...profile, languageCerts: [], italianLevel: "none" as const };
  assert.ok(profileFacts(noLang).issues.some((i) => i.includes("embassy minimum")));
  assert.deepEqual(missingCriticalFacts(noLang), ["language status (test score or plan)"]);
});

test("chance rubric: explainable score, tiers and caps", () => {
  const good = rateChance("a", features(), 25.8);
  assert.equal(good.score, 50 + 15 + 8 + 10 + 5);
  assert.equal(good.tier, "High");
  const weak = rateChance("b", features({ fieldMatch: "weak", competitiveness: "low" }), 29);
  assert.ok(weak.score <= 45, "weak field match is capped at Reach");
  assert.equal(rateChance("c", features({ gpaRequirement30: 27 }), 24).tier, "Medium");
  assert.equal(tierOf(29), "Unlikely");
});

test("shortlist drops Unlikely, caps Reach and per-university count", () => {
  const cands = ["a", "b", "c", "d", "e"].map((id, i) => ({
    id,
    university: i < 3 ? "PoliTo" : `Uni ${id}`,
    city: "Turin",
    region: "Piemonte",
    programArea: "x",
    programName: null,
    language: "english" as const,
    whyFit: "",
    sourceChunkIds: [],
    needsWebCheck: false,
  }));
  const ratings = [
    rateChance("a", features(), 28),
    rateChance("b", features(), 27),
    rateChance("c", features(), 26),
    rateChance("d", features({ languageStatus: "close", competitiveness: "very_high" }), 23), // 45 → Reach
    rateChance("e", features({ fieldMatch: "weak", prerequisites: "missing", competitiveness: "very_high" }), 20),
  ];
  const { selected, dropped } = shortlist(cands, ratings, profile.preferences);
  assert.deepEqual(selected.map((s) => s.candidate.id), ["a", "b", "d"]);
  assert.ok(dropped.some((d) => d.candidate.id === "c" && d.reason.includes("already 2")));
  assert.ok(dropped.some((d) => d.candidate.id === "e" && d.reason.startsWith("Unlikely")));
});

test("ISEE estimate and eligibility", () => {
  assert.equal(equivalenceScale(4), 2.46);
  assert.equal(equivalenceScale(7), 3.55);
  const est = estimateIsee(12000, 40000, 4); // (12000 + 8000) / 2.46
  assert.equal(est.isee, 8130.08);
  assert.equal(checkIsee(est, { iseeMax: 24000, ispeMax: 50000 }).verdict, "eligible");
  assert.equal(checkIsee({ isee: 23000, ispe: 1000 }, { iseeMax: 24000, ispeMax: 50000 }).verdict, "borderline");
  assert.equal(checkIsee({ isee: 25000, ispe: 1000 }, { iseeMax: 24000, ispeMax: null }).verdict, "ineligible");
  assert.equal(checkIsee(null, { iseeMax: 24000, ispeMax: null }).verdict, "unknown");
});

test("timeline: backward planning and calendar risks", () => {
  const plan = planBackwards("2027-09-04", [{ task: "CIMEA", leadDays: 90 }], "2026-10-23");
  assert.equal(plan[0].startBy, "2027-06-06");
  assert.equal(plan[0].late, false);
  const risks = calendarRisks({ dsuDeadline: "2027-08-28", enrolmentDeadline: "2027-10-30", today: "2026-10-23" });
  assert.equal(risks.length, 1);
  assert.match(risks[0], /before enrolment closes/);
  assert.match(calendarRisks({ dsuDeadline: "2026-09-04", today: "2026-10-23" })[0], /already passed/);
});

test("costs: separate blocks, staged fee, tariff sense-check", () => {
  const s = summariseClientCosts([
    { label: "translations", side: "iran", currency: "TOMAN", min: 3_000_000, max: 6_000_000, kind: "cost", reliability: "estimate", source: "costs.md", needsLiveCheck: true },
    { label: "CIMEA", side: "italy", currency: "EUR", min: 150, max: 300, kind: "cost", reliability: "variable", source: "costs.md", needsLiveCheck: false },
    { label: "proof of funds", side: "italy", currency: "EUR", min: 10179.85, max: 10179.85, kind: "cash_flow", reliability: "fixed", source: "embassy", needsLiveCheck: true },
  ]);
  assert.deepEqual(s.iranCostsToman, { min: 3_000_000, max: 6_000_000 });
  assert.deepEqual(s.italyCostsEur, { min: 150, max: 300 });
  assert.equal(s.cashFlowEur.min, 10179.85, "proof of funds is cash flow, not a cost");
  assert.deepEqual(s.needsLiveCheck, ["translations", "proof of funds"]);

  const fee = agencyFee(
    { lines: [{ service: "University application package", bandMin: 800, bandMax: 1200 }], upliftReasons: ["no Italian certificate"], addOns: [] },
    ["Turin"],
  );
  assert.equal(fee.total, 900);
  assert.deepEqual(fee.stages.map((s) => s.eur), [270, 360, 270]);
  const odd = agencyFee({ lines: [{ service: "pkg", bandMin: 1150, bandMax: 1150 }], upliftReasons: [], addOns: [] }, ["Turin"]);
  assert.deepEqual(odd.stages.map((s) => s.eur), [345, 460, 345]);
  assert.equal(fee.tariffCeiling, 1228);
  assert.equal(fee.aboveTariffCeiling, false);
});

test("PII: finds IDs and phones, allows official emails, blocks queries", () => {
  const kinds = findPii("ID 0012345678, mob 09121234567, mail sara@gmail.com, office iran@uni-italia.it").map((p) => p.kind);
  assert.deepEqual(kinds, ["national ID", "mobile number", "email address"]);
  assert.equal(findPii("ISEE €28,339.88 and 10,179.85 EUR").length, 0);
  assert.throws(() => assertNoPii("Politecnico Torino Sara Mohammadi", ["Sara Mohammadi"]));
  assert.doesNotThrow(() => assertNoPii("EDISU Piemonte bando 2027/28 deadline"));
});

test("claims: detects facts and citations", () => {
  const md = [
    "## 5. Scholarship guide",
    "- EDISU closes 4 September 2027 (KB: piedmont#3)",
    "- ISEE ceiling €26,306.25",
    "- IELTS 6.5 is required [notice](https://www.polito.it/en/x)",
    "- Bring your passport.",
    "## 11. Sources",
    "- 30 September 2026 snapshot",
  ].join("\n");
  const c = extractClaims(md);
  assert.equal(c.length, 3);
  assert.deepEqual(c.map((x) => x.cited), [true, false, true]);
  assert.deepEqual(c[2].kinds, ["score"]);
});

test("evidence: official URLs and quote matching", () => {
  assert.ok(isOfficialUrl("https://www.edisu.piemonte.it/en/bando"));
  assert.ok(isOfficialUrl("https://www.polimi.it/en/international"));
  assert.ok(isOfficialUrl("ambteheran.esteri.it/en/servizi"));
  assert.ok(isOfficialUrl("https://www.unipd.it/en/"));
  assert.ok(!isOfficialUrl("https://www.tesify.it/borse"));
  assert.ok(!isOfficialUrl("https://example.com/unipd"));
  assert.ok(!isOfficialUrl("https://www.unicredit.it/studenti"));
  assert.ok(isOfficialUrl("https://www.esu.pd.it/bando"));
  const page = "The call closes on 4 September 2027 at 12:00 noon (Italian time).";
  assert.ok(quoteInPage("closes on 4 September 2027 at 12:00 noon", page));
  assert.ok(!quoteInPage("closes on 5 September 2027 at 12:00 noon", page));
  assert.ok(!quoteInPage("4 September", page), "too short to prove anything");
});

test("report checks: sections, promises, citations, blended costs", () => {
  const full = REQUIRED_SECTIONS.map((s, i) => `## ${i + 1}. ${s}\ntext`).join("\n");
  assert.equal(checkReport(full).pass, true);
  // "Sources" and "Client snapshot" are not checked for facts, so put the bad line in a normal section
  const bad = full.replace("## 2. Executive recommendation\ntext", "## 2. Executive recommendation\nWe guarantee admission. Deadline 4 Sep 2027.");
  const rules = checkReport(bad).failures.map((f) => f.rule);
  assert.ok(rules.includes("promise"));
  assert.ok(rules.includes("uncited-fact"));
  assert.equal(checkReport(full + "\nWe cannot guarantee admission.\n").pass, true, "negated promise is fine");
  const blended = full.replace("## 7. Cost of the whole process\ntext", "## 7. Cost of the whole process\nGrand total including our service fee: €5,000 (KB: costs#1)");
  assert.ok(checkReport(blended).failures.some((f) => f.rule === "blended-costs"));
});

test("translation checks", () => {
  const en = "## 1. A\nDeadline 4 September 2027, ISEE €26,306.25 at Politecnico di Torino\n## 2. B\nx";
  const good = "## ۱. الف\nمهلت ۴ سپتامبر ۲۰۲۷، سقف ISEE €26,306.25 در Politecnico di Torino برای دانشجویان\n## ۲. ب\nمتن فارسی";
  assert.equal(checkTranslation(en, good, ["Politecnico di Torino"]).pass, true);
  const bad = "## ۱. الف\nمهلت سپتامبر در پلی‌تکنیک تورین\n## ۲. ب\nمتن";
  const f = checkTranslation(en, bad, ["Politecnico di Torino"]).failures.join(" | ");
  assert.match(f, /numbers missing/);
  assert.match(f, /proper nouns/);
});

test("approval gate: Manager can't approve unbacked or unlabelled facts", async () => {
  const { approvalGate } = await import("./gates");
  const claims = extractClaims(
    "## 4. Scholarship guide\n- EDISU closes 4 September 2027 [EDISU](https://www.edisu.piemonte.it/x)\n- ISEE ceiling €26,306.25, expected for 2027/28 (KB: piedmont#3)",
  );
  const ev = (o: object) => ({
    id: "x", runId: "r", claimId: "a", claim: "", kbValue: null, liveValue: "4 Sep 2027", url: "https://www.edisu.piemonte.it/x",
    quote: "q", status: "verified" as const, academicYear: "2027/28", quoteMatched: true, officialUrl: true, pageHash: null,
    checkedBy: "verifier" as const, fetchedAt: null, ...o,
  });
  const decision = (evidenceIds: string[]) => ({
    verdict: "approve" as const,
    writingScore: 90,
    claimAudit: [{ claimId: claims[0].id, status: "verified" as const, evidenceIds, note: "" }],
    reworkOrders: [],
    blockReason: null,
  });
  const base = { claims, hardFailures: [], threshold: 85 };
  assert.equal(approvalGate({ ...base, decision: decision(["E1"]), evidenceById: new Map([["E1", ev({})]]) }).approved, true);
  const fake = approvalGate({ ...base, decision: decision(["E1"]), evidenceById: new Map([["E1", ev({ quoteMatched: false })]]) });
  assert.equal(fake.approved, false, "a quote that isn't on the page is not evidence");
  assert.match(fake.reasons[0], /unverified and unlabelled/);
  assert.equal(approvalGate({ ...base, decision: { ...decision(["E1"]), writingScore: 70 }, evidenceById: new Map([["E1", ev({})]]) }).approved, false);
});

test("default intake", async () => {
  const { defaultIntake } = await import("../agents/orchestrator");
  assert.equal(defaultIntake("2026-10-23"), "2027/28");
  assert.equal(defaultIntake("2027-02-10"), "2027/28");
  assert.equal(defaultIntake("2027-05-01"), "2028/29");
});

test("claims: computed blocks and client snapshot are skipped; bracket citations accepted", () => {
  const md = [
    "## 1. Client snapshot",
    "- GPA 16.1/20, IELTS 6.5",
    "## 3. Recommended universities",
    "<!-- computed -->",
    "| 1 | PoliTo | **High** (88/100) | GPA 25.3/30 |",
    "<!-- /computed -->",
    "- Submit by 4 September 2027 [piedmont#0, national-dsu-guide#10] (projected)",
    "- Bring IELTS 6.5 (client documents)",
    "- Pay €156 later",
  ].join("\n");
  const c = extractClaims(md);
  assert.deepEqual(c.map((x) => x.text.slice(0, 15)), ["- Submit by 4 S", "- Bring IELTS 6", "- Pay €156 late"]);
  assert.deepEqual(c.map((x) => x.cited), [true, true, false]);
});

test("gate passes client data and URL-backed lines; code labels unconfirmed facts", async () => {
  const { approvalGate } = await import("./gates");
  const { autoLabel } = await import("../report/label");
  const md = [
    "## 4. Scholarship guide",
    "- EDISU closes 4 September 2027 [EDISU](https://www.edisu.piemonte.it/bando)",
    "- Award up to €7,171.11 per year (KB: national-dsu-guide#2)",
    "| ISEE ceiling | €26,306.25 (KB: piedmont#3) |",
    "## 9. Gaps and action plan",
    "- Your IELTS 6.5 meets the minimum (client documents)",
  ].join("\n");
  const ev = {
    id: "x", runId: "r", claimId: "a", claim: "", kbValue: null, liveValue: "4 Sep 2027", url: "https://www.edisu.piemonte.it/bando",
    quote: "q", status: "verified" as const, academicYear: "2027/28", quoteMatched: true, officialUrl: true, pageHash: null,
    checkedBy: "verifier" as const, fetchedAt: null,
  };
  const evidenceById = new Map([["E1", ev]]);
  const { text, labelled } = autoLabel(md, new Set(["edisu.piemonte.it/bando"]), "2027/28");
  assert.equal(labelled, 2, "the two KB-only facts get labels; the linked and client lines don't");
  assert.match(text, /€26,306\.25 \(KB: piedmont#3\) \*\(expected — not yet confirmed on an official page for 2027\/28\)\* \|$/m);
  const decision = { verdict: "approve" as const, writingScore: 90, claimAudit: [], reworkOrders: [], blockReason: null };
  const base = { decision, evidenceById, hardFailures: [], threshold: 85 };
  assert.equal(approvalGate({ ...base, claims: extractClaims(text) }).approved, true);
  assert.equal(approvalGate({ ...base, claims: extractClaims(md) }).approved, false, "unlabelled KB facts fail");
});

test("citations with short ids and labels inside the brackets", () => {
  const md = [
    "## 4. Scholarship guide",
    "- Submit by 30 September 2027 (KB: veneto#8; projected).",
    "- ISPE ceiling €43,125.94 (KB: veneto#4, #19; expected)",
    "- Deadline 30 September 2027 (projected)",
    "- Use your IELTS 6.5 (client documents; valid until 2028)",
  ].join("\n");
  assert.deepEqual(extractClaims(md).map((c) => c.cited), [true, true, false, true]);
  assert.equal(extractClaims(md)[3].clientOnly, true);
});

test("plain official URLs count as citations; digits in URLs are not PII", () => {
  const line = "- Funds of €10,179.85 (`https://ambteheran.esteri.it/wp-content/uploads/2026/06/ENG-checklist.pdf`)";
  const [c] = extractClaims(`## 5. Application steps\n${line}`);
  assert.equal(c.cited, true);
  assert.deepEqual(c.urls, ["https://ambteheran.esteri.it/wp-content/uploads/2026/06/ENG-checklist.pdf"]);
  assert.equal(findPii("see https://www.polito.it/A.%20Y.%2020262027%20REQ.pdf").length, 0);
  assert.equal(findPii("ID 0012345678").length, 1);
});

test("cost: a client with a valid certificate pays no test fee and gets no 'no certificate' uplift", async () => {
  const { applyClientFacts } = await import("../agents/cost");
  const item = (label: string) => ({ label, side: "iran" as const, currency: "TOMAN" as const, min: 1, max: 1, kind: "cost" as const, reliability: "variable" as const, source: "costs#1", needsLiveCheck: true });
  const out = applyClientFacts(
    { clientItems: [item("IELTS exam fee"), item("Translations")], upliftReasons: ["No certificate yet in the destination's language", "Credential-recognition problems"] },
    profileFacts(profile),
  );
  assert.deepEqual(out.clientItems.map((i) => i.label), ["Translations"]);
  assert.deepEqual(out.upliftReasons, ["Credential-recognition problems"]);
  const noCert = profileFacts({ ...profile, languageCerts: [] });
  assert.equal(applyClientFacts({ clientItems: [item("IELTS exam fee")], upliftReasons: [] }, noCert).clientItems.length, 1);
});

test("data-key pseudo-citations are stripped", async () => {
  const { stripDataKeyTags } = await import("../report/label");
  assert.equal(stripDataKeyTags("Good fit (shortlist). Strong GPA (assessment)."), "Good fit. Strong GPA.");
  assert.equal(stripDataKeyTags("IELTS 6.5 (client documents)"), "IELTS 6.5 (client documents)");
});

test("client documents are redacted before reaching a model (CV formats)", () => {
  const cv = "Passport: 12345678 Phone number: (+98) 9120000000 Email address: someone@gmail.com Passport: R12345678 GPA 16.60";
  const out = redactPii(cv);
  assert.doesNotMatch(out, /12345678|9120000000|gmail/);
  assert.match(out, /GPA 16\.60/);
});

test("htmlToText keeps visible text and drops scripts, styles and tags", () => {
  const out = htmlToText("<style>x{}</style><h1>Deadline &amp; fees</h1><p>Apply by 4&nbsp;Sept &#8364;10</p><script>alert(1)</script>");
  assert.equal(out, "Deadline & fees\nApply by 4 Sept €10");
});

test("acceptance estimate: monotonic, capped, wider when facts are unknown", () => {
  const known = { fieldMatch: "exact", gpaRequirement30: 24, languageStatus: "met", entranceTest: "none", competitiveness: "medium", nonEuQuota: "ample", prerequisites: "met" } as const;
  const unknown = { ...known, gpaRequirement30: null, competitiveness: "unknown", prerequisites: "unknown" } as const;
  const at = (score: number, features: typeof known | typeof unknown) => acceptanceEstimate({ score, features: features as never });
  assert.ok(at(30, known).pct < at(50, known).pct && at(50, known).pct < at(70, known).pct);
  assert.equal(at(50, known).pct, 50);
  assert.equal(at(100, known).pct, 85, "never above 85%");
  assert.equal(acceptanceEstimate({ score: 100, features: known as never }, { programmeNamed: false }).pct, 65, "capped lower when no programme is named");
  assert.equal(at(0, known).pct, 5, "never below 5%");
  const w = (e: { low: number; high: number }) => e.high - e.low;
  assert.ok(w(at(60, unknown)) > w(at(60, known)));
});

test("a chance percentage typed in prose is a hard failure; code-rendered blocks are exempt", () => {
  const sec = (body: string) => REQUIRED_SECTIONS.map((s, i) => `## ${i + 1}. ${s}\n${i === 1 ? body : "x (client documents)."}`).join("\n\n");
  const typed = checkReport(sec("Your chance at Pisa is about 58%."));
  assert.ok(typed.failures.some((f) => f.rule === "chance-percent-in-prose"));
  const rendered = checkReport(sec("<!-- computed -->\nYour chance is about 58%.\n<!-- /computed -->\nNext step: apply."));
  assert.ok(!rendered.failures.some((f) => f.rule === "chance-percent-in-prose"));
});

test("a financial guarantee is not a promise; data-field citations become computed facts", () => {
  const sec = (body: string) => REQUIRED_SECTIONS.map((s, i) => `## ${i + 1}. ${s}\n${i === 1 ? body : "x (client documents)."}`).join("\n\n");
  assert.ok(!checkReport(sec("Entry is refused unless a financial guarantee is provided (KB: veneto#3).")).failures.some((f) => f.rule === "promise"));
  assert.ok(checkReport(sec("We guarantee your admission (KB: veneto#3).")).failures.some((f) => f.rule === "promise"));
  assert.equal(stripDataKeyTags("| CIMEA | 2027-01-24 | (KB: assessment, projected) |"), "| CIMEA | 2027-01-24 | (computed facts, projected) |");
});

test("translation check accepts a written-out date for an ISO date, and still catches changed numbers", () => {
  const en = "## 1. A\nApply by 2027-09-04 and pay €120.";
  const ok = checkTranslation(en, "## ۱. الف\nتا ۴ September 2027 درخواست دهید و €120 بپردازید.", []);
  assert.deepEqual(ok.failures.filter((f) => f.startsWith("numbers")), []);
  const bad = checkTranslation(en, "## ۱. الف\nتا ۵ September 2027 درخواست دهید و €120 بپردازید.", []);
  assert.ok(bad.failures.some((f) => f.startsWith("numbers missing")));
});

test("data-field citations without the KB prefix also become computed facts", () => {
  assert.equal(stripDataKeyTags("| CIMEA | 2027-01-24 | (assessment, expected) |"), "| CIMEA | 2027-01-24 | (computed facts, expected) |");
  assert.equal(stripDataKeyTags("text (assessment)"), "text");
});
