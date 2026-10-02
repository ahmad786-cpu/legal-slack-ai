import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import type { Analysis } from './analyze.js';

// What is not vectors: the document list and each channel's matter brief.
// Supabase when configured (required on Vercel, whose functions keep no files); otherwise a JSON file.
export type DocRecord = {
  id: string;
  channel: string;
  fileName: string;
  kind: string;
  uploadedBy: string;
  uploadedAt: number;
  chunks: number;
  analysis: Analysis;
};

type Store = {
  saveDoc(doc: DocRecord): Promise<void>;
  getDoc(id: string): Promise<DocRecord | null>;
  deleteDoc(id: string): Promise<void>;
  listDocs(channel: string): Promise<DocRecord[]>;
  getBrief(channel: string): Promise<string>;
  saveBrief(channel: string, text: string): Promise<void>;
};

function fileStore(): Store {
  type Db = { docs: Record<string, DocRecord>; briefs: Record<string, { text: string; updatedAt: number }> };
  const file = path.resolve(config.dataFile);
  let db: Db = { docs: {}, briefs: {} };
  if (fs.existsSync(file)) db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  const persist = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(db, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  };
  return {
    async saveDoc(doc) { db.docs[doc.id] = doc; persist(); },
    async getDoc(id) { return db.docs[id] || null; },
    async deleteDoc(id) { delete db.docs[id]; persist(); },
    async listDocs(channel) {
      return Object.values(db.docs).filter((d) => d.channel === channel).sort((a, b) => b.uploadedAt - a.uploadedAt);
    },
    async getBrief(channel) { return db.briefs[channel]?.text || ''; },
    async saveBrief(channel, text) { db.briefs[channel] = { text, updatedAt: Date.now() }; persist(); },
  };
}

// Tables come from supabase.sql. Rows keep the whole record in `data`.
function supabaseStore(): Store {
  const db = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const check = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data;
  };
  return {
    async saveDoc(doc) {
      check(await db.from('legal_docs').upsert({ id: doc.id, channel: doc.channel, uploaded_at: doc.uploadedAt, data: doc }));
    },
    async getDoc(id) {
      const row = check(await db.from('legal_docs').select('data').eq('id', id).maybeSingle());
      return (row?.data as DocRecord) || null;
    },
    async deleteDoc(id) {
      check(await db.from('legal_docs').delete().eq('id', id));
    },
    async listDocs(channel) {
      const rows = check(await db.from('legal_docs').select('data').eq('channel', channel).order('uploaded_at', { ascending: false }));
      return (rows || []).map((r) => r.data as DocRecord);
    },
    async getBrief(channel) {
      const row = check(await db.from('legal_briefs').select('text').eq('channel', channel).maybeSingle());
      return (row?.text as string) || '';
    },
    async saveBrief(channel, text) {
      check(await db.from('legal_briefs').upsert({ channel, text, updated_at: Date.now() }));
    },
  };
}

export const store: Store = config.supabase.url && config.supabase.serviceKey ? supabaseStore() : fileStore();
