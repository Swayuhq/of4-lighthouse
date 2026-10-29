// Lighthouse keeps books, it does not look and guess. A message is written once,
// and every change to it is a new event row, so the counts line is a sum the owner can check.
import { bigserial, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Facts } from '../facts';

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
  },
  t => [primaryKey({ columns: [t.tenantId, t.contentId] })],
);

export const event = pgTable('event', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  contentId: text('content_id').notNull(),
  /** arrived, waiting, answered, spam or sent. The newest one that is not arrived is the state. */
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
