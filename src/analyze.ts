import { chat, chatJson, DOCUMENT_SAFETY, slackify } from './ai.js';
import { config } from './config.js';

export type Deadline = { date: string; time?: string; title: string; detail: string };

export type Analysis = {
  title: string;
  documentType: string;
  summary: string;
  parties: string[];
  deadlines: Deadline[];
  obligations: string[];
  risks: string[];
};

// Long documents are trimmed for analysis (ANALYSIS_CHARS); every chunk is still indexed for search.
const ANALYSIS_CHARS = config.limits.analysisChars;

export async function analyzeDocument(fileName: string, text: string): Promise<Analysis> {
  const today = new Date().toISOString().slice(0, 10);
  const system = [
    'You are a careful legal analyst assisting a law team. Extract facts from the document; do not invent anything.',
    DOCUMENT_SAFETY,
    `Today is ${today}; the team's timezone is ${config.timezone}. Resolve relative dates ("within 30 days of signing") to a calendar date only when the document gives enough to do so; otherwise leave the deadline out and mention it under obligations.`,
    'Answer with one JSON object with these keys:',
    '"title" (short name for the document), "documentType" (e.g. lease, NDA, court order, email),',
    '"summary" (3-5 plain sentences), "parties" (array of strings like "Acme Ltd (Landlord)"),',
    '"deadlines" (array of { "date": "YYYY-MM-DD", "time": "HH:MM" or omitted, "title": short, "detail": what is due and the clause or section }),',
    '"obligations" (who must do what), "risks" (unusual, one-sided or missing terms worth a lawyer\'s attention).',
    'Use empty arrays when nothing applies.',
  ].join('\n');
  const truncated = text.length > ANALYSIS_CHARS;
  const user = `<document name="${fileName}">\n${text.slice(0, ANALYSIS_CHARS)}\n</document>${truncated ? '\n(The document was truncated for analysis.)' : ''}`;
  const raw = await chatJson<Partial<Analysis>>(system, user);
  // Models sometimes return list items as objects ({ "name": ..., "role": ... }); flatten them to text.
  const item = (x: unknown): string =>
    typeof x === 'string'
      ? x
      : x && typeof x === 'object'
        ? Object.values(x).filter((v) => typeof v === 'string' && v.trim()).join(', ')
        : '';
  const list = (v: unknown) => (Array.isArray(v) ? v.map(item).filter(Boolean) : []);
  return {
    title: raw.title || fileName,
    documentType: raw.documentType || 'Document',
    summary: raw.summary || '',
    parties: list(raw.parties),
    obligations: list(raw.obligations),
    risks: list(raw.risks),
    deadlines: (Array.isArray(raw.deadlines) ? raw.deadlines : []).filter(
      (d): d is Deadline => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.title)
    ),
  };
}

// Keeps a running brief per channel ("matter") up to date as documents arrive.
export async function updateBrief(previous: string, fileName: string, analysis: Analysis): Promise<string> {
  const system = [
    'You maintain the running brief for a legal matter that a team discusses in one Slack channel.',
    'Merge the new document into the brief. Keep it under 250 words, in Slack formatting (*bold* headings, • bullets).',
    'Sections: *Matter*, *Parties*, *Key dates*, *Open obligations*, *Risks*, *Documents*. Keep earlier facts unless the new document supersedes them, and say so when it does.',
    DOCUMENT_SAFETY,
  ].join('\n');
  const user = `Current brief:\n${previous || '(empty: this is the first document)'}\n\n<source name="${fileName}">\n${JSON.stringify(analysis, null, 2)}\n</source>`;
  return slackify(await chat(system, user));
}
