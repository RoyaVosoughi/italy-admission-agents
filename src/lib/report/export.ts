// Saves the approved report where Roya's existing reports live
// (immigration files/clients/<client>/report-YYYY-MM-DD.md, English then full Farsi)
// and converts it with the existing tools/md-to-docx.py (handles Farsi RTL).
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export function clientsDir(): string {
  return resolve(process.env.CLIENTS_DIR ?? "../immigration files/clients");
}

export async function exportReport(clientFolder: string, en: string, fa: string, today: string) {
  const dir = join(clientsDir(), clientFolder);
  mkdirSync(dir, { recursive: true });
  let md = join(dir, `report-${today}.md`);
  for (let i = 2; existsSync(md); i++) md = join(dir, `report-${today}-${i}.md`); // never overwrite an earlier report
  writeFileSync(md, `${en}\n\n---\n\n# فارسی\n\n${fa}\n`);

  const files = [md];
  let docxError: string | undefined;
  const tool = resolve(process.env.DOCX_TOOL ?? "../immigration files/tools/md-to-docx.py");
  try {
    await run(process.env.PYTHON ?? "python", [tool, md], { timeout: 120_000 });
    files.push(md.replace(/\.md$/, ".docx"));
  } catch (e) {
    docxError = (e as Error).message.slice(0, 300); // the .md is still saved; docx can be redone by hand
  }
  return { files, docxError };
}
