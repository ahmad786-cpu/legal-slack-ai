import 'dotenv/config';

const env = process.env;

function required(name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env (see .env.example).`);
  return value;
}

export const config = {
  slack: {
    botToken: required('SLACK_BOT_TOKEN'),
    appToken: required('SLACK_APP_TOKEN'),
  },
  openai: {
    apiKey: required('OPENAI_API_KEY'),
    embedModel: env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
    embedDimensions: Number(env.OPENAI_EMBED_DIMENSIONS || 1536),
  },
  // Chat, analysis and drafting. Defaults to OpenAI; any OpenAI-compatible endpoint works.
  llm: {
    baseUrl: env.LLM_BASE_URL || undefined,
    apiKey: env.LLM_API_KEY || env.OPENAI_API_KEY || '',
    model: required('LLM_MODEL'),
    // Reads text from images. Must accept image input.
    visionModel: env.VISION_MODEL || env.LLM_MODEL || '',
  },
  pinecone: {
    apiKey: required('PINECONE_API_KEY'),
    index: env.PINECONE_INDEX || 'legal-slack',
    cloud: (env.PINECONE_CLOUD || 'aws') as 'aws' | 'gcp' | 'azure',
    region: env.PINECONE_REGION || 'us-east-1',
  },
  // Optional: without these, calendar buttons explain how to turn scheduling on.
  google: {
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
    serviceAccountFile: env.GOOGLE_SERVICE_ACCOUNT_FILE || '',
    calendarId: env.GOOGLE_CALENDAR_ID || '',
  },
  timezone: env.TIMEZONE || 'UTC',
  dataFile: env.DATA_FILE || './data/store.json',
  maxFileMb: Number(env.MAX_FILE_MB || 25),
};

export const calendarEnabled = Boolean(
  config.google.calendarId && (config.google.serviceAccountJson || config.google.serviceAccountFile)
);
