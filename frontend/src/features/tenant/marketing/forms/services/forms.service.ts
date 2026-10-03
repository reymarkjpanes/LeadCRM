import { formsApi } from '@/shared/services/forms.api';
import type { FormRecord, CreateFormInput } from '../types/form.types';
export async function getFormsByTenant(_tenantId: string): Promise<FormRecord[]> {
  const forms: FormRecord[] = [];
  let page = 1;
  do { const res = await formsApi.list(page); forms.push(...res.data); if (!res.meta.hasMore) break; page++; } while (true);
  return forms;
}
export async function getFormById(id: string) { return (await formsApi.getById(id)).data; }
export async function createForm(input: CreateFormInput) { return (await formsApi.create(input.name)).data; }
export async function updateForm(id: string, updates: Pick<FormRecord, 'revision'> & Partial<Pick<FormRecord, 'name' | 'fields' | 'design' | 'settings'>>) { return (await formsApi.update(id, updates)).data; }
export async function publishForm(id: string) { return (await formsApi.publish(id)).data; }
export async function deleteForm(id: string) { await formsApi.delete(id); }
export async function unpublishForm(id: string) { return (await formsApi.unpublish(id)).data; }
export async function duplicateForm(id: string) { return (await formsApi.duplicate(id)).data; }
export function getShareLink(publicId: string): string {
  const origin = process.env.NEXT_PUBLIC_FORM_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '');
  return origin.replace(/\/$/, '') + '/forms/' + encodeURIComponent(publicId);
}
export function getEmbedCode(publicId: string): string {
  return '<iframe title="Contact form" src="' + getShareLink(publicId).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" style="width:100%;height:900px;border:0" loading="lazy"></iframe>';
}
