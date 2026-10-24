// Heading-aware chunking of the cleaned reports (kb/clean/*.en.md).
// Rules:
//   - a chunk never crosses a level-1/2 heading (different topics, different confidence)
//   - a table is always its own chunk: splitting a deadline table loses the column headers
//   - every chunk carries its region + heading path, both as metadata and as a text prefix
//     for embedding, so "Deadlines" in Lazio and "Deadlines" in Marche don't look identical
import { createHash } from "node:crypto";
import { CONFIDENCE_TAGS, type Confidence } from "./clean";
import type { DocType } from "./sources";

export interface Chunk {
  id: string;
  hash: string;
  docSlug: string;
  sourceFile: string;
  region: string | null;
  dsuBody: string | null;
  docType: DocType;
  headingPath: string[];
  confidence: Confidence[];
  urls: string[];
  isTable: boolean;
  text: string;
  embedText: string;
}

const MAX_CHARS = 2200; // ≈ 550 tokens
const MIN_CHARS = 400;

const TAG_IN_HEADING = new RegExp(`\\s*\\[(${CONFIDENCE_TAGS.join("|")})\\]\\s*$`);
const TAG_MARKER = new RegExp(`^\\[confidence: (${CONFIDENCE_TAGS.join("|")})\\]$`);
const URL_RE = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+(?:it|eu|org|com|net)(?:\/[^\s)|,;]*)?)/gi;

export function parseFrontMatter(md: string): { meta: Record<string, unknown>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    try {
      meta[k] = JSON.parse(v);
    } catch {
      meta[k] = v;
    }
  }
  return { meta, body: md.slice(m[0].length) };
}

export function extractUrls(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const u = m[1].replace(/[.)]+$/, "").toLowerCase();
    if (!/^\d/.test(u) && !u.includes("@")) out.add(u);
  }
  return [...out];
}

export function chunkDocument(slug: string, md: string): Chunk[] {
  const { meta, body } = parseFrontMatter(md);
  const region = (meta.region as string | null) ?? null;
  const chunks: Chunk[] = [];
  const headings: { level: number; title: string }[] = [];
  let conf = new Set<Confidence>();
  let buf: string[] = [];

  const emit = (text: string, isTable: boolean) => {
    if (!text.trim()) return;
    const headingPath = headings.map((h) => h.title);
    const prefix = [region ? `Region: ${region}` : `Italy (national)`, meta.title, headingPath.join(" > ")]
      .filter(Boolean)
      .join(" | ");
    const embedText = `${prefix}\n\n${text}`;
    chunks.push({
      id: `${slug}#${chunks.length}`,
      hash: createHash("sha1").update(embedText).digest("hex"),
      docSlug: slug,
      sourceFile: String(meta.source_file ?? slug),
      region,
      dsuBody: (meta.dsu_body as string | null) ?? null,
      docType: (meta.doc_type as DocType) ?? "regional",
      headingPath,
      confidence: [...conf],
      urls: extractUrls(text),
      isTable,
      text,
      embedText,
    });
  };
  const flush = () => {
    emit(buf.join("\n\n"), false);
    buf = [];
  };
  const size = () => buf.reduce((n, b) => n + b.length + 2, 0);

  for (const block of body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    const marker = block.match(TAG_MARKER);
    if (marker) {
      conf.add(marker[1] as Confidence);
      continue;
    }
    const h = block.match(/^(#{1,6})\s+(.*)$/);
    if (h && !block.includes("\n")) {
      const level = h[1].length;
      const tag = h[2].match(TAG_IN_HEADING);
      const title = h[2].replace(TAG_IN_HEADING, "").trim();
      // Small sub-sections are merged into the running chunk instead of becoming
      // tiny chunks; top-level headings always start a new chunk.
      if (level <= 2 || size() >= MIN_CHARS) {
        flush();
        conf = new Set();
      } else {
        buf.push(`**${title}**`);
      }
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, title });
      if (tag) conf.add(tag[1] as Confidence);
      continue;
    }
    if (block.startsWith("|")) {
      // Keep the sentence right before a table with it — it is usually its caption.
      const caption = buf.length && buf[buf.length - 1].length < 300 ? buf.pop()! : "";
      flush();
      emit([caption, block].filter(Boolean).join("\n\n"), true);
      continue;
    }
    if (size() + block.length > MAX_CHARS && buf.length) flush();
    buf.push(block);
  }
  flush();
  return mergeTinyChunks(chunks);
}

const TINY_CHARS = 150;

/** Fragments like a lone date line carry no context on their own; fold them into the next chunk. */
function mergeTinyChunks(chunks: Chunk[]): Chunk[] {
  const out: Chunk[] = [];
  let carry = "";
  for (const c of chunks) {
    if (!c.isTable && c.text.length < TINY_CHARS) {
      carry += (carry ? "\n\n" : "") + c.text;
      continue;
    }
    if (carry) {
      const text = `${carry}\n\n${c.text}`;
      const embedText = c.embedText.replace(c.text, text);
      c.text = text;
      c.embedText = embedText;
      c.hash = createHash("sha1").update(embedText).digest("hex");
      c.urls = extractUrls(text);
      carry = "";
    }
    out.push(c);
  }
  if (carry && out.length) {
    const last = out[out.length - 1];
    last.text += `\n\n${carry}`;
    last.embedText += `\n\n${carry}`;
    last.hash = createHash("sha1").update(last.embedText).digest("hex");
  }
  return out.map((c, i) => ({ ...c, id: `${c.docSlug}#${i}` }));
}
