# Italy Admission Agents

A multi-agent system that assesses an Iranian client's profile, estimates realistic admission chances at
Italian public universities, recommends the best-fit universities, and writes a step-by-step scholarship
(DSU) guide plus both cost sections. It's grounded in the regional reports in the parent folder (RAG), checked
against official websites (Tavily), and approved by a **Manager agent**, not a human.

Design and decisions: [`../italy-admission-agents-plan.md`](../italy-admission-agents-plan.md).

## Everyday use

```bash
npm run dev            # studio at http://localhost:3100/studio
```

In the studio: **New assessment** → client folder name, resume/Obsidian note (PDF, DOCX, MD, TXT),
optional notes and today's toman/EUR rate → **Start**. Watch each agent under **Runs**. When the Manager
approves, the bilingual report (`.md` + `.docx`) is saved to
`../immigration files/clients/<client>/report-YYYY-MM-DD.md`. Nothing is sent to the client automatically.

Command-line alternative:

```bash
npm run client -- <client-folder> <resume.pdf> [<note.md>] [--rate 110000] [--notes "budget 8k/year"]
```

Run statuses: `approved` (report saved) · `needs_input` (a critical fact is missing from the documents —
start again with it in the notes) · `blocked` (the Manager couldn't verify the report; the reason and the
evidence are in the studio) · `error`.

## When the regional reports change

```bash
npm run kb:clean       # clean the reports (images, OCR garbage, reversed Persian, tables)
npm run kb:index       # chunk + embed; only changed chunks are re-embedded
npm run eval:retrieval # 36 test questions; should stay ≥ 90% hit@5
```

A new regional file must be added to `src/lib/rag/sources.ts` (the clean step warns about unregistered files).

## The pipeline

```
intake → rules/profile → assessor → scout (RAG) → analyst ×N → rules/ranking (shortlist)
→ scholarship ×K ∥ cost → verifier (official sites) → writer
→ MANAGER (own spot-check + claim audit) ⇄ rework orders (≤3 rounds) → approval gate (code)
→ translator (+ checks) → export → critic (lessons)
```

- **Orchestrator is code** (`src/lib/agents/orchestrator.ts`): order, loops, limits and the gate.
- **Rules are code** (`src/lib/rules/`): GPA conversion, chance rubric, shortlist, ISEE, timeline, costs,
  PII, claim extraction, evidence quote-matching, report checks, approval gate. `npm test` covers them.
- **Manager can't override the gate** (`rules/gates.ts`): every date/amount/score in the report is either
  backed by a quote that really appears on an official page, or labelled expected/projected.
- **Self-improvement**: lessons (critic, Manager rework history, real outcomes) are injected into agents'
  prompts — max 8 per agent, deletable in the studio. Record real results under **Outcomes**.

## Settings (`.env.local`)

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `gemini` (free AI Studio key) or `openrouter` (needs credits) |
| `PIPELINE_MODEL` / `ANALYST_MODEL` / `MANAGER_MODEL` / `WRITER_MODEL` | models per role |
| `EMBEDDING_API_KEY` | Gemini key (also used for chat when `LLM_PROVIDER=gemini`) |
| `OPENROUTER_API_KEY` | only for `LLM_PROVIDER=openrouter` |
| `TAVILY_API_KEY` | official-site verification |
| `MAX_TAVILY_CALLS` · `MAX_MANAGER_ROUNDS` · `APPROVE_THRESHOLD` · `LLM_CONCURRENCY` | limits |
| `CLIENTS_DIR` | where approved reports go (default `../immigration files/clients`) |

Free-tier limits (one client run ≈ 30–50 model calls, ~30 web calls):
- Gemini chat (`gemini-3.5-flash-lite`): **500 requests/day** → about 10 client runs a day.
- Gemini embeddings: 1,000 texts/day (a full re-index uses ~430; each run's searches use a few).
- Tavily free plan: ~1,000 credits/month → roughly 25–30 runs a month (basic search = 1 credit).
When a daily quota is used up, the run stops with a clear "daily … quota used up" message; it resets after midnight Pacific time.

## Weekly freshness check

`GET /api/cron/weekly` re-opens every official page that backed an approved report from the last 120 days
and flags reports whose quoted sentence has disappeared (new bando, changed deadline). Locally, schedule it
with Windows Task Scheduler while `npm run dev` is running.

## Privacy

Client documents stay on this computer (`data/uploads`, git-ignored). Documents are redacted (passport, ID, phone, email) before any model sees them, but names, dates of birth and
the CV content are still sent to the model; web-search queries are blocked if they contain client data (`rules/pii.ts`).
