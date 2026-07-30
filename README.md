# ICP Builder

A standalone web app whose front door is a conversation. Describe your business
in plain English; a strategist bot holds a real conversation, quietly assembles
a complete brief, and produces detailed, downloadable Ideal Customer Profiles —
one per awareness stage — as Word documents.

---

## The master prompt

`prompts/master_icp.md` is the ICP framework and the spec for output quality.

It is **immutable**. It is loaded from disk at runtime, passed verbatim as the
system message on every generation call, and never paraphrased, summarised or
inlined into TypeScript. `MASTER_PROMPT_VERSION` is derived from the file's own
SHA-256, so editing the prompt automatically produces a new version, and every
generated document records which version wrote it.

To change ICP output quality, edit `prompts/master_icp.md`. Nothing else.

The machine-readable index of its mandatory headings lives in
`src/lib/sections.ts`. `npm run selftest` asserts that every heading in that
index still appears in the prompt itself, so the two cannot silently drift.

---

## Local setup

Requires Node 20+ and a Postgres database.

```bash
npm install
cp .env.example .env        # then fill in OPENAI_API_KEY and DATABASE_URL
npx prisma migrate deploy   # create the schema
npm run dev                 # http://localhost:3000
```

No Postgres locally? The quickest options are a free Railway or Neon database —
paste its connection string into `DATABASE_URL` — or Docker:

```bash
docker run -d --name icp-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres?schema=public
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Prisma generate → Next build → standalone postbuild |
| `npm start` | Production server (`node .next/standalone/server.js`) |
| `npm run selftest` | Offline engine tests — no API key, no database |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Create a new migration in development |
| `npm run db:deploy` | Apply migrations (the release step) |
| `npm run db:studio` | Browse the data |

`npm run selftest` covers the things that must be right before a token is
spent: the prompt loads verbatim, the validator actually rejects thin sections,
a stated slot is never downgraded to a guess, no blank price ever reaches the
model, and both exporters produce real files. Run it after touching
`src/lib/`.

---

## Deploying to Railway

### 1. Add a Postgres plugin

New → Database → PostgreSQL. It provides `DATABASE_URL` automatically.

### 2. Set these service variables

| Variable | Required | Value |
| --- | --- | --- |
| `OPENAI_API_KEY` | **yes** | Your OpenAI key. Server-side only. |
| `DATABASE_URL` | **yes** | Reference the Postgres plugin: `${{Postgres.DATABASE_URL}}` |
| `OPENAI_MODEL` | recommended | `gpt-4o` — generation, repair, comparison |
| `OPENAI_MODEL_FAST` | recommended | `gpt-4o-mini` — slot resolution and conversation |

Everything else is optional and has a working default — see `.env.example` for
timeouts, retry counts, concurrency, temperature and cost-logging rates.

Do **not** set `PORT`. Railway injects it and the server binds `0.0.0.0:$PORT`.

Never prefix any variable with `NEXT_PUBLIC_`. `/api/health` will flag it as a
problem if an OpenAI key is ever exposed that way.

### 3. Deploy

`railway.json` is committed and pins everything:

- **Build:** `npm run build`
- **Release:** `npx prisma migrate deploy` (as `preDeployCommand` — never
  `db push`, which would silently drop columns)
- **Start:** `npm start`
- **Healthcheck:** `/api/health`

Push, and Railway does the rest.

### 4. Verify the deploy

```bash
# 200 with status "ok", and the master prompt version it loaded
curl https://<app>.up.railway.app/api/health

# Five ticks, one per second. If they all land at once, something is buffering.
curl -N https://<app>.up.railway.app/api/health/stream
```

The health endpoint reports *why* it is degraded rather than failing opaquely,
so a missing key or an unreachable database is one curl away from diagnosis.

---

## Architecture

### Four passes

1. **RESOLVE** (`src/lib/resolve.ts`) — one call to the fast model in JSON mode
   with the full history, the slot schema and any scraped site context. Returns
   every slot with its provenance (`stated` / `inferred` / `default`), a
   confidence, a one-clause justification, plus `missing[]` and
   `ambiguities[]`. There is no regex parsing anywhere; the model reads meaning
   and code enforces the provenance rules.

2. **CONVERSE** (`src/lib/converse.ts`) — the persona. One question per turn,
   two sentences maximum before it, every question carrying a proposed answer
   so the user can confirm rather than compose. It is handed the resolved state
   and told which single gap matters; it never sees a list of fields to march
   through.

3. **GENERATE** (`src/lib/generate.ts`) — three sequential calls per document,
   never one monolithic call. A single call asked for all nineteen sections
   reliably starves everything after Objections. Parts A and B are passed into
   C so the avatar name, voice, region and jargon stay consistent across the
   seams. Scenarios run in parallel behind a concurrency cap; the first streams
   immediately.

4. **VALIDATE** (`src/lib/validate.ts`) — every mandatory heading must be
   present *and* substantive: ~120 words for narrative sections, exactly 8
   objections, 8–12 qualifiers, 2–4 success stories. Anything below threshold
   gets one targeted expand call for that section only, spliced back in place.
   Documents are badged `complete`, `repaired` or `failed` — never silently
   shipped partial.

Then one extra call builds the **cross-scenario comparison table** (dominant
belief, message that lands, message that backfires, best channel, primary
objection). That table is what makes the bundle a deliverable rather than four
loose files: it is the first tab and the cover section of the combined export.

### Awareness

Awareness is the one slot never asked in prose.

If the conversation settles it — "they already know they need SEO, they're
comparing agencies" — it is set, said out loud in chat, and the modal never
appears. Otherwise, once every other required slot is filled, a blocking modal
opens: four checkbox cards in a 2×2, **all pre-checked**, a live document count,
and one button. The default path is a single click to four documents. The "both
aware" card carries a *ready to buy* sub-toggle that adds a fifth. Dismissing it
returns to chat with nothing generated and nothing lost.

### Guardrails in code, not just the prompt

A prompt can be ignored; code cannot.

- A blank price becomes the master prompt's mandated
  `Price/terms: not specified (quote/assessment required)` before the payload is
  built, so there is no empty field for the model to helpfully fill with a
  number.
- Exactly one `audience_type` is ever emitted per generation call, so the
  master prompt's non-mixing rule has nothing to trip over.
- Scraped site text is labelled `VERIFIED CONTEXT — use only these company
  facts, do not infer beyond them.` A fetch failure is non-fatal and mentioned
  once in chat.
- Regulated verticals (health, dental, medical, finance, legal) are detected
  from the brief, append the compliance-language reminder, and flag the run in
  the UI.
- Every OpenAI call has a timeout, exponential backoff with jitter on 429/5xx,
  and per-run token and cost logging.
- Generation is idempotent per `(run, service, scenario)` — enforced by a unique
  constraint plus a status check, so a retry after a dropped connection never
  duplicates a document or double-charges.

### Persistence

Postgres, not SQLite: Railway's filesystem is ephemeral and SQLite would lose
every saved ICP on redeploy. Conversation state is written on every turn, so a
refresh mid-brief or a redeploy mid-generation loses nothing.

Editing the brief marks contradicted documents `stale` rather than deleting
them — a document that says "B2B practice owners" attached to a brief that now
says "B2C patients" is the worst possible outcome, because it looks correct.

### Exports

DOCX is primary, built with real Word `Heading 1/2/3` styles so an agency can
drop the file into their own template and have the navigation pane and table of
contents follow.

- **Awareness map DOCX** — cover page, comparison table, table of contents, then
  each scenario as a chapter.
- **Individual scenario files** — DOCX, PDF and raw Markdown.
- **Download all (ZIP)** — the map, every scenario in both formats, the
  comparison table, and a README.

Filenames follow `{company-slug}-{scenario}-{YYYYMMDD}.docx`. Everything is
built on demand from stored markdown and reachable from the saved-runs list, not
just the fresh result screen.

PDF uses `pdf-lib`, deliberately **not** Puppeteer: Railway's default Nixpacks
image ships no Chromium, so a Puppeteer renderer builds fine, deploys fine, and
then dies at first request with an opaque launch error.

---

## Project layout

```
prompts/master_icp.md          The ICP master prompt. Immutable. Edit this to change output.
prisma/schema.prisma           Runs, messages, documents, comparisons, usage logs
prisma/migrations/             Applied by `prisma migrate deploy` in the release step

src/lib/
  master-prompt.ts             Loads the prompt from disk, derives the version  [server]
  sections.ts                  Mandatory headings + validation shape            [shared]
  slots.ts                     Slot schema, provenance rules, ask priority      [shared]
  resolve.ts                   PASS 1 — resolution                              [server]
  converse.ts                  PASS 2 — the persona                             [server]
  generate.ts                  PASS 3 — three-chunk generation                  [server]
  validate.ts                  PASS 4 — validation and targeted repair          [server]
  compare.ts / comparison.ts   Cross-scenario table (call / shape)              [server / shared]
  docx.ts, pdf.ts              Exporters                                        [server]
  openai.ts                    Timeouts, backoff, token and cost logging        [server]
  scrape.ts                    Website fetch, non-fatal                         [server]

src/app/api/
  health, health/stream        Railway healthcheck and a streaming diagnostic
  chat                         SSE: resolve → scrape → converse → state
  generate                     SSE: three-chunk generation, validation, comparison
  export                       DOCX / PDF / Markdown / ZIP, built on demand
  runs, runs/[id], .../slots   Run lifecycle and click-to-edit brief

src/components/                Chat, brief panel, awareness modal, results view
scripts/selftest.mts           Offline engine tests
scripts/postbuild.mjs          Completes the standalone output for Railway
```

Modules marked `[server]` import `server-only`, which turns "accidentally
imported this into a client component" into a build error rather than a leaked
API key. That guard is why the shared shapes live in their own modules.

---

## Notes

- `OPENAI_API_KEY` never reaches the browser. All OpenAI traffic goes through
  route handlers, and model names come from env so they swap without a code
  change.
- Streaming responses set `Cache-Control: no-cache`, `X-Accel-Buffering: no` and
  `Connection: keep-alive`, with a keep-alive comment ping, so long generations
  survive the Railway proxy and idle-connection reapers.
- `npm run build` runs `scripts/postbuild.mjs`, which copies `.next/static` and
  `prompts/` into the standalone output. Next does not do this itself; skip it
  and the container boots, passes its healthcheck, and serves every page with no
  CSS. It fails the build loudly instead.
