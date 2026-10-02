import type { KnownBlock } from '@slack/types';
import { NOT_ADVICE } from './ai.js';
import type { Ingested } from './ingest.js';
import type { DocRecord } from './store.js';

// Slack sections hold at most 3000 characters.
const clip = (text: string, max = 2900) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const bullets = (items: string[], max = 6) =>
  items.slice(0, max).map((i) => `• ${i}`).join('\n') + (items.length > max ? `\n_…and ${items.length - max} more_` : '');

const section = (text: string): KnownBlock => ({ type: 'section', text: { type: 'mrkdwn', text: clip(text) } });
const footer = (text: string): KnownBlock => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });

export function analysisBlocks(doc: Ingested): KnownBlock[] {
  const a = doc.analysis;
  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: clip(`📄 ${a.title}`, 150) } },
    footer(`${a.documentType} · ${doc.kind} · ${doc.fileName} · indexed in ${doc.chunks} part${doc.chunks === 1 ? '' : 's'}`),
    section(`*Summary*\n${a.summary || '_No summary._'}`),
  ];
  if (a.parties.length) blocks.push(section(`*Parties*\n${bullets(a.parties)}`));
  if (a.deadlines.length) {
    blocks.push(section(`*Key dates*\n${bullets(a.deadlines.map((d) => `*${d.date}${d.time ? ` ${d.time}` : ''}* ${d.title}: ${d.detail}`), 10)}`));
  }
  if (a.obligations.length) blocks.push(section(`*Obligations*\n${bullets(a.obligations)}`));
  if (a.risks.length) blocks.push(section(`*Worth a lawyer's look*\n${bullets(a.risks)}`));

  const buttons = [];
  if (a.deadlines.length) {
    buttons.push({
      type: 'button' as const,
      action_id: 'add_deadlines',
      style: 'primary' as const,
      text: { type: 'plain_text' as const, text: `📅 Add ${a.deadlines.length} date${a.deadlines.length === 1 ? '' : 's'} to calendar` },
      value: doc.id,
    });
  }
  buttons.push({ type: 'button' as const, action_id: 'show_brief', text: { type: 'plain_text' as const, text: 'Matter brief' }, value: doc.channel });
  blocks.push({ type: 'actions', elements: buttons });
  if (doc.attachments.length) {
    blocks.push(footer(`Also indexed from this email: ${doc.attachments.map((c) => c.fileName).join(', ')}`));
  }
  blocks.push(footer(`_${NOT_ADVICE}_`));
  return blocks;
}

export function answerBlocks(text: string, sources: string[]): KnownBlock[] {
  const blocks: KnownBlock[] = [section(text || '_No answer._')];
  if (sources.length) blocks.push(footer(`Sources: ${sources.map((s, i) => `[${i + 1}] ${s}`).join(' · ')}`));
  blocks.push(footer(`_${NOT_ADVICE}_`));
  return blocks;
}

export function docListText(docs: DocRecord[]): string {
  if (!docs.length) return 'No documents in this channel yet. Upload a DOCX, PDF, image or .eml file to add one.';
  return [
    `*Documents in this channel (${docs.length})*`,
    ...docs.map((d, i) => `${i + 1}. *${d.analysis.title}* · ${d.fileName} · <!date^${Math.floor(d.uploadedAt / 1000)}^{date_short}|${new Date(d.uploadedAt).toISOString().slice(0, 10)}>`),
    '_Remove one with `/legal forget <number>`._',
  ].join('\n');
}

export const HELP = [
  '*Legal AI: how to use me*',
  '• *Upload* a DOCX, PDF, image (scan or photo) or .eml email in a channel I\'m in. I index it, summarise it, pull out parties, dates, obligations and risks, and update the channel\'s matter brief.',
  '• *Ask*: mention me, e.g. `@Legal AI when does the lease renewal notice have to be sent?`. I answer from this channel\'s documents with sources. Reply in the thread for follow-ups.',
  '• `/legal brief`: the running brief for this channel\'s matter',
  '• `/legal docs`: documents I know about here; `/legal forget <number>` removes one',
  '• `/legal draft <what>`: drafts a letter, notice, clause or memo from the documents and uploads a .docx',
  '• `/legal schedule <event>`: adds an event to the team calendar, e.g. `/legal schedule Mediation with Acme on 2026-11-20 at 10:00 for 2 hours`',
  'Each channel is its own matter: documents in one channel are never used to answer in another.',
].join('\n');
