-- The same three tables as schema.ts. Run with: pnpm db:setup
create table if not exists business (
  tenant_id uuid primary key,
  name text not null,
  owner_names text[] not null default '{}'
);

create table if not exists message (
  tenant_id uuid not null,
  content_id text not null,
  thread text not null,
  platform text not null,
  author text not null,
  received_at text not null,
  body text not null,
  stars integer,
  primary key (tenant_id, content_id)
);

create table if not exists event (
  id bigserial primary key,
  tenant_id uuid not null,
  content_id text not null,
  kind text not null check (kind in ('arrived', 'waiting', 'answered', 'spam', 'sent')),
  reply_text text,
  at timestamptz not null default now(),
  foreign key (tenant_id, content_id) references message (tenant_id, content_id) on delete cascade
);

-- What the reader agent found in each message. Facts only, in a fixed shape.
create table if not exists message_facts (
  tenant_id uuid not null,
  content_id text not null,
  facts jsonb not null,
  model text not null,
  at timestamptz not null default now(),
  primary key (tenant_id, content_id),
  foreign key (tenant_id, content_id) references message (tenant_id, content_id) on delete cascade
);

-- Every model call books its cost here. A call first reserves its largest possible cost, then books the real one.
create table if not exists model_call (
  id bigserial primary key,
  tenant_id uuid not null,
  agent text not null,
  model text not null,
  reserved_usd numeric(10, 6) not null,
  cost_usd numeric(10, 6),
  outcome text not null default 'running',
  at timestamptz not null default now()
);

-- The newest themes the insights agent found, each tied to the messages that show it.
create table if not exists insight (
  tenant_id uuid primary key,
  themes jsonb not null,
  at timestamptz not null default now()
);

-- One row per channel the owner connected. A broken channel makes the counts unknown, never zero.
-- No platform token is stored yet: sample channels need none, and a live token waits for its own design.
create table if not exists connection (
  tenant_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'instagram', 'facebook', 'google_reviews')),
  status text not null check (status in ('connected', 'broken')),
  cursor integer not null default 0,
  problem text,
  connected_at timestamptz not null default now(),
  last_pull_at timestamptz,
  primary key (tenant_id, channel)
);

-- What the provider that read a message needs to reply to it. Added 4 Nov 2026 with the connector gateway.
alter table message add column if not exists reply_ref text;

-- One row for every call a lead or the owner makes through the connector gateway, written at the call.
create table if not exists connector_call (
  id bigserial primary key,
  tenant_id uuid not null,
  lead text not null,
  channel text not null,
  action text not null,
  outcome text not null check (outcome in ('refused', 'approved', 'declined', 'done', 'failed')),
  provider text,
  note text,
  at timestamptz not null default now()
);

-- Where each message lives on its platform, for the inbox link. Added 4 Nov 2026.
alter table message add column if not exists link text;

-- A lead's reply kept for the owner, and the gateway outcome for it. Added 4 Nov 2026.
alter table event drop constraint if exists event_kind_check;
alter table event add constraint event_kind_check check (kind in ('arrived', 'waiting', 'answered', 'spam', 'sent', 'drafted'));
alter table connector_call drop constraint if exists connector_call_outcome_check;
alter table connector_call add constraint connector_call_outcome_check check (outcome in ('refused', 'approved', 'declined', 'held', 'done', 'failed'));

-- One row for every event a provider pushed to us. The unique event id drops a delivery we already took.
-- Ids and times only, never the message text. Added 5 Nov 2026 with the Zernio webhook.
create table if not exists push_event (
  id bigserial primary key,
  tenant_id uuid not null,
  provider text not null,
  event_id text not null,
  kind text not null,
  channel text,
  content_id text,
  outcome text not null check (outcome in ('stored', 'already had', 'not connected', 'test', 'skipped', 'refused')),
  sent_at timestamptz,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- The comment history. A customer's text vanishes 30 days after the owner's last reply; who, when and where stay.
-- Decided by Sujit on 5 Nov 2026.
alter table message add column if not exists vanished_at timestamptz;
