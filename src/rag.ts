import { chat, DOCUMENT_SAFETY, NOT_ADVICE, slackify } from './ai.js';
import { store } from './store.js';
import { search } from './vectors.js';

export type Answer = { text: string; sources: string[]; numbering?: string[] };

export type Turn = { role: 'user' | 'assistant'; text: string };

// Answers a question from the channel's documents, citing them as [1], [2]...
export async function answer(team: string, channel: string, question: string, history: Turn[] = []): Promise<Answer> {
  // Fold the latest thread turns into the search so follow-ups ("and when is that due?") still find the right clauses.
  const searchText = [...history.slice(-2).map((t) => t.text), question].join('\n');
  const hits = await search(team, channel, searchText);
  const brief = store.getBrief(channel);

  if (!hits.length && !brief) {
    return {
      text: "I don't have any documents for this channel yet. Upload a DOCX, PDF, image or .eml file here and I'll index it.",
      sources: [],
    };
  }

  const files = [...new Set(hits.map((h) => h.fileName))];
  const sources = hits
    .map((h) => `<source id="${files.indexOf(h.fileName) + 1}" file="${h.fileName}" part="${h.chunk + 1}">\n${h.text}\n</source>`)
    .join('\n\n');

  const system = [
    'You are a legal research assistant for a law team in Slack. Answer only from the sources and the matter brief.',
    'Cite sources inline as [1], [2] using the source ids. Quote the exact clause wording when it matters.',
    'If the sources do not answer the question, say so plainly and suggest which document would.',
    'Use Slack formatting (*bold*, • bullets). Be concise.',
    DOCUMENT_SAFETY,
    NOT_ADVICE,
  ].join('\n');
  const thread = history.length
    ? `Earlier in this thread:\n${history.slice(-6).map((t) => `${t.role === 'user' ? 'Team' : 'You'}: ${t.text}`).join('\n')}\n\n`
    : '';
  const user = `Matter brief:\n${brief || '(none yet)'}\n\n${sources}\n\n${thread}Question: ${question}`;
  const text = slackify(await chat(system, user));
  // List only the sources the answer cites; fall back to all of them if it cites none.
  const cited = files.filter((_, i) => text.includes(`[${i + 1}]`));
  return { text, sources: cited.length ? cited : files, numbering: files };
}
