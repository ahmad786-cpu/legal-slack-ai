// Writes fictional sample documents for trying the bot: npx tsx samples/make-samples.ts
import fs from 'node:fs';
Object.assign(process.env, { SLACK_BOT_TOKEN: 'x', SLACK_APP_TOKEN: 'x', OPENAI_API_KEY: 'x', LLM_MODEL: 'x', PINECONE_API_KEY: 'x' });
const { toDocx } = await import('../src/draft.js');

const lease = `# Commercial Lease Agreement (Sample)
## Parties
This Lease is made on 1 March 2026 between **Northwind Properties Ltd** ("Landlord") and **Bluebird Design Studio LLC** ("Tenant"). All names are fictional.
## 1. Premises
Unit 4B, 220 Harbour Road, used as design studio offices.
## 2. Term
The term is 24 months from 1 March 2026 to 28 February 2028.
## 3. Rent
Monthly rent is 4,500 USD, payable in advance on the 1st of each month. Late payment after the 5th incurs a 5% fee.
## 4. Renewal
4.1 The Tenant may renew for a further 12 months.
4.2 To renew, the Tenant must give written notice no later than 1 December 2027.
## 5. Security Deposit
A deposit of 9,000 USD is due on signing and returned within 30 days after the lease ends, less lawful deductions.
## 6. Repairs
The Tenant is responsible for all repairs, including structural repairs and the roof.
## 7. Termination
The Landlord may terminate with 30 days' notice for any reason. The Tenant may not terminate early.
## 8. Insurance
The Tenant must hold public liability insurance of at least 1,000,000 USD and send proof by 15 March 2026.`;
fs.writeFileSync('samples/sample-lease.docx', await toDocx('Commercial Lease Agreement (Sample)', lease));

const offer = Buffer.from('Without prejudice settlement offer (sample)\nNorthwind Properties offers to waive 2 months of late fees (900 USD) if all arrears are paid by 20 November 2026.\nThis offer expires on 20 November 2026 at 17:00.').toString('base64');
fs.writeFileSync('samples/sample-email.eml', [
  'From: Maya Chen <maya.chen@northwind.example>',
  'To: Legal Team <legal@bluebird.example>',
  'Subject: Rent arrears and settlement offer (sample)',
  'Date: Mon, 05 Oct 2026 09:30:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hello,\n\nThe September rent is unpaid. Please pay the arrears of 4,500 USD by 15 October 2026 or we will issue a formal notice.\nOur settlement offer is attached.\n\nMaya Chen\nNorthwind Properties (fictional)',
  '--b1',
  'Content-Type: text/plain; name="settlement-offer.txt"',
  'Content-Disposition: attachment; filename="settlement-offer.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  offer,
  '--b1--',
].join('\r\n'));
console.log('Wrote samples/sample-lease.docx and samples/sample-email.eml');
