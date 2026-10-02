# AI Legal Slack Organization

A Slack bot for legal teams. Drop documents into a channel and it reads them, remembers them
and works with them:

- **Reads** DOCX, PDF, images (scans and photos, read by an AI vision model), plain text and
  `.eml` emails, including supported email attachments.
- **Indexes** every document as embeddings in **Pinecone**, so questions are answered
  from the actual clauses (RAG) with numbered sources.
- **Analyses** each upload: summary, parties, key dates, obligations and terms worth a
  lawyer's attention.
- **Keeps the matter brief up to date**: each channel is one matter, and its running brief is
  rewritten as new documents arrive.
- **Schedules** deadlines in **Google Calendar** with one click, or from plain English with
  `/legal schedule`.
- **Drafts** letters, notices, clauses and memos from the matter's documents and uploads them
  as `.docx` files.

Every answer and draft is marked as AI assistance that a qualified person must review.

## How it works

```
Slack upload ─> download ─> extract text (mammoth / unpdf / mailparser / vision model)
                              │
                              ├─> chunk ─> embeddings ─> Pinecone (namespace = workspace,
                              │                                    filter = channel)
                              └─> AI analysis ─> matter brief update ─> summary card in Slack
                                                                         └─ [Add dates to calendar]

@Legal AI question ─> embed ─> Pinecone top matches in this channel ─> answer with [1] [2] sources
/legal draft ...    ─> same retrieval ─> draft ─> .docx ─> uploaded to the channel
```

The bot uses Slack **Socket Mode**: it connects out to Slack, so it needs no public URL and
runs anywhere Node.js runs (your computer, a VPS, a container).

## Setup

Needs Node.js 20+, a Slack workspace, Pinecone, and Groq or OpenAI (Google Calendar is optional).

```bash
npm install
cp .env.example .env
```

### 1. Slack app
1. https://api.slack.com/apps > **Create New App** > **From a manifest** > pick your workspace >
   paste `slack-manifest.yml` > **Create**.
2. **Basic Information > App-Level Tokens > Generate**: any name, scope `connections:write`.
   Copy it into `SLACK_APP_TOKEN` (starts with `xapp-`).
3. **Install App > Install to Workspace**. Copy the **Bot User OAuth Token** into
   `SLACK_BOT_TOKEN` (starts with `xoxb-`).
4. In Slack, add the bot to a channel: `/invite @Legal AI`.

### 2. AI models

**Free (default):** chat, analysis and drafts on [Groq](https://console.groq.com) (put your key in
`LLM_API_KEY`), images read by a Groq model that accepts images (`VISION_MODEL`), and embeddings
from Pinecone's hosted `llama-text-embed-v2` model (`EMBED_PROVIDER=pinecone`, no extra key).
Free tiers allow about 8,000 tokens a minute; the default prompt sizes fit within that, and
rate-limited requests are retried automatically.

**OpenAI:** set `OPENAI_API_KEY` and `EMBED_PROVIDER=openai`, clear `LLM_BASE_URL` and
`LLM_API_KEY`, and set `LLM_MODEL`/`VISION_MODEL` to OpenAI model names. Raise `ANALYSIS_CHARS`,
`SEARCH_TOP_K` and `DRAFT_MAX_TOKENS` for longer documents.

Changing the embedding provider changes the vector size, so use a new `PINECONE_INDEX` name
when you switch.

### 3. Pinecone
Sign up (the free Starter plan is enough) and put your API key in `PINECONE_API_KEY`. The index
(`PINECONE_INDEX`, cosine, sized for the embedding model) is created on first start.

### 4. Google Calendar (optional)
1. Google Cloud Console: enable the **Google Calendar API**, create a **service account**, and
   download a JSON key. Save it as `service-account.json` in this folder (it is git-ignored) and
   set `GOOGLE_SERVICE_ACCOUNT_FILE=./service-account.json`.
2. In Google Calendar, open the team calendar's **Settings and sharing** > **Share with specific
   people**: add the service account's email with **Make changes to events**.
3. Copy the **Calendar ID** from the same page into `GOOGLE_CALENDAR_ID`, and set `TIMEZONE`.

### Run

```bash
npm start         # or: npm run dev (restarts on code changes)
```

The startup log names the workspace, models, Pinecone index and calendar.

## Using it

| In Slack | What happens |
| --- | --- |
| Upload a file in a channel the bot is in | It is read, indexed and analysed; the summary card appears in the thread |
| `@Legal AI <question>` | Answer from this channel's documents with sources; reply in the thread for follow-ups |
| Direct message the bot | Same as a mention, using documents uploaded in the DM |
| **Add dates to calendar** button | Creates an event (with reminders) for each key date the analysis found |
| `/legal brief` | The channel's running matter brief |
| `/legal docs` · `/legal forget <n>` | List documents · remove one from the index |
| `/legal ask <question>` | Ask and post the answer to the channel |
| `/legal draft <what>` | Draft from the documents, uploaded as `.docx` |
| `/legal schedule <event>` | e.g. `Mediation with Northwind on 2026-11-20 at 10:00 for 2 hours` |

Try it with the fictional documents in `samples/` (`npx tsx samples/make-samples.ts` rebuilds
them).

## Privacy and safety

- Document text is sent to the AI providers (Groq or OpenAI, and Pinecone for embeddings) and stored in Pinecone and in
  `data/store.json`. Check this fits your firm's confidentiality rules and client agreements
  before using real client documents.
- Channels are kept apart: retrieval filters by channel, so one matter's documents are never
  used in another channel.
- Prompts tell the model to treat document text as material, not instructions, which guards
  against documents that try to steer the bot.
- Tokens and keys live only in `.env` and the service account file, both git-ignored.

## Development

```bash
npm run typecheck
npm test          # offline tests: DOCX/PDF/email/image extraction, chunking, DOCX generation
```

| File | Role |
| --- | --- |
| `src/slack.ts` | Slack events, `/legal` command, buttons |
| `src/ingest.ts` | Upload pipeline |
| `src/extract.ts` · `src/chunk.ts` | Text extraction · chunking |
| `src/vectors.ts` | Pinecone index, upsert, search |
| `src/analyze.ts` | Document analysis and matter brief |
| `src/rag.ts` · `src/draft.ts` | Answers · drafts and DOCX output |
| `src/calendar.ts` | Google Calendar events |
| `src/store.ts` | Document list and briefs (JSON file) |
