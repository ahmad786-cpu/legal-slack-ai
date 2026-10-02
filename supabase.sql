-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
-- The bot uses the service role key. Row level security is on with no policies, so the public
-- (anon) key cannot read or change these tables.

create table if not exists legal_docs (
  id text primary key,
  channel text not null,
  uploaded_at bigint not null,
  data jsonb not null
);
create index if not exists legal_docs_channel_idx on legal_docs (channel, uploaded_at desc);

create table if not exists legal_briefs (
  channel text primary key,
  text text not null,
  updated_at bigint not null
);

alter table legal_docs enable row level security;
alter table legal_briefs enable row level security;
