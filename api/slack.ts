import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';

/*
 * Slack's Events API, slash command and interactivity endpoint for Vercel.
 * Slack expects an answer within 3 seconds, so this verifies the request, answers at once, and
 * does the work afterwards with waitUntil (up to the function's maxDuration in vercel.json).
 * Only light modules are imported up front so cold starts stay fast; the bot is loaded on demand.
 */

function verified(headers: Headers, raw: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET || '';
  const timestamp = headers.get('x-slack-request-timestamp') || '';
  const signature = headers.get('x-slack-signature') || '';
  if (!secret || !timestamp || !signature) return false;
  // Reject replays of old requests.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;
  const expected = `v0=${crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Runs after the response is sent; errors are logged, never thrown to Slack.
function background(task: () => Promise<unknown>) {
  waitUntil(task().catch((err) => console.error('[slack]', err)));
}

const ok = () => new Response(null, { status: 200 });

async function bot() {
  const [{ WebClient }, handlers] = await Promise.all([import('@slack/web-api'), import('../src/handlers.js')]);
  return { client: new WebClient(process.env.SLACK_BOT_TOKEN), ...handlers };
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (!verified(request.headers, raw)) return new Response('Invalid Slack signature', { status: 401 });

  // Slack retries when the first answer was slow; the first delivery is still being processed.
  if (request.headers.get('x-slack-retry-num')) return ok();

  if ((request.headers.get('content-type') || '').includes('application/json')) {
    const body = JSON.parse(raw);
    if (body.type === 'url_verification') return Response.json({ challenge: body.challenge });
    if (body.type === 'event_callback') {
      const event = body.event || {};
      const team: string = body.team_id || 'default';
      background(async () => {
        const { client, onMessage, onMention } = await bot();
        if (event.type === 'app_mention') await onMention(client, team, event);
        else if (event.type === 'message') await onMessage(client, team, event);
      });
    }
    return ok();
  }

  const form = new URLSearchParams(raw);

  if (form.get('command')) {
    const responseUrl = form.get('response_url') || '';
    const respond = async (msg: object) => {
      await fetch(responseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
    };
    background(async () => {
      const { client, onCommand } = await bot();
      await onCommand(
        client,
        form.get('team_id') || 'default',
        { channel_id: form.get('channel_id') || '', user_id: form.get('user_id') || '', text: form.get('text') || '' },
        respond
      );
    });
    return ok();
  }

  const payload = form.get('payload');
  if (payload) {
    const p = JSON.parse(payload);
    if (p.type === 'block_actions') {
      for (const action of p.actions || []) {
        background(async () => {
          const { client, onAction } = await bot();
          await onAction(client, {
            actionId: action.action_id,
            value: action.value || '',
            userId: p.user?.id || '',
            channelId: p.channel?.id || '',
            threadTs: p.message?.thread_ts || p.message?.ts,
          });
        });
      }
    }
    return ok();
  }

  return new Response('Unsupported request', { status: 400 });
}

// Opening the URL in a browser shows that the deployment is up.
export function GET(): Response {
  return new Response('Legal AI Slack endpoint is running. Point Slack Event Subscriptions, Slash Commands and Interactivity here.', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
