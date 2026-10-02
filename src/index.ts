// Runs the bot on your own machine over Socket Mode. (On Vercel, api/slack.ts handles Slack instead.)
// Modules are loaded inside the try so a missing setting prints one clear line instead of a stack trace.
try {
  const { calendarEnabled, config } = await import('./config.js');
  const { createSocketApp } = await import('./slack.js');
  const { ensureIndex } = await import('./vectors.js');

  await ensureIndex();
  const app = createSocketApp();
  const auth = await app.client.auth.test();
  await app.start();
  console.log(`Legal AI is running in Slack workspace "${auth.team}" as @${auth.user}`);
  console.log(`  models:   chat ${config.llm.model}, images ${config.llm.visionModel}, embeddings ${config.embed.model} (${config.embed.provider})`);
  console.log(`  pinecone: index "${config.pinecone.index}"`);
  console.log(`  storage:  ${config.supabase.url ? 'Supabase' : `local file ${config.dataFile}`}`);
  console.log(`  calendar: ${calendarEnabled ? config.google.calendarId : 'off (set GOOGLE_CALENDAR_ID and a service account)'}`);
} catch (err) {
  console.error('Could not start:', (err as Error).message || err);
  process.exit(1);
}
