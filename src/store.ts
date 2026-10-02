import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { Analysis } from './analyze.js';

// Small JSON store for what is not vectors: the document list, each channel's matter brief,
// and deadlines waiting for a calendar click. One bot process owns the file.
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

type Db = {
  docs: Record<string, DocRecord>;
  briefs: Record<string, { text: string; updatedAt: number }>;
};

const file = path.resolve(config.dataFile);
let db: Db = { docs: {}, briefs: {} };
if (fs.existsSync(file)) db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) };

function persist() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(db, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

export const store = {
  saveDoc(doc: DocRecord) {
    db.docs[doc.id] = doc;
    persist();
  },
  getDoc(id: string): DocRecord | null {
    return db.docs[id] || null;
  },
  deleteDoc(id: string) {
    delete db.docs[id];
    persist();
  },
  listDocs(channel: string): DocRecord[] {
    return Object.values(db.docs)
      .filter((d) => d.channel === channel)
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
  },
  getBrief(channel: string): string {
    return db.briefs[channel]?.text || '';
  },
  saveBrief(channel: string, text: string) {
    db.briefs[channel] = { text, updatedAt: Date.now() };
    persist();
  },
};
