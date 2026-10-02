import crypto from 'node:crypto';
import { readImage } from './ai.js';
import { analyzeDocument, updateBrief, type Analysis } from './analyze.js';
import { chunkText } from './chunk.js';
import { extract } from './extract.js';
import { store, type DocRecord } from './store.js';
import { upsertChunks } from './vectors.js';

export type Ingested = DocRecord & { attachments: Ingested[] };

/*
 * The pipeline behind every upload: extract text -> chunk -> embed into Pinecone ->
 * AI analysis -> update the channel's matter brief -> remember the document.
 * Email attachments go through the same pipeline as documents of their own.
 */
export async function ingest(
  team: string,
  channel: string,
  uploadedBy: string,
  fileName: string,
  bytes: Buffer
): Promise<Ingested> {
  const { text, kind, attachments } = await extract(fileName, bytes, readImage);
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error(`No readable text was found in ${fileName}.`);

  const id = crypto.randomUUID();
  await upsertChunks(team, id, channel, fileName, chunks);
  const analysis: Analysis = await analyzeDocument(fileName, text);
  await store.saveBrief(channel, await updateBrief(await store.getBrief(channel), fileName, analysis));

  const doc: DocRecord = { id, channel, fileName, kind, uploadedBy, uploadedAt: Date.now(), chunks: chunks.length, analysis };
  await store.saveDoc(doc);

  const children: Ingested[] = [];
  for (const a of attachments) {
    try {
      children.push(await ingest(team, channel, uploadedBy, a.name, a.bytes));
    } catch (err) {
      console.error(`[ingest] attachment ${a.name} failed:`, (err as Error).message);
    }
  }
  return { ...doc, attachments: children };
}
