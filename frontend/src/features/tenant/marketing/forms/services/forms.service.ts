// ─── Marketing Forms Service ─────────────────────────────────────────────────
// This service is the single integration point between the forms UI and the
// backend API. It was previously backed by localStorage; it now uses the real
// API via formsApi so form data persists across sessions and devices.
//
// All exported functions are async. Callers must await them and handle errors
// with toast notifications — never silent catches.
//
// getShareLink / getEmbedCode are pure helpers with no network dependency.

import { formsApi } from '@/shared/services/forms.api';
import type {
  FormRecord,
  CreateFormInput,
} from '../types/form.types';

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Return all non-archived forms for the tenant.
 * tenantId is kept in the signature for API compatibility but is resolved
 * server-side from the JWT — it is not sent in the request body.
 */
export async function getFormsByTenant(_tenantId: string): Promise<FormRecord[]> {
  const res = await formsApi.list();
  // Cast is safe: the backend shape aligns with FormRecord (id, name, status,
  // fields, design, settings, publishedAt, createdAt, updatedAt)
  return (res?.data ?? []) as FormRecord[];
}

/**
 * Fetch a single form by id.
 * Returns undefined if the API returns null/undefined (e.g. 404 caught upstream).
 */
export async function getFormById(id: string): Promise<FormRecord | undefined> {
  const res = await formsApi.getById(id);
  return res?.data as FormRecord | undefined;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new draft form with the given name.
 * Fields, design, and settings are initialised to empty by the backend.
 */
export async function createForm(input: CreateFormInput): Promise<FormRecord> {
  const res = await formsApi.create(input.name);
  if (!res?.data) throw new Error('Failed to create form — no data returned');
  return res.data as FormRecord;
}

/**
 * Partially update a form. Send only the fields that changed.
 * Accepts name, fields array, design object, or settings object in any combination.
 */
export async function updateForm(
  id: string,
  updates: Partial<Omit<FormRecord, 'id' | 'tenantId' | 'createdAt'>>,
): Promise<FormRecord> {
  const res = await formsApi.update(id, updates);
  if (!res?.data) throw new Error('Failed to update form — no data returned');
  return res.data as FormRecord;
}

/**
 * Publish a form — transitions status from 'draft' → 'published'.
 */
export async function publishForm(id: string): Promise<FormRecord> {
  const res = await formsApi.publish(id);
  if (!res?.data) throw new Error('Failed to publish form — no data returned');
  return res.data as FormRecord;
}

/**
 * Soft-delete a form. The form is archived on the server (isArchived = true)
 * and will no longer appear in list responses.
 */
export async function deleteForm(id: string): Promise<void> {
  await formsApi.archive(id);
}

// ─── Pure Helpers (no network) ────────────────────────────────────────────────

/**
 * Return the public embed URL for a published form.
 * This is a client-side computation — no API call needed.
 */
export function getShareLink(formId: string): string {
  return `https://forms.leadcrm.app/${formId}`;
}

/**
 * Return the HTML snippet used to embed a form in an external page.
 */
export function getEmbedCode(formId: string): string {
  return `<script src="https://forms.leadcrm.app/embed.js" type="module" crossorigin="anonymous" defer></script><leadcrm-form id="${formId}"></leadcrm-form>`;
}
