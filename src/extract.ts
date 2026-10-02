import mammoth from 'mammoth';
import { simpleParser } from 'mailparser';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';

export type Extracted = { text: string; kind: string; attachments: { name: string; bytes: Buffer; mimeType: string }[] };

// Reads text from an image; injected so this module stays testable without an API key.
export type ImageReader = (bytes: Buffer, mimeType: string) => Promise<string>;

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export const SUPPORTED = ['docx', 'pdf', 'eml', 'txt', 'md', ...Object.keys(IMAGE_TYPES)];

export const extension = (name: string) => name.toLowerCase().split('.').pop() || '';

export function isSupported(name: string): boolean {
  return SUPPORTED.includes(extension(name));
}

export async function extract(name: string, bytes: Buffer, readImage: ImageReader): Promise<Extracted> {
  const ext = extension(name);
  if (ext === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return { text: value, kind: 'Word document', attachments: [] };
  }
  if (ext === 'pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    if (text.trim().length > 40) return { text, kind: 'PDF', attachments: [] };
    // A scanned PDF has no text layer; say so rather than indexing nothing.
    throw new Error('This PDF has no selectable text (it is probably a scan). Upload the pages as images instead.');
  }
  if (ext === 'eml') return extractEmail(bytes);
  if (ext === 'txt' || ext === 'md') return { text: bytes.toString('utf8'), kind: 'Text file', attachments: [] };
  if (IMAGE_TYPES[ext]) {
    return { text: await readImage(bytes, IMAGE_TYPES[ext]), kind: 'Image (text read by AI)', attachments: [] };
  }
  throw new Error(`Unsupported file type ".${ext}". Supported: ${SUPPORTED.join(', ')}.`);
}

async function extractEmail(bytes: Buffer): Promise<Extracted> {
  const mail = await simpleParser(bytes);
  const addresses = (v: typeof mail.to) => (Array.isArray(v) ? v.map((a) => a.text).join(', ') : v?.text || '');
  const header = [
    `Subject: ${mail.subject || '(no subject)'}`,
    `From: ${addresses(mail.from)}`,
    `To: ${addresses(mail.to)}`,
    mail.cc ? `Cc: ${addresses(mail.cc)}` : '',
    `Date: ${mail.date ? mail.date.toISOString() : 'unknown'}`,
  ].filter(Boolean);
  const body = mail.text || (mail.html ? String(mail.html).replace(/<[^>]+>/g, ' ') : '');
  const attachments = mail.attachments
    .filter((a) => a.filename && isSupported(a.filename))
    .map((a) => ({ name: a.filename as string, bytes: a.content, mimeType: a.contentType }));
  const skipped = mail.attachments.filter((a) => !a.filename || !isSupported(a.filename)).map((a) => a.filename || 'unnamed');
  const notes = [
    attachments.length ? `Attachments processed separately: ${attachments.map((a) => a.name).join(', ')}` : '',
    skipped.length ? `Attachments not supported: ${skipped.join(', ')}` : '',
  ].filter(Boolean);
  return { text: [...header, '', body.trim(), '', ...notes].join('\n'), kind: 'Email', attachments };
}
