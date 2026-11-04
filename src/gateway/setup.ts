// The one gateway the app and the lead agents share: the Cedar rules, the route table and the ledger.
// Two doors with the same rules. The owner's Send button is the owner's approval. A lead agent's reply waits for the owner.
import { createGateway, type CallRequest, type GatewayDeps, type LedgerRow } from './gateway';
import { readPolicies } from './policy';
import { composio, own, zernioProvider } from './providers';

/**
 * Which provider serves each channel and action. Measured on 4 Nov 2026 on the test business: both providers read the
 * same comments; Zernio names every author, Composio missed 4 of 12 on Facebook; Composio's Facebook reply worked 5 of 5.
 * One line moves a channel. The final choice is Dhruv's.
 */
export const ROUTES: GatewayDeps['routes'] = {
  'facebook:read': 'zernio',
  'facebook:reply': 'composio',
  'instagram:read': 'zernio',
  'instagram:reply': 'zernio',
  'google_reviews:read': 'zernio',
  'google_reviews:reply': 'zernio',
  'whatsapp:reply': 'own',
};

let policies: GatewayDeps['policies'] | undefined;
const rules = () => (policies ??= readPolicies());

// Imported when the first row is written, because the store imports the channel list that imports this file.
async function record(row: LedgerRow) {
  const { saveCall } = await import('../store/db');
  await saveCall(row);
}

/** Keeps a lead's reply as a draft on the message it answers, for the owner to check and send. */
async function hold({ channel, args }: CallRequest): Promise<'held'> {
  const { holdReply } = await import('../store/db');
  if (!(await holdReply(channel, String(args.ref ?? ''), String(args.text ?? '')))) throw new Error('no inbox message matches this comment');
  return 'held';
}

function gateway(askOwner: GatewayDeps['askOwner']) {
  return createGateway({ policies: rules(), routes: ROUTES, providers: { composio, zernio: zernioProvider, own }, askOwner, record });
}

/** The owner pressed Send, so a call that needs the owner's approval has it. */
export const ownerGateway = () => gateway(async () => 'approved');

/** A lead agent acting alone. Anything that needs the owner is kept as a draft in the inbox, never sent. */
export const leadGateway = () => gateway(hold);
