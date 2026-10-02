import bolt from '@slack/bolt';
import { config } from './config.js';
import { onAction, onCommand, onMention, onMessage, type MessageEvent, type Respond } from './handlers.js';

const { App, LogLevel } = bolt;

// Socket Mode: the bot connects out to Slack, so it needs no public URL. For running on your own
// machine; the Vercel deployment receives the same events over HTTP instead (api/slack.ts).
export function createSocketApp() {
  if (!config.slack.appToken) {
    throw new Error('Missing SLACK_APP_TOKEN in .env. It is needed to run the bot on your own machine (Socket Mode).');
  }
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  app.event('message', async ({ event, client, context }) => {
    await onMessage(client, context.teamId || 'default', event as unknown as MessageEvent);
  });

  app.event('app_mention', async ({ event, client, context }) => {
    await onMention(client, context.teamId || 'default', event as unknown as MessageEvent);
  });

  app.command('/legal', async ({ command, ack, respond, client, context }) => {
    await ack();
    await onCommand(client, context.teamId || 'default', command, respond as Respond);
  });

  app.action(/^(add_deadlines|show_brief)$/, async ({ ack, body, action, client }) => {
    await ack();
    await onAction(client, {
      actionId: 'action_id' in action ? action.action_id : '',
      value: 'value' in action ? action.value || '' : '',
      userId: body.user.id,
      channelId: body.channel?.id || '',
      threadTs: 'message' in body ? body.message?.thread_ts || body.message?.ts : undefined,
    });
  });

  return app;
}
