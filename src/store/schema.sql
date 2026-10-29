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
