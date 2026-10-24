// Deterministic cleaning of the regional reports before chunking/embedding.
// The reports were converted from PDF and carry four kinds of noise:
//   1. base64 images (up to 360 KB in one file)
//   2. LaTeX garbage from OCR ($$ \mathsf{F r i u l i} $$)
//   3. HTML tables (<table><tr><td rowspan=1 ...>)
//   4. Persian text that the PDF extractor wrote right-to-left reversed
// We keep English for retrieval and park Persian in a separate file. Client-facing
// Farsi is produced later by the translator agent, never copied from these files.

export const CONFIDENCE_TAGS = ["CONFIRMED", "PARTIAL", "GAP", "PROJECTED"] as const;
export type Confidence = (typeof CONFIDENCE_TAGS)[number];

export interface CleanStats {
  bytesIn: number;
  bytesOut: number;
  base64Removed: number;
  latexBlocksRemoved: number;
  tablesConverted: number;
  enBlocks: number;
  faBlocks: number;
  droppedBlocks: number;
}

export interface CleanResult {
  en: string;
  fa: string;
  dropped: string[];
  stats: CleanStats;
}

const ARABIC_LETTER = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LATIN_LETTER = /[A-Za-zÀ-ÿ]/g;
const ARABIC_RUN = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿‌‏‎]+(?:[\s«»«»،؛:.()\-–—]*[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿‌]+)*/g;
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export function toAsciiDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = PERSIAN_DIGITS.indexOf(d);
    return String(i >= 0 ? i : ARABIC_DIGITS.indexOf(d));
  });
}

/** Share of Latin letters among all letters; null when the text has no letters. */
export function latinRatio(s: string): number | null {
  const lat = count(s, LATIN_LETTER);
  const ara = count(s, ARABIC_LETTER);
  return lat + ara === 0 ? null : lat / (lat + ara);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function stripBase64Images(s: string): { text: string; removed: number } {
  let removed = 0;
  const text = s
    .replace(/!\[[^\]]*\]\(data:image\/[^)]*\)/g, () => (removed++, ""))
    .replace(/<img[^>]*src=["']data:image\/[^"']*["'][^>]*>/g, () => (removed++, ""))
    .replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=\s]{100,}/g, () => (removed++, ""));
  return { text, removed };
}

export function stripLatex(s: string, dropped: string[]): { text: string; removed: number } {
  let removed = 0;
  const text = s
    .replace(/\$\$[\s\S]*?\$\$/g, (m) => {
      removed++;
      dropped.push(`[latex] ${m.replace(/\s+/g, " ").slice(0, 200)}`);
      return "\n";
    })
    // inline OCR math such as $\mathsf{...}$ or $^{12}$
    .replace(/\$[^$\n]{0,300}\\(mathsf|mathbf|mathcal|mathrm|therefore|sqrt|ldots|cup|leq|iota)[^$\n]{0,300}\$/g, (m) => {
      removed++;
      dropped.push(`[latex-inline] ${m.slice(0, 200)}`);
      return "";
    });
  return { text, removed };
}

function cellText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " / ")
      .replace(/<[^>]+>/g, "")
      .replace(/\|/g, "/")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/** Converts one HTML <table> into a markdown table. rowspan/colspan are flattened. */
export function htmlTableToMarkdown(table: string): string {
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1])),
  );
  const nonEmpty = rows.filter((r) => r.some((c) => c.length > 0));
  if (nonEmpty.length === 0) return "";
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  const [head, ...body] = nonEmpty;
  return [line(head), `|${" --- |".repeat(width)}`, ...body.map(line)].join("\n");
}

export function convertTables(s: string): { text: string; converted: number } {
  let converted = 0;
  const text = s.replace(/<table[\s\S]*?<\/table>/gi, (t) => {
    converted++;
    return `\n\n${htmlTableToMarkdown(t)}\n\n`;
  });
  return { text, converted };
}

function stripInlineHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?(sup|sub|u|b|i|em|strong|span|div|p)[^>]*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n"),
  );
}

/** Removes Persian runs from a mostly-English line, then tidies leftover punctuation. */
function dropArabicRuns(line: string): string {
  return toAsciiDigits(line)
    .replace(ARABIC_RUN, " ")
    .replace(/[‌‎‏]/g, "")
    .replace(/\s*([—–-])\s*([—–-]\s*)+/g, " $1 ")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

const PAGE_FOOTER = /^.{0,120}\s[—–-]\s*\d+\s*\/\s*\d+\s*$/; // "Lombardy Region Report — ... — 1 / 18"
const MARKER_ONLY = /^#*\s*[*_]*\s*(ENGLISH|فارسی)\s*[*_]*\s*$/i;

function isHeading(b: string) {
  return /^#{1,6}\s/.test(b);
}
function isTable(b: string) {
  return b.startsWith("|");
}

/** Normalises a heading: keeps the English part and the confidence tag; Persian removed. */
function cleanHeading(b: string): string | null {
  const level = b.match(/^#+/)![0];
  const body = dropArabicRuns(b.slice(level.length)).replace(/`|\*\*|__/g, "");
  const tag = CONFIDENCE_TAGS.find((t) => body.includes(t));
  const title = body
    .replace(new RegExp(`\\b(${CONFIDENCE_TAGS.join("|")})\\b`, "g"), "")
    .replace(/^[\s—–-]+|[\s—–-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Liguria-style "## CONFIRMED" on its own line, right after a Persian heading:
  // keep the tag as a marker so the chunker applies it to the content below.
  if (count(title, LATIN_LETTER) < 3) return tag ? `[confidence: ${tag}]` : null;
  return `${level} ${title}${tag ? ` [${tag}]` : ""}`;
}

/** Table rows: keep rows that are mostly Latin; Persian runs inside cells are removed. */
function cleanTable(b: string): string | null {
  const rows = b.split("\n");
  const kept = rows.filter((r, i) => {
    if (i === 1 && /^\|[\s:|-]+\|$/.test(r)) return true; // separator
    const ratio = latinRatio(r);
    return ratio === null ? /\d/.test(r) : ratio >= 0.4;
  });
  if (kept.length < 3) return null; // header + separator + at least one row
  // One-column "tables" come from OCR of images and are garbage ("| S 1000 |", "| j j |").
  if (kept.every((r) => r.split("|").length <= 3)) return null;
  return kept.map((r) => (r.startsWith("|---") || /^\|[\s:|-]+\|$/.test(r) ? r : dropArabicRuns(r))).join("\n");
}

export function cleanDocument(raw: string): CleanResult {
  const dropped: string[] = [];
  const stats: CleanStats = {
    bytesIn: Buffer.byteLength(raw),
    bytesOut: 0,
    base64Removed: 0,
    latexBlocksRemoved: 0,
    tablesConverted: 0,
    enBlocks: 0,
    faBlocks: 0,
    droppedBlocks: 0,
  };

  let text = raw.replace(/\r\n/g, "\n");
  const b64 = stripBase64Images(text);
  text = b64.text;
  stats.base64Removed = b64.removed;
  const latex = stripLatex(text, dropped);
  text = latex.text;
  stats.latexBlocksRemoved = latex.removed;
  const tables = convertTables(text);
  text = tables.text;
  stats.tablesConverted = tables.converted;
  text = stripInlineHtml(text);

  // Headings and table rows become their own blocks even without blank lines around them.
  const blocks: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    let buf: string[] = [];
    let tbl: string[] = [];
    const flush = () => {
      if (buf.length) blocks.push(buf.join(" "));
      if (tbl.length) blocks.push(tbl.join("\n"));
      buf = [];
      tbl = [];
    };
    for (const l of lines) {
      if (isHeading(l)) {
        flush();
        blocks.push(l);
      } else if (l.startsWith("|")) {
        if (buf.length) {
          blocks.push(buf.join(" "));
          buf = [];
        }
        tbl.push(l);
      } else if (/^([-*•]|\d+[.)])\s/.test(l)) {
        // list items stay separate so a bullet in Persian doesn't drag English with it
        flush();
        blocks.push(l);
      } else {
        if (tbl.length) {
          blocks.push(tbl.join("\n"));
          tbl = [];
        }
        buf.push(l);
      }
    }
    flush();
  }

  const en: string[] = [];
  const fa: string[] = [];
  let last = "";
  for (const block of blocks) {
    const b = block.trim();
    if (!b || MARKER_ONLY.test(b) || PAGE_FOOTER.test(b) || /^[•·\-*\s]+$/.test(b)) continue;

    let out: string | null = null;
    if (isHeading(b)) {
      out = cleanHeading(b);
      if (!out && count(b, ARABIC_LETTER) > 0) {
        fa.push(b);
        stats.faBlocks++;
        continue;
      }
    } else if (isTable(b)) {
      out = cleanTable(b);
    } else {
      const ratio = latinRatio(b);
      if (ratio === null) {
        // numbers/symbols with no words around them are OCR residue ("59", "9944,")
        dropped.push(`[no-letters] ${b.slice(0, 120)}`);
        stats.droppedBlocks++;
        continue;
      }
      if (ratio < 0.5) {
        fa.push(b);
        stats.faBlocks++;
        continue;
      }
      out = dropArabicRuns(b);
      if (count(out, LATIN_LETTER) < 3) out = null;
    }

    if (!out) {
      dropped.push(`[unusable] ${b.slice(0, 120)}`);
      stats.droppedBlocks++;
      continue;
    }
    if (out === last) continue; // PDF page breaks often duplicate a line
    en.push(out);
    stats.enBlocks++;
    last = out;
  }

  const enText = en.join("\n\n") + "\n";
  stats.bytesOut = Buffer.byteLength(enText);
  return { en: enText, fa: fa.join("\n\n") + "\n", dropped, stats };
}
