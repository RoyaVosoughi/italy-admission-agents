import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDocument, htmlTableToMarkdown, latinRatio, toAsciiDigits } from "./clean";

test("strips base64 images and LaTeX garbage", () => {
  const raw = [
    "# Title",
    "![](data:image/png;base64," + "A".repeat(500) + ")",
    "$$\n\\mathsf { F r i u l i }\n$$",
    "The ERDIS deadline is 28 August 2026.",
  ].join("\n\n");
  const r = cleanDocument(raw);
  assert.equal(r.stats.base64Removed, 1);
  assert.equal(r.stats.latexBlocksRemoved, 1);
  assert.ok(!r.en.includes("base64"));
  assert.ok(!r.en.includes("mathsf"));
  assert.ok(r.en.includes("28 August 2026"));
});

test("converts HTML tables to markdown with decoded entities", () => {
  const md = htmlTableToMarkdown(
    "<table><tr><td rowspan=1>Body</td><td>Deadline</td></tr><tr><td>Universit&#x27;a</td><td>4 Sep<br>12:00</td></tr></table>",
  );
  assert.equal(md, "| Body | Deadline |\n| --- | --- |\n| Universit'a | 4 Sep / 12:00 |");
});

test("routes Persian paragraphs to fa and keeps English", () => {
  const r = cleanDocument("مهم یتاعالطا فاکش و این متن فارسی است\n\nThe scholarship is €7,171.11 per year.");
  assert.ok(r.en.includes("€7,171.11"));
  assert.ok(!/[؀-ۿ]/.test(r.en));
  assert.ok(r.fa.includes("فارسی"));
});

test("headings keep English title and confidence tag", () => {
  const r = cleanDocument("## 1.1 Financial ceiling — سقف مالی `CONFIRMED`");
  assert.equal(r.en.trim(), "## 1.1 Financial ceiling [CONFIRMED]");
});

test("tag-only heading becomes a confidence marker", () => {
  const r = cleanDocument("## سقف مالی ۲.۱\n## CONFIRMED\nISEE € 28,339.00");
  assert.ok(r.en.includes("[confidence: CONFIRMED]"));
});

test("helpers", () => {
  assert.equal(toAsciiDigits("۲۰۲۶/۲۷"), "2026/27");
  assert.equal(latinRatio("123"), null);
  assert.equal(latinRatio("abc"), 1);
});
