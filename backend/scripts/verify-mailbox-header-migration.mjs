// Disposable database only: prove the additive migration preserves historical mail.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

const db = await PGlite.create();
const migration = '20261113000000_mailbox_message_headers';
try {
  await replayCrmMigrations(db, { before: migration });
  await db.exec(`INSERT INTO "EmailAccount" ("id", "tenantId", "userId", "email", "accessToken", "scopes", "updatedAt")
    VALUES ('history-account', 'history-tenant', 'history-owner', 'staff@example.test', 'opaque-test-value', ARRAY['gmail.modify'], now());
    INSERT INTO "MailboxMessage" ("id", "tenantId", "accountId", "providerMessageId", "threadId", "direction", "from", "fromAddress", "recipients", "recipientAddresses", "subject", "body", "snippet", "labels", "sentAt", "rfcMessageId", "leadId", "dealId")
    VALUES ('history-message', 'history-tenant', 'history-account', 'provider-original', 'thread-original', 'inbound', 'Customer <customer@example.test>', 'customer@example.test', ARRAY['staff@example.test'], ARRAY['staff@example.test'], 'Original subject', '<p>Original</p><blockquote>Keep history</blockquote>', 'Original', ARRAY['INBOX','UNREAD'], '2026-01-01T02:03:04Z', '<original@example.test>', 'historical-lead', 'historical-deal');`);
  const before = (await db.query('SELECT * FROM "MailboxMessage"')).rows[0];
  const accountBefore = (await db.query('SELECT * FROM "EmailAccount"')).rows[0];
  await replayCrmMigrations(db, { from: migration });
  const { ccRecipients, replyToAddress, sourceMessageId, rfcReferences, attachments, rfcInReplyTo, ...after } = (await db.query('SELECT * FROM "MailboxMessage"')).rows[0];
  assert.deepEqual(after, before);
  assert.deepEqual(ccRecipients, []); assert.equal(replyToAddress, null); assert.equal(sourceMessageId, null);
  assert.deepEqual(rfcReferences, []); assert.deepEqual(attachments, []);
  assert.equal(rfcInReplyTo, null);
  const accountAfter = (await db.query('SELECT * FROM "EmailAccount"')).rows[0];
  for (const field of Object.keys(accountBefore)) assert.deepEqual(accountAfter[field], accountBefore[field]);
  await db.exec(`INSERT INTO "MailboxSendReceipt" ("id", "tenantId", "accountId", "requestId", "payloadHash", "updatedAt") VALUES ('receipt', 'history-tenant', 'history-account', 'request', 'hash', now());`);
  await assert.rejects(db.exec(`INSERT INTO "MailboxSendReceipt" ("id", "tenantId", "accountId", "requestId", "payloadHash", "updatedAt") VALUES ('duplicate', 'history-tenant', 'history-account', 'request', 'hash', now());`));
  await assert.rejects(db.exec(`INSERT INTO "MailboxSendReceipt" ("id", "tenantId", "accountId", "requestId", "payloadHash", "updatedAt") VALUES ('foreign', 'other-tenant', 'history-account', 'other', 'hash', now());`));
  console.log('PASS: historical message/body/IDs/CRM links and account preserved; header defaults empty/null; send receipt uniqueness and tenant foreign key enforced.');
} finally { await db.close(); }
