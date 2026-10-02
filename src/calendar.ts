import fs from 'node:fs';
import { calendar } from '@googleapis/calendar';
import { GoogleAuth } from 'google-auth-library';
import { chatJson } from './ai.js';
import type { Deadline } from './analyze.js';
import { calendarEnabled, config } from './config.js';

// Events go to one shared calendar via a Google service account. Share that calendar with the
// service account's email ("Make changes to events") so it can add events.
function client() {
  const credentials = JSON.parse(
    config.google.serviceAccountJson || fs.readFileSync(config.google.serviceAccountFile, 'utf8')
  );
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/calendar.events'] });
  return calendar({ version: 'v3', auth });
}

export const CALENDAR_SETUP_HINT =
  'Calendar scheduling is not set up. Add GOOGLE_CALENDAR_ID and a service account (GOOGLE_SERVICE_ACCOUNT_FILE) to .env; see the README.';

function addMinutes(date: string, time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  // Keep the event on the same day rather than spilling into an invalid hour.
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${date}T${hh}:${mm}:00`;
}

export async function addEvent(d: Deadline & { durationMinutes?: number }, description: string): Promise<string> {
  if (!calendarEnabled) throw new Error(CALENDAR_SETUP_HINT);
  const timed = d.time && /^\d{2}:\d{2}$/.test(d.time);
  const nextDay = new Date(`${d.date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const res = await client().events.insert({
    calendarId: config.google.calendarId,
    requestBody: {
      summary: d.title,
      description: `${d.detail}\n\n${description}`.trim(),
      ...(timed
        ? {
            start: { dateTime: `${d.date}T${d.time}:00`, timeZone: config.timezone },
            end: { dateTime: addMinutes(d.date, d.time as string, d.durationMinutes || 30), timeZone: config.timezone },
          }
        : { start: { date: d.date }, end: { date: nextDay.toISOString().slice(0, 10) } }),
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 24 * 60 }, { method: 'email', minutes: 3 * 24 * 60 }] },
    },
  });
  return res.data.htmlLink || '';
}

// Turns "client call with Acme next Tuesday 3pm for an hour" into an event.
export async function parseScheduleRequest(text: string): Promise<Deadline & { durationMinutes?: number }> {
  const now = new Date().toISOString();
  const parsed = await chatJson<Deadline & { durationMinutes?: number; error?: string }>(
    [
      `Convert a scheduling request into one calendar event. Now is ${now}; timezone ${config.timezone}.`,
      'Answer with JSON: { "date": "YYYY-MM-DD", "time": "HH:MM" (24h, omit for all-day), "durationMinutes": number, "title": short, "detail": one line }.',
      'If no date can be worked out, answer { "error": "what is missing" }.',
    ].join('\n'),
    text
  );
  if (parsed.error || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '')) {
    throw new Error(parsed.error || 'I could not work out a date from that. Try "/legal schedule Hearing on 2026-11-20 at 10:00".');
  }
  return parsed;
}
