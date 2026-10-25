import assert from "node:assert/strict";
import test from "node:test";
import { parseMurCsv, searchProgrammes, universityName, type Programme } from "./catalogue";
import { regionOfProvince } from "./regions";

const HEAD = "ANNO;Ateneo;Area;GruppoDisciplinare;TipoCorso;Classe;NomeClasse;Corso;SedeCorso_Provincia;SedeCorso_Comune;ACCESSO;DIDATTICA;LINGUA";
const row = (y: number, ateneo: string, tipo: string, classe: string, corso: string, prov: string, comune: string, acc: string, did: string, lingua: string) =>
  [y, ateneo, "A", "G", tipo, classe, "Classe " + classe, corso, prov, comune, acc, did, lingua].join(";");

test("parseMurCsv keeps only the newest year and resolves regions, languages and levels", () => {
  const csv = [
    HEAD,
    row(2024, "Padova", "Laurea Magistrale", "LM-52", "Old Programme", "Padova", "PADOVA", "accesso libero", "Convenzionale", "Inglese"),
    row(2025, "Padova", "Laurea Magistrale", "LM-52", "Human Rights", "Padova", "PADOVA", "accesso libero", "Convenzionale", "Inglese"),
    row(2025, "Messina", "Laurea Magistrale", "LM-77", "Management", "Messina", "MESSINA", "accesso libero", "Convenzionale", "Italiano - Inglese"),
    row(2025, "Estero", "Laurea", "L-1", "Abroad", "PROVINCIA ESTERA", "X", "accesso libero", "Convenzionale", "Inglese"),
  ].join("\n");
  const p = parseMurCsv(csv);
  assert.equal(p.length, 2);
  assert.deepEqual(p.map((x) => [x.university, x.region, x.language, x.level]), [
    ["Università di Padova", "Veneto", "english", "master"],
    ["Università di Messina", "Sicilia", "bilingual", "master"],
  ]);
  assert.equal(p[0].city, "Padova");
});

test("province → region and display names", () => {
  assert.equal(regionOfProvince("Forlì-Cesena"), "Emilia-Romagna");
  assert.equal(regionOfProvince("Monza e della Brianza"), "Lombardia");
  assert.equal(regionOfProvince("Nowhere"), null);
  assert.equal(universityName("Milano Politecnico"), "Politecnico di Milano");
  assert.equal(universityName("Pisa"), "Università di Pisa");
});

const prog = (o: Partial<Programme>): Programme => ({
  ateneo: "Padova", university: "Università di Padova", level: "master", classCode: "LM-52", className: "Relazioni internazionali", name: "International Relations",
  language: "english", access: "accesso libero", delivery: "Convenzionale", city: "Padova", province: "Padova", region: "Veneto", year: 2025, ...o,
});

test("searchProgrammes: filters by language, delivery and level; ranks by class and keywords; deterministic", () => {
  const all = [
    prog({}),
    prog({ university: "Università di Pisa", ateneo: "Pisa", name: "World Politics", classCode: "LM-62" }),
    prog({ university: "Università X", ateneo: "X", name: "International Relations", language: "italian" }),
    prog({ university: "Università Y telematica", ateneo: "Y telematica", name: "International Relations" }),
    prog({ university: "Università Z", ateneo: "Z", name: "International Relations", delivery: "Teledidattica" }),
    prog({ university: "Università W", ateneo: "W", name: "International Relations", level: "bachelor" }),
    prog({ university: "Università V", ateneo: "V", name: "Civil Engineering", classCode: "LM-23", className: "Ingegneria civile" }),
  ];
  const q = { level: "master" as const, classCodes: ["LM-52"], keywords: ["international relations"], language: "english" as const };
  const out = searchProgrammes(all, q).map((s) => s.programme.university);
  assert.deepEqual(out, ["Università di Padova"], "wrong language, remote, telematica, bachelor and unrelated programmes are excluded");
  const both = searchProgrammes(all, { ...q, classCodes: ["LM-52", "LM-62"], keywords: ["international relations", "world politics"] }).map((s) => s.programme.university);
  assert.deepEqual(both, ["Università di Padova", "Università di Pisa"], "both classes appear, the better-ranked class first");
  assert.deepEqual(searchProgrammes(all, q), searchProgrammes(all, q));
});

test("searchProgrammes: a class suggested by a model only counts when its programmes match the subject; results spread over classes", () => {
  const all = [
    prog({ university: "Università A", ateneo: "A", name: "Philosophical Knowledge", classCode: "LM-78", className: "Scienze filosofiche" }),
    ...["B", "C", "D"].map((n) => prog({ university: `Università ${n}`, ateneo: n, name: `International Relations ${n}`, classCode: "LM-52" })),
    ...["E", "F"].map((n) => prog({ university: `Università ${n}`, ateneo: n, name: `Global Politics and International Relations ${n}`, classCode: "LM-62" })),
  ];
  const q = { level: "master" as const, classCodes: ["LM-78"], keywords: ["international relations"], language: "english" as const, limit: 4 };
  const out = searchProgrammes(all, q).map((s) => s.programme.classCode);
  assert.ok(!out.includes("LM-78"), "a wrongly suggested class with no subject match is ignored");
  assert.ok(out.includes("LM-52") && out.includes("LM-62"), "both matching classes appear, not just the biggest one");
});

test("searchProgrammes: at most two programmes per university, none twice", () => {
  const all = ["A", "B", "C"].map((n) => prog({ name: `International Relations ${n}` }));
  assert.equal(searchProgrammes(all, { level: "master", classCodes: ["LM-52"], keywords: ["international relations"], language: "english" }).length, 2);
});
