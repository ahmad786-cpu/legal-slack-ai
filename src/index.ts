// Modules are loaded inside the try so a missing setting prints one clear line instead of a stack trace.
try {
  const { calendarEnabled, config } = await import('./config.js');
  const { app, identify } = await import('./slack.js');
  const { ensureIndex } = await import('./vectors.js');

  await ensureIndex();
  const auth = await identify();
  await app.start();
  console.log(`Legal AI is running in Slack workspace "${auth.team}" as @${auth.user}`);
  console.log(`  models:   chat ${config.llm.model}, images ${config.llm.visionModel}, embeddings ${config.embed.model} (${config.embed.provider})`);
  console.log(`  pinecone: index "${config.pinecone.index}"`);
  console.log(`  calendar: ${calendarEnabled ? config.google.calendarId : 'off (set GOOGLE_CALENDAR_ID and a service account)'}`);
} catch (err) {
  console.error('Could not start:', (err as Error).message || err);
  process.exit(1);
}
