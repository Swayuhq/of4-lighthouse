// Lighthouse keeps books, it does not look and guess. A message is written once,
// and every change to it is a new event row, so the counts line is a sum the owner can check.
import { bigserial, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { Facts } from '../facts';
import type { Theme } from '../agents/insights';
import type { Channel, ConnectionStatus } from '../connectors';

export const business = pgTable('business', {
  tenantId: uuid('tenant_id').primaryKey(),
  name: text('name').notNull(),
  /** Which author names are the owner. Their lines teach the tone and are never counted. */
  ownerNames: text('owner_names').array().notNull().default([]),
});

export const message = pgTable(
  'message',
  {
    tenantId: uuid('tenant_id').notNull(),
    /** Made from the content, so the same message from two files is one row. */
    contentId: text('content_id').notNull(),
    /** The conversation it came from: one chat export, one reviews file, one watched profile. */
    thread: text('thread').notNull(),
    platform: text('platform').notNull(),
    author: text('author').notNull(),
    receivedAt: text('received_at').notNull(),
    body: text('body').notNull(),
    stars: integer('stars'),
    /** What the provider that read it needs to reply. */
    replyRef: text('reply_ref'),
    link: text('link'),
  },
  t => [primaryKey({ columns: [t.tenantId, t.contentId] })],
);

export const event = pgTable('event', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  contentId: text('content_id').notNull(),
  /** arrived, waiting, answered, spam, sent or drafted. The newest status event is the state; drafted holds a lead's reply. */
  kind: text('kind').notNull(),
  replyText: text('reply_text'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

/** What the reader agent found in a message. Facts only, in a fixed shape. */
export const messageFacts = pgTable(
  'message_facts',
  {
    tenantId: uuid('tenant_id').notNull(),
    contentId: text('content_id').notNull(),
    facts: jsonb('facts').$type<Facts>().notNull(),
    model: text('model').notNull(),
  },
  t => [primaryKey({ columns: [t.tenantId, t.contentId] })],
);

/** The newest themes the insights agent found, each tied to the messages that show it. */
export const insight = pgTable('insight', {
  tenantId: uuid('tenant_id').primaryKey(),
  themes: jsonb('themes').$type<Theme[]>().notNull(),
});

/** One row per channel the owner connected. No platform token is stored yet. */
export const connection = pgTable(
  'connection',
  {
    tenantId: uuid('tenant_id').notNull(),
    channel: text('channel').$type<Channel>().notNull(),
    status: text('status').$type<ConnectionStatus>().notNull(),
    /** How far the sample feed has been read. A live channel will keep the platform's own cursor here. */
    cursor: integer('cursor').notNull().default(0),
    /** Why the channel is broken, in words the owner understands. */
    problem: text('problem'),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastPullAt: timestamp('last_pull_at', { withTimezone: true }),
  },
  t => [primaryKey({ columns: [t.tenantId, t.channel] })],
);

/** One row for every call through the connector gateway, written at the call. */
export const connectorCall = pgTable('connector_call', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  lead: text('lead').notNull(),
  channel: text('channel').notNull(),
  action: text('action').notNull(),
  outcome: text('outcome').notNull(),
  provider: text('provider'),
  note: text('note'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row for every event a provider pushed to us. The unique event id drops a delivery we already took.
 * It holds ids and times only, never the message text, which lives once in the message table.
 */
export const pushEvent = pgTable('push_event', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  kind: text('kind').notNull(),
  channel: text('channel'),
  contentId: text('content_id'),
  /** stored, already had, not connected, test, skipped or refused. */
  outcome: text('outcome').notNull(),
  /** When the provider made the event. */
  sentAt: timestamp('sent_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.provider, t.eventId)]);
