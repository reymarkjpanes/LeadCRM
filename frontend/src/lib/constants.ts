/**
 * Application-wide constants.
 * Use these instead of magic strings/numbers scattered across components.
 */

// ─── Contact Status Options ────────────────────────────────────────────────
import { CRM_STATUSES } from '@leadcrm/shared';
export const CONTACT_STATUSES = CRM_STATUSES;
export type ContactStatus = typeof CONTACT_STATUSES[number];

// ─── Lead Source Options ───────────────────────────────────────────────────
export { LEAD_SOURCES } from '@leadcrm/shared';

// ─── Route Paths ───────────────────────────────────────────────────────────
export const ROUTES = {
  // Public
  LANDING: 'landing',
  LOGIN: 'login',

  // CRM Portal
  DASHBOARD: 'dashboard',
  CONTACTS: 'contacts',
  PIPELINE: 'pipeline',
  WORKFLOWS: 'workflows',
  CAMPAIGNS: 'campaigns',
  REPORTS: 'reports',
  USERS: 'users',
  SETTINGS: 'settings',
  PROFILE_SETTINGS: 'profile-settings',

} as const;

// ─── Roles ─────────────────────────────────────────────────────────────────
export const CRM_ROLES = ['Client Admin'] as const;
export const ALL_ROLES = CRM_ROLES;

export const isCurrentLeadSource = (value: string) => !['linkedin ads', 'webinar', 'partner referral', 'cold call', 'youtube ads', 'seo/organic search'].includes(value.toLowerCase().replace(/\s*\/\s*/g, '/').trim());
