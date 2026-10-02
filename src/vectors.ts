import { Pinecone } from '@pinecone-database/pinecone';
import { embed } from './ai.js';
import { config } from './config.js';

export type ChunkMeta = {
  docId: string;
  channel: string;
  fileName: string;
  chunk: number;
  text: string;
};

const pc = new Pinecone({ apiKey: config.pinecone.apiKey });
const index = () => pc.index<ChunkMeta>(config.pinecone.index);

// Creates the serverless index on first run; does nothing if it already exists.
export async function ensureIndex() {
  await pc.createIndex({
    name: config.pinecone.index,
    dimension: config.embed.dimensions,
    metric: 'cosine',
    spec: { serverless: { cloud: config.pinecone.cloud, region: config.pinecone.region } },
    waitUntilReady: true,
    suppressConflicts: true,
  });
}

// One namespace per Slack workspace; each channel is a matter, kept apart by a metadata filter.
export async function upsertChunks(team: string, docId: string, channel: string, fileName: string, chunks: string[]) {
  const vectors = await embed(chunks, 'passage');
  const records = vectors.map((values, i) => ({
    id: `${docId}#${i}`,
    values,
    metadata: { docId, channel, fileName, chunk: i, text: chunks[i] },
  }));
  for (let i = 0; i < records.length; i += 100) {
    await index().upsert({ records: records.slice(i, i + 100), namespace: team });
  }
}

export async function search(team: string, channel: string, query: string, topK = config.limits.searchTopK): Promise<(ChunkMeta & { score: number })[]> {
  const [vector] = await embed([query], 'query');
  const res = await index().query({
    vector,
    topK,
    includeMetadata: true,
    filter: { channel: { $eq: channel } },
    namespace: team,
  });
  return (res.matches || [])
    .filter((m) => m.metadata)
    .map((m) => ({ ...(m.metadata as ChunkMeta), score: m.score ?? 0 }));
}

// Deletes by id ("<docId>#<n>") rather than by metadata filter, which not every index type supports.
export async function deleteDocVectors(team: string, docId: string, chunks: number) {
  const ids = Array.from({ length: chunks }, (_, i) => `${docId}#${i}`);
  for (let i = 0; i < ids.length; i += 1000) {
    await index().deleteMany({ ids: ids.slice(i, i + 1000), namespace: team });
  }
}
