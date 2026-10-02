import type { KnownBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import { analysisBlocks, answerBlocks, docListText, HELP } from './blocks.js';
import { addEvent, CALENDAR_SETUP_HINT, parseScheduleRequest } from './calendar.js';
import { calendarEnabled, config } from './config.js';
import { draftDocument } from './draft.js';
import { isSupported, SUPPORTED } from './extract.js';
import { ingest } from './ingest.js';
import { answer, type Turn } from './rag.js';
import { store } from './store.js';
import { deleteDocVectors } from './vectors.js';

/*
 * Everything the bot does in response to Slack, independent of how events arrive:
 * Socket Mode (src/slack.ts, for running on your own machine) and HTTP (api/slack.ts, for Vercel)
 * both call these.
 */

export type Respond = (msg: {
  response_type?: 'ephemeral' | 'in_channel';
  replace_original?: boolean;
  text: string;
  blocks?: KnownBlock[];
}) => Promise<unknown>;

export type SlackFile = { id?: string; name?: string; size?: number; url_private_download?: string };

export type MessageEvent = {
  channel: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  channel_type?: string;
  files?: SlackFile[];
};

const errorText = (err: unknown) => `⚠️ ${(err as Error)?.message || 'Something went wrong.'}`;
const stripMention = (text: string) => text.replace(/<@[A-Z0-9]+>/g, '').trim();

async function download(file: SlackFile): Promise<Buffer> {
  if (!file.url_private_download) throw new Error(`I can't download ${file.name}. Is it a Slack-hosted file?`);
  const res = await fetch(file.url_private_download, { headers: { Authorization: `Bearer ${config.slack.botToken}` } });
  if (!res.ok) throw new Error(`Downloading ${file.name} failed (${res.status}). Check the files:read scope.`);
  return Buffer.from(await res.arrayBuffer());
}

async function handleUpload(client: WebClient, team: string, channel: string, user: string, threadTs: string, file: SlackFile) {
  const name = file.name || 'file';
  if (!isSupported(name)) {
    await client.chat.postMessage({ channel, thread_ts: threadTs, text: `I skipped *${name}*: I can read ${SUPPORTED.join(', ')} files.` });
    return;
  }
  if ((file.size || 0) > config.maxFileMb * 1024 * 1024) {
    await client.chat.postMessage({ channel, thread_ts: threadTs, text: `*${name}* is over ${config.maxFileMb} MB, so I skipped it.` });
    return;
  }
  const status = await client.chat.postMessage({ channel, thread_ts: threadTs, text: `⏳ Reading *${name}*…` });
  try {
    const doc = await ingest(team, channel, user, name, await download(file));
    await client.chat.update({ channel, ts: status.ts as string, text: `Indexed ${doc.analysis.title}`, blocks: analysisBlocks(doc) });
  } catch (err) {
    console.error('[upload]', err);
    await client.chat.update({ channel, ts: status.ts as string, text: errorText(err) });
  }
}

// Earlier messages in a thread, so follow-up questions keep their context.
async function threadHistory(client: WebClient, channel: string, threadTs: string, currentTs: string): Promise<Turn[]> {
  const res = await client.conversations.replies({ channel, ts: threadTs, limit: 20 });
  return (res.messages || [])
    .filter((m) => m.ts !== currentTs && m.text)
    .map((m) => ({ role: m.bot_id ? 'assistant' : 'user', text: stripMention(m.text || '') }) as Turn);
}

async function replyToQuestion(client: WebClient, team: string, channel: string, question: string, ts: string, threadTs?: string) {
  if (!question) {
    await client.chat.postMessage({ channel, thread_ts: threadTs || ts, text: HELP });
    return;
  }
  const status = await client.chat.postMessage({ channel, thread_ts: threadTs || ts, text: "🔎 Searching this matter's documents…" });
  try {
    const history = threadTs ? await threadHistory(client, channel, threadTs, ts) : [];
    const res = await answer(team, channel, question, history);
    await client.chat.update({ channel, ts: status.ts as string, text: res.text, blocks: answerBlocks(res.text, res.sources, res.numbering) });
  } catch (err) {
    console.error('[ask]', err);
    await client.chat.update({ channel, ts: status.ts as string, text: errorText(err) });
  }
}

// Files shared in channels, private channels and DMs the bot is in; plus questions in DMs.
export async function onMessage(client: WebClient, team: string, e: MessageEvent) {
  if (e.bot_id) return; // our own uploads and replies
  if (e.subtype === 'file_share' && e.files?.length) {
    for (const file of e.files) await handleUpload(client, team, e.channel, e.user || '', e.thread_ts || e.ts, file);
    return;
  }
  // In a DM every message is a question; in channels the bot answers mentions.
  if (e.channel_type === 'im' && !e.subtype && e.text) {
    await replyToQuestion(client, team, e.channel, e.text.trim(), e.ts, e.thread_ts);
  }
}

export async function onMention(client: WebClient, team: string, e: MessageEvent) {
  await replyToQuestion(client, team, e.channel, stripMention(e.text || ''), e.ts, e.thread_ts);
}

export async function onCommand(
  client: WebClient,
  team: string,
  command: { channel_id: string; user_id: string; text: string },
  respond: Respond
) {
  const channel = command.channel_id;
  const [sub = 'help', ...restWords] = command.text.trim().split(/\s+/);
  const rest = restWords.join(' ');

  try {
    switch (sub.toLowerCase()) {
      case 'brief': {
        const brief = await store.getBrief(channel);
        await respond({ response_type: 'ephemeral', text: brief ? `*Matter brief*\n${brief}` : 'No brief yet. Upload a document to start one.' });
        return;
      }
      case 'docs':
        await respond({ response_type: 'ephemeral', text: docListText(await store.listDocs(channel)) });
        return;
      case 'forget': {
        const doc = (await store.listDocs(channel))[Number(rest) - 1];
        if (!doc) {
          await respond({ response_type: 'ephemeral', text: 'Give the number from `/legal docs`, e.g. `/legal forget 2`.' });
          return;
        }
        await deleteDocVectors(team, doc.id, doc.chunks);
        await store.deleteDoc(doc.id);
        await respond({ response_type: 'in_channel', text: `🗑️ Removed *${doc.analysis.title}* (${doc.fileName}) from this matter. The brief still mentions it until the next upload updates it.` });
        return;
      }
      case 'ask': {
        if (!rest) throw new Error('Add a question, e.g. `/legal ask what is the termination notice period?`');
        await respond({ response_type: 'ephemeral', text: '🔎 Searching…' });
        const res = await answer(team, channel, rest);
        await respond({ response_type: 'in_channel', replace_original: false, text: res.text, blocks: answerBlocks(`*Q:* ${rest}\n\n${res.text}`, res.sources, res.numbering) });
        return;
      }
      case 'draft': {
        if (!rest) throw new Error('Say what to draft, e.g. `/legal draft renewal notice to the landlord under section 4.2`');
        await respond({ response_type: 'ephemeral', text: `✍️ Drafting: _${rest}_ …` });
        const draft = await draftDocument(team, channel, rest);
        const fileName = `${draft.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Draft'}.docx`;
        try {
          await client.files.uploadV2({
            channel_id: channel,
            file: draft.docx,
            filename: fileName,
            title: draft.title,
            initial_comment: `✍️ Draft for <@${command.user_id}>: *${draft.title}*${draft.sources.length ? `\nBased on: ${draft.sources.join(', ')}` : ''}\n_AI draft, review before use._`,
          });
        } catch (err) {
          if ((err as { data?: { error?: string } }).data?.error === 'not_in_channel') {
            throw new Error('I need to be in this channel to upload the draft. Run `/invite @Legal AI` and try again.');
          }
          throw err;
        }
        return;
      }
      case 'schedule': {
        if (!calendarEnabled) throw new Error(CALENDAR_SETUP_HINT);
        if (!rest) throw new Error('Describe the event, e.g. `/legal schedule Client call with Acme on 2026-11-20 at 15:00`');
        const event = await parseScheduleRequest(rest);
        const link = await addEvent(event, `Added from Slack by <@${command.user_id}>.`);
        await respond({
          response_type: 'in_channel',
          text: `📅 Scheduled *${event.title}* on ${event.date}${event.time ? ` at ${event.time}` : ' (all day)'}${link ? ` · <${link}|Open in Google Calendar>` : ''}`,
        });
        return;
      }
      default:
        await respond({ response_type: 'ephemeral', text: HELP });
    }
  } catch (err) {
    console.error('[/legal]', err);
    await respond({ response_type: 'ephemeral', replace_original: false, text: errorText(err) });
  }
}

// Button clicks on the summary card.
export async function onAction(
  client: WebClient,
  action: { actionId: string; value: string; userId: string; channelId: string; threadTs?: string }
) {
  const { channelId: channel, threadTs, userId } = action;
  if (action.actionId === 'show_brief') {
    const brief = await store.getBrief(action.value);
    await client.chat.postEphemeral({ channel: action.value, user: userId, text: brief ? `*Matter brief*\n${brief}` : 'No brief yet.' });
    return;
  }
  if (action.actionId !== 'add_deadlines') return;

  const post = (text: string) => client.chat.postMessage({ channel, thread_ts: threadTs, text });
  const doc = await store.getDoc(action.value);
  if (!doc) return void (await post('That document is no longer indexed.'));
  if (!calendarEnabled) return void (await post(CALENDAR_SETUP_HINT));

  const lines: string[] = [];
  for (const d of doc.analysis.deadlines) {
    try {
      const link = await addEvent(d, `From ${doc.fileName} (${doc.analysis.title}). Added from Slack by <@${userId}>.`);
      lines.push(`✅ ${d.date} ${d.title}${link ? ` · <${link}|open>` : ''}`);
    } catch (err) {
      lines.push(`⚠️ ${d.date} ${d.title}: ${(err as Error).message}`);
    }
  }
  await post(`📅 *Calendar updated from ${doc.analysis.title}*\n${lines.join('\n')}`);
}
