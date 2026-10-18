import { apiClient } from '@/lib/api/client';
import type { QuotationDraft, QuotationPreview, QuotationSendInput } from '@leadcrm/shared';

export const quotationsApi = {
  templatePdf: (id: string) => apiClient.download(`/marketing/templates/${id}/pdf`),
  preview: (draft: QuotationDraft) => apiClient.post<{ success: boolean; data: QuotationPreview }>('/marketing/campaigns/quotations/preview', draft),
  send: (input: QuotationSendInput) => apiClient.post<{ success: boolean; data: { messageId: string; threadId: string } }>('/marketing/campaigns/quotations/send', input),
};
export function quotationPdfBlob(base64: string): Blob {
  return new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: 'application/pdf' });
}
export function downloadQuotationPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
