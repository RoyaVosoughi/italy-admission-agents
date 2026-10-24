// Reads client documents (resume, Obsidian intake note) into plain text for the intake agent.
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

export interface ClientDocument {
  name: string;
  text: string;
}

export async function readDocument(path: string): Promise<ClientDocument> {
  const ext = extname(path).toLowerCase();
  const buf = await readFile(path);
  let text: string;
  if (ext === ".pdf") {
    const { extractText } = await import("unpdf");
    text = (await extractText(new Uint8Array(buf), { mergePages: true })).text;
  } else if (ext === ".docx") {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if ([".md", ".txt", ""].includes(ext)) {
    text = buf.toString("utf8");
  } else {
    throw new Error(`Unsupported document type ${ext} (${basename(path)}): use PDF, DOCX, MD or TXT`);
  }
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 50) throw new Error(`${basename(path)}: almost no text extracted — is it a scanned image?`);
  return { name: basename(path), text };
}
