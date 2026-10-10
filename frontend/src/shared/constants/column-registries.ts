import { TASK_COLUMN_DEFINITIONS } from '@leadcrm/shared';
/**
 * Frontend column registry definitions — mirrors the backend column-registry.ts.
 * Used by the ManageColumnsDrawer to display labels and enforce required columns.
 *
 * To add a new module: define a ColumnDefinition[] array and add it to MODULE_COLUMN_REGISTRIES.
 * The preference hook + drawer work automatically for any registered module.
 */

import type { ColumnDefinition } from '@leadcrm/shared';

// ─────────────────────────────────────────────────────
// LEADS
// ─────────────────────────────────────────────────────

export const LEADS_COLUMN_REGISTRY: ColumnDefinition[] = [
  // ── Leads ──────────────────────────────────────────────────
  { id: 'firstName',           label: 'Name',                          required: true,  defaultVisible: true,  defaultOrder: 0,  group: 'Leads',              priority: 'required' },
  { id: 'assignedUserId',      label: 'Assigned Agent',                required: false, defaultVisible: true,  defaultOrder: 3,  group: 'Leads',              priority: 'medium' },
  { id: 'phoneAction',         label: '📞',                            required: false, defaultVisible: false,  defaultOrder: 1,  group: 'Leads',              priority: 'high' },
  { id: 'emailAction',         label: '✉',                             required: false, defaultVisible: false,  defaultOrder: 2,  group: 'Leads',              priority: 'high' },
  { id: 'email',               label: 'Email address',                 required: false, defaultVisible: true, defaultOrder: 4,  group: 'Leads',              priority: 'low' },
  { id: 'phone',               label: 'Phone number',                  required: false, defaultVisible: true, defaultOrder: 5,  group: 'Leads',              priority: 'low' },
  { id: 'companyName',         label: 'Company',                       required: false, defaultVisible: true,  defaultOrder: 6,  group: 'Leads',              priority: 'high' },
  { id: 'status',              label: 'Status',                        required: true,  defaultVisible: true,  defaultOrder: 7,  group: 'Leads',              priority: 'required' },
  { id: 'description',         label: 'Description',                   required: false, defaultVisible: false, defaultOrder: 8,  group: 'Leads',              priority: 'low' },
  { id: 'website',             label: 'URL',                           required: false, defaultVisible: false, defaultOrder: 9,  group: 'Leads',              priority: 'low' },
  { id: 'createdAt',           label: 'Created',                       required: false, defaultVisible: true,  defaultOrder: 10, group: 'Leads',              priority: 'low' },
  { id: 'createdBy',           label: 'Created by',                    required: false, defaultVisible: false, defaultOrder: 11, group: 'Leads',              priority: 'low' },
  { id: 'updatedAt',           label: 'Updated',                       required: false, defaultVisible: false, defaultOrder: 12, group: 'Leads',              priority: 'low' },
  { id: 'updatedBy',           label: 'Updated by',                    required: false, defaultVisible: false, defaultOrder: 13, group: 'Leads',              priority: 'low' },
  { id: 'latestStatusChangeDate', label: 'Latest status change date',  required: false, defaultVisible: false, defaultOrder: 14, group: 'Leads',              priority: 'low' },
  { id: 'source',              label: 'Source',                        required: false, defaultVisible: true,  defaultOrder: 15, group: 'Leads',              priority: 'medium' },
  { id: 'localTime',           label: 'Local time',                    required: false, defaultVisible: false, defaultOrder: 16, group: 'Leads',              priority: 'low' },
  { id: 'primaryAddressCityState', label: 'Primary Address (City, State)', required: false, defaultVisible: false, defaultOrder: 17, group: 'Leads',          priority: 'low' },
  { id: 'address',             label: 'Primary address',               required: false, defaultVisible: false, defaultOrder: 18, group: 'Leads',              priority: 'low' },

  // ── Lead Custom Fields ─────────────────────────────────────
  { id: 'productInterest',     label: 'Product Interest Keywords',     required: false, defaultVisible: false, defaultOrder: 17, group: 'Lead Custom Fields', priority: 'low' },
  { id: 'linkedinUrl',         label: 'LinkedIn URL',                  required: false, defaultVisible: false, defaultOrder: 18, group: 'Lead Custom Fields', priority: 'low' },
  { id: 'classifyB2bB2c',      label: 'Classify as B2B or B2C',        required: false, defaultVisible: false, defaultOrder: 19, group: 'Lead Custom Fields', priority: 'low' },

  // ── Communication ──────────────────────────────────────────
  { id: 'latestCommunication',     label: 'Latest communication',          required: false, defaultVisible: false, defaultOrder: 20, group: 'Communication', priority: 'low' },
  { id: 'latestCommunicationDate', label: 'Latest communication date',     required: false, defaultVisible: false, defaultOrder: 21, group: 'Communication', priority: 'low' },
  { id: 'latestCommunicationUser', label: 'Latest communication user',     required: false, defaultVisible: false, defaultOrder: 22, group: 'Communication', priority: 'low' },
  { id: 'firstCommunication',      label: 'First communication',           required: false, defaultVisible: false, defaultOrder: 23, group: 'Communication', priority: 'low' },
  { id: 'firstCommunicationDate',  label: 'First communication date',      required: false, defaultVisible: false, defaultOrder: 24, group: 'Communication', priority: 'low' },
  { id: 'firstCommunicationUser',  label: 'First communication user',      required: false, defaultVisible: false, defaultOrder: 25, group: 'Communication', priority: 'low' },
  { id: 'timesCommunicated',       label: 'Times communicated',            required: false, defaultVisible: false, defaultOrder: 26, group: 'Communication', priority: 'low' },

  // ── Emails ─────────────────────────────────────────────────
  { id: 'latestEmailDate',         label: 'Latest email date',             required: false, defaultVisible: false, defaultOrder: 27, group: 'Emails', priority: 'low' },
  { id: 'latestReceivedEmailDate', label: 'Latest received email date',    required: false, defaultVisible: false, defaultOrder: 28, group: 'Emails', priority: 'low' },
  { id: 'latestSentEmailDate',     label: 'Latest sent email date',        required: false, defaultVisible: false, defaultOrder: 29, group: 'Emails', priority: 'low' },
  { id: 'latestEmailSubject',      label: 'Latest email subject',          required: false, defaultVisible: false, defaultOrder: 30, group: 'Emails', priority: 'low' },
  { id: 'emailLastOpened',         label: 'Email last opened',             required: false, defaultVisible: false, defaultOrder: 31, group: 'Emails', priority: 'low' },
  { id: 'emailCount',              label: '# Emails',                      required: false, defaultVisible: false, defaultOrder: 32, group: 'Emails', priority: 'low' },
  { id: 'sentEmailCount',          label: '# Sent emails',                 required: false, defaultVisible: false, defaultOrder: 33, group: 'Emails', priority: 'low' },
  { id: 'receivedEmailCount',      label: '# Received emails',             required: false, defaultVisible: false, defaultOrder: 34, group: 'Emails', priority: 'low' },
  { id: 'emailAttachmentCount',    label: '# Email attachments',           required: false, defaultVisible: false, defaultOrder: 35, group: 'Emails', priority: 'low' },

  // ── Calls ──────────────────────────────────────────────────
  { id: 'latestCallDate',          label: 'Latest call date',              required: false, defaultVisible: false, defaultOrder: 36, group: 'Calls', priority: 'low' },
  { id: 'latestIncomingCallDate',  label: 'Latest incoming call date',     required: false, defaultVisible: false, defaultOrder: 37, group: 'Calls', priority: 'low' },
  { id: 'latestOutgoingCallDate',  label: 'Latest outgoing call date',     required: false, defaultVisible: false, defaultOrder: 38, group: 'Calls', priority: 'low' },
  { id: 'latestCallNote',          label: 'Latest call note',              required: false, defaultVisible: false, defaultOrder: 39, group: 'Calls', priority: 'low' },
  { id: 'firstCallDate',           label: 'First call date',               required: false, defaultVisible: false, defaultOrder: 40, group: 'Calls', priority: 'low' },
  { id: 'firstCallNote',           label: 'First call note',               required: false, defaultVisible: false, defaultOrder: 41, group: 'Calls', priority: 'low' },
  { id: 'callCount',               label: '# Calls',                       required: false, defaultVisible: false, defaultOrder: 42, group: 'Calls', priority: 'low' },
  { id: 'outgoingCallCount',       label: '# Outgoing calls',              required: false, defaultVisible: false, defaultOrder: 43, group: 'Calls', priority: 'low' },
  { id: 'incomingCallCount',       label: '# Incoming calls',              required: false, defaultVisible: false, defaultOrder: 44, group: 'Calls', priority: 'low' },

  // ── SMS messages ───────────────────────────────────────────
  { id: 'latestSmsDate',           label: 'Latest SMS date',               required: false, defaultVisible: false, defaultOrder: 45, group: 'SMS messages', priority: 'low' },
  { id: 'latestReceivedSmsDate',   label: 'Latest received SMS date',      required: false, defaultVisible: false, defaultOrder: 46, group: 'SMS messages', priority: 'low' },
  { id: 'latestSentSmsDate',       label: 'Latest sent SMS date',          required: false, defaultVisible: false, defaultOrder: 47, group: 'SMS messages', priority: 'low' },
  { id: 'latestSmsMessage',        label: 'Latest SMS message',            required: false, defaultVisible: false, defaultOrder: 48, group: 'SMS messages', priority: 'low' },
  { id: 'firstSmsDate',            label: 'First SMS date',                required: false, defaultVisible: false, defaultOrder: 49, group: 'SMS messages', priority: 'low' },
  { id: 'firstSmsMessage',         label: 'First SMS message',             required: false, defaultVisible: false, defaultOrder: 50, group: 'SMS messages', priority: 'low' },
  { id: 'smsCount',                label: '# SMS messages',                required: false, defaultVisible: false, defaultOrder: 51, group: 'SMS messages', priority: 'low' },
  { id: 'sentSmsCount',            label: '# Sent SMS',                    required: false, defaultVisible: false, defaultOrder: 52, group: 'SMS messages', priority: 'low' },
  { id: 'receivedSmsCount',        label: '# Received SMS',                required: false, defaultVisible: false, defaultOrder: 53, group: 'SMS messages', priority: 'low' },

  // ── Notes ──────────────────────────────────────────────────
  { id: 'noteCount',               label: '# Notes',                       required: false, defaultVisible: false, defaultOrder: 54, group: 'Notes', priority: 'low' },
  { id: 'latestNoteDate',          label: 'Latest note date',              required: false, defaultVisible: false, defaultOrder: 55, group: 'Notes', priority: 'low' },

  // ── Opportunities ──────────────────────────────────────────
  { id: 'activeOppValue',          label: 'Active opp. value',             required: false, defaultVisible: false, defaultOrder: 56, group: 'Opportunities', priority: 'low' },
  { id: 'wonOppValue',             label: 'Won opp. value',                required: false, defaultVisible: false, defaultOrder: 57, group: 'Opportunities', priority: 'low' },
  { id: 'lostOppValue',            label: 'Lost opp. value',               required: false, defaultVisible: false, defaultOrder: 58, group: 'Opportunities', priority: 'low' },
  { id: 'allOppValue',             label: 'All opp. value',                required: false, defaultVisible: false, defaultOrder: 59, group: 'Opportunities', priority: 'low' },
  { id: 'primaryOppStatus',        label: 'Primary opp. status',           required: false, defaultVisible: false, defaultOrder: 60, group: 'Opportunities', priority: 'low' },
  { id: 'primaryOppCloseDate',     label: 'Primary opp. close date',       required: false, defaultVisible: false, defaultOrder: 61, group: 'Opportunities', priority: 'low' },
  { id: 'primaryOppCreated',       label: 'Primary opp. created',          required: false, defaultVisible: false, defaultOrder: 62, group: 'Opportunities', priority: 'low' },
  { id: 'primaryOppUpdated',       label: 'Primary opp. updated',          required: false, defaultVisible: false, defaultOrder: 63, group: 'Opportunities', priority: 'low' },
  { id: 'primaryOppValue',         label: 'Primary opp. value',            required: false, defaultVisible: false, defaultOrder: 65, group: 'Opportunities', priority: 'low' },
  { id: 'primaryOppUser',          label: 'Primary opp. user',             required: false, defaultVisible: false, defaultOrder: 66, group: 'Opportunities', priority: 'low' },
  { id: 'lastOppStatusChangeDate', label: 'Last opp. status change date',  required: false, defaultVisible: false, defaultOrder: 67, group: 'Opportunities', priority: 'low' },
  { id: 'opportunityCount',        label: '# Deals',               required: false, defaultVisible: false, defaultOrder: 68, group: 'Deals', priority: 'low' },
  { id: 'activeOpportunityCount',  label: '# Active deals',        required: false, defaultVisible: false, defaultOrder: 69, group: 'Deals', priority: 'low' },
  { id: 'wonOpportunityCount',     label: '# Won deals',           required: false, defaultVisible: false, defaultOrder: 70, group: 'Deals', priority: 'low' },
  { id: 'lostOpportunityCount',    label: '# Lost deals',          required: false, defaultVisible: false, defaultOrder: 71, group: 'Deals', priority: 'low' },

  // ── Tasks ──────────────────────────────────────────────────
  { id: 'nextTask',                label: 'Next task',                     required: false, defaultVisible: false, defaultOrder: 72, group: 'Tasks', priority: 'low' },
  { id: 'nextTaskDate',            label: 'Next task date',                required: false, defaultVisible: false, defaultOrder: 73, group: 'Tasks', priority: 'low' },
  { id: 'nextTaskUser',            label: 'Next task user',                required: false, defaultVisible: false, defaultOrder: 74, group: 'Tasks', priority: 'low' },
  { id: 'taskCount',               label: '# Tasks',                       required: false, defaultVisible: false, defaultOrder: 75, group: 'Tasks', priority: 'low' },
  { id: 'completedTaskCount',      label: '# Completed tasks',             required: false, defaultVisible: false, defaultOrder: 76, group: 'Tasks', priority: 'low' },
  { id: 'incompleteTaskCount',     label: '# Incomplete tasks',            required: false, defaultVisible: false, defaultOrder: 77, group: 'Tasks', priority: 'low' },
];

// ─────────────────────────────────────────────────────
// ACCOUNTS
// ─────────────────────────────────────────────────────

export const ACCOUNTS_COLUMN_REGISTRY: ColumnDefinition[] = [
  { id: 'name',            label: 'Account Name',      required: true,  defaultVisible: true,  defaultOrder: 0, group: 'Account Info',  priority: 'required' },
  { id: 'industry',        label: 'Industry',          required: false, defaultVisible: true,  defaultOrder: 1, group: 'Account Info',  priority: 'medium' },
  { id: 'size',            label: 'Company Size',      required: false, defaultVisible: true,  defaultOrder: 3, group: 'Account Info',  priority: 'medium' },
  { id: 'city',            label: 'City',              required: false, defaultVisible: true,  defaultOrder: 4, group: 'Location',      priority: 'low' },
  { id: 'country',         label: 'Country',           required: false, defaultVisible: false, defaultOrder: 5, group: 'Location',      priority: 'low' },
  { id: 'assignedUserId',  label: 'Assigned Agent',             required: false, defaultVisible: true,  defaultOrder: 6, group: 'Account Info',  priority: 'medium' },
  { id: 'website',         label: 'Website',           required: false, defaultVisible: false, defaultOrder: 7, group: 'Account Info',  priority: 'low' },
  { id: 'tags',            label: 'Tags',              required: false, defaultVisible: false, defaultOrder: 8, group: 'Account Info',  priority: 'low' },
  { id: 'createdAt',       label: 'Created Date',      required: false, defaultVisible: true,  defaultOrder: 9, group: 'System',        priority: 'low' },
];

// ─────────────────────────────────────────────────────
// CONTACTS
// ─────────────────────────────────────────────────────

export const CONTACTS_COLUMN_REGISTRY: ColumnDefinition[] = [
  { id: 'firstName',       label: 'First Name',        required: true,  defaultVisible: true,  defaultOrder: 0, group: 'Contact Info',  priority: 'required' },
  { id: 'lastName',        label: 'Last Name',         required: true,  defaultVisible: true,  defaultOrder: 1, group: 'Contact Info',  priority: 'required' },
  { id: 'email',           label: 'Email',             required: false, defaultVisible: true,  defaultOrder: 2, group: 'Contact Info',  priority: 'low' },
  { id: 'phone',           label: 'Phone',             required: false, defaultVisible: true,  defaultOrder: 3, group: 'Contact Info',  priority: 'low' },
  { id: 'companyName',     label: 'Company',           required: false, defaultVisible: true,  defaultOrder: 4, group: 'Organization',  priority: 'high' },
  { id: 'status',          label: 'Status',            required: false, defaultVisible: true,  defaultOrder: 5, group: 'Contact Info',  priority: 'medium' },
  { id: 'source',          label: 'Source',            required: false, defaultVisible: false, defaultOrder: 6, group: 'Contact Info',  priority: 'medium' },
  { id: 'assignedUserId',  label: 'Assigned Agent',       required: false, defaultVisible: true,  defaultOrder: 7, group: 'Contact Info',  priority: 'medium' },
  { id: 'accountId',       label: 'Account',           required: false, defaultVisible: false, defaultOrder: 8, group: 'Organization',  priority: 'low' },
  { id: 'createdAt',       label: 'Created Date',      required: false, defaultVisible: true,  defaultOrder: 9, group: 'System',        priority: 'low' },
];

// ─────────────────────────────────────────────────────
// DEALS
// ─────────────────────────────────────────────────────

export const DEALS_COLUMN_REGISTRY: ColumnDefinition[] = [
  { id: 'title',            label: 'Deal Name',         required: true,  defaultVisible: true,  defaultOrder: 0, group: 'Deal Info',     priority: 'required' },
  { id: 'value',            label: 'Value',             required: false, defaultVisible: true,  defaultOrder: 1, group: 'Deal Info',     priority: 'high' },
  { id: 'stageId',          label: 'Stage',             required: false, defaultVisible: true,  defaultOrder: 2, group: 'Deal Info',     priority: 'medium' },
  { id: 'priority',         label: 'Priority',          required: false, defaultVisible: true,  defaultOrder: 3, group: 'Deal Info',     priority: 'medium' },
  { id: 'assignedUserId',   label: 'Assigned To',       required: false, defaultVisible: true,  defaultOrder: 4, group: 'Deal Info',     priority: 'medium' },
  { id: 'accountId',        label: 'Account',           required: false, defaultVisible: true,  defaultOrder: 5, group: 'Relationships', priority: 'medium' },
  { id: 'expectedCloseDate',label: 'Expected Close',    required: false, defaultVisible: true,  defaultOrder: 6, group: 'Deal Info',     priority: 'low' },
  { id: 'leadSource',       label: 'Lead Source',       required: false, defaultVisible: false, defaultOrder: 7, group: 'Deal Info',     priority: 'medium' },
  { id: 'industry',         label: 'Industry',          required: false, defaultVisible: false, defaultOrder: 8, group: 'Deal Info',     priority: 'low' },
  { id: 'createdAt',        label: 'Created Date',      required: false, defaultVisible: false, defaultOrder: 9, group: 'System',        priority: 'low' },
];

// ─────────────────────────────────────────────────────
// REGISTRY MAP — use this for lookups by module name
// ─────────────────────────────────────────────────────

export const MODULE_COLUMN_REGISTRIES: Record<string, ColumnDefinition[]> = {
  tasks: TASK_COLUMN_DEFINITIONS,
  leads: LEADS_COLUMN_REGISTRY,
  accounts: ACCOUNTS_COLUMN_REGISTRY,
  contacts: CONTACTS_COLUMN_REGISTRY,
  deals: DEALS_COLUMN_REGISTRY,
};
