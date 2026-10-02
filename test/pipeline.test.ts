import assert from 'node:assert/strict';
import { test } from 'node:test';

// Dummy settings so modules that read config load without real keys; nothing here calls an API.
Object.assign(process.env, {
  SLACK_BOT_TOKEN: 'xoxb-test', SLACK_APP_TOKEN: 'xapp-test', OPENAI_API_KEY: 'sk-test',
  LLM_MODEL: 'test-model', PINECONE_API_KEY: 'pc-test', DATA_FILE: './data/test-store.json',
});

const { extract, isSupported } = await import('../src/extract.js');
const { chunkText } = await import('../src/chunk.js');
const { toDocx } = await import('../src/draft.js');

const noImages = async () => { throw new Error('image reader should not be called'); };

// A one-page PDF with a real text layer, written by hand so the test needs no fixtures.
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

test('reads a Word document (round trip through the DOCX generator)', async () => {
  const docx = await toDocx('Notice', '# Notice of Renewal\n## Terms\nThe tenant must give **30 days** notice before 2026-06-01.\n- Clause 4.2 applies');
  const out = await extract('notice.docx', docx, noImages);
  assert.equal(out.kind, 'Word document');
  assert.match(out.text, /Notice of Renewal/);
  assert.match(out.text, /30 days notice before 2026-06-01/);
  assert.match(out.text, /Clause 4.2 applies/);
  assert.match(out.text, /not legal advice/); // the draft disclaimer is in the file
});

test('reads a PDF text layer', async () => {
  const out = await extract('lease.pdf', tinyPdf('This Lease Agreement is made between Acme Ltd and Jane Doe on 1 March 2026.'), noImages);
  assert.equal(out.kind, 'PDF');
  assert.match(out.text, /Lease Agreement is made between Acme Ltd and Jane Doe/);
});

test('rejects a PDF without text (a scan) with a helpful message', async () => {
  await assert.rejects(extract('scan.pdf', tinyPdf(''), noImages), /no selectable text/);
});

test('reads an email and hands back its supported attachments', async () => {
  const attachment = Buffer.from('Settlement offer: 25,000 USD, open until 2026-11-30.').toString('base64');
  const eml = [
    'From: Opposing Counsel <counsel@example.com>',
    'To: Legal Team <legal@example.com>',
    'Subject: Settlement proposal',
    'Date: Mon, 05 Oct 2026 09:30:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please find our proposal attached. We need a response by 2026-11-30.',
    '--b1',
    'Content-Type: text/plain; name="offer.txt"',
    'Content-Disposition: attachment; filename="offer.txt"',
    'Content-Transfer-Encoding: base64',
    '',
    attachment,
    '--b1',
    'Content-Type: application/zip; name="bundle.zip"',
    'Content-Disposition: attachment; filename="bundle.zip"',
    'Content-Transfer-Encoding: base64',
    '',
    'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
    '--b1--',
  ].join('\r\n');
  const out = await extract('proposal.eml', Buffer.from(eml), noImages);
  assert.equal(out.kind, 'Email');
  assert.match(out.text, /Subject: Settlement proposal/);
  assert.match(out.text, /From: .*counsel@example.com/);
  assert.match(out.text, /response by 2026-11-30/);
  assert.match(out.text, /Attachments processed separately: offer.txt/);
  assert.match(out.text, /Attachments not supported: bundle.zip/);
  assert.equal(out.attachments.length, 1);
  assert.match(out.attachments[0].bytes.toString(), /25,000 USD/);
});

test('sends images to the image reader', async () => {
  const out = await extract('letter.PNG', Buffer.from([1, 2, 3]), async (_b, mime) => `read as ${mime}`);
  assert.equal(out.text, 'read as image/png');
});

test('knows which files it supports', () => {
  assert.ok(isSupported('a.DOCX') && isSupported('b.pdf') && isSupported('c.eml') && isSupported('d.jpeg'));
  assert.ok(!isSupported('e.zip') && !isSupported('noextension'));
});

test('chunks long text with overlap and without losing content', () => {
  const paragraphs = Array.from({ length: 60 }, (_, i) => `Clause ${i + 1}. The parties agree to term number ${i + 1} in full.`);
  const text = paragraphs.join('\n\n');
  const chunks = chunkText(text, 800, 150);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((c) => c.length <= 800));
  for (const p of paragraphs) assert.ok(chunks.some((c) => c.includes(p)), `missing: ${p}`);
  assert.deepEqual(chunkText('   '), []);
  assert.deepEqual(chunkText('short'), ['short']);
});
