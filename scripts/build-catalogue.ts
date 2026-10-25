// Downloads the official MUR course list (open data, public domain) and reduces it to the newest academic
// year: data/catalogue/programmes.json. Re-run once a year when MUR publishes the next file.
// Usage: npm run catalogue:build
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CATALOGUE_PATH, parseMurCsv } from "../src/lib/catalogue/catalogue";

const CSV_URL =
  "https://dati-ustat.mur.gov.it/dataset/bed0c71e-9f86-4a0f-a266-963b6f7bbbd2/resource/c0e63906-7190-4568-892b-0cf399f56071/download/03_offertaformativa-corsidilaurea_2010-2025.csv";
const RAW = "data/catalogue/mur-offerta.csv";

async function main() {
  mkdirSync(dirname(RAW), { recursive: true });
  if (!existsSync(RAW)) {
    console.log("downloading the MUR course list (about 17 MB)…");
    const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(280_000) });
    if (!res.ok) throw new Error(`MUR download failed: ${res.status}`);
    writeFileSync(RAW, Buffer.from(await res.arrayBuffer()));
  }
  // The file is Windows-1252, not UTF-8 (accented letters, curly apostrophes).
  const text = new TextDecoder("windows-1252").decode((await import("node:fs")).readFileSync(RAW));
  const programmes = parseMurCsv(text);
  writeFileSync(CATALOGUE_PATH, JSON.stringify(programmes));
  const en = programmes.filter((p) => p.level === "master" && p.language === "english" && p.delivery === "Convenzionale");
  console.log(`${programmes.length} courses for ${programmes[0]?.year}; ${en.length} English-taught in-person master's courses → ${CATALOGUE_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
