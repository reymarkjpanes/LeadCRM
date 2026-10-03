import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CampaignBuilder } from '../campaign-builder';
import { audiencesApi } from '@/shared/services/audiences.api';
import { campaignsApi } from '@/shared/services/campaigns.api';
import { toast } from 'sonner';
const access = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: (key: string) => !access.denied.has(key) }));
vi.mock('@/shared/services/campaigns.api', () => ({ campaignsApi: { create: vi.fn(), update: vi.fn(), send: vi.fn(), get: vi.fn() } }));
vi.mock('@/shared/services/audiences.api', () => ({ audiencesApi: { list: vi.fn(), preview: vi.fn(), create: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
const counts = { matched: 2, eligible: 2, missingEmail: 0, invalidEmail: 0, duplicateEmail: 0, staffEmail: 0, unsubscribed: 0, blocked: 0, inactive: 0, recipientNotAllowed: 0 };
const audience = { id: 'ac9a6eb7-c05a-4756-8f6b-9d678f62c559', name: 'Customers', source: 'ALL' as const, conditions: [] };
beforeEach(() => {
  access.denied.clear();
  vi.clearAllMocks(); vi.mocked(audiencesApi.list).mockResolvedValue({ success: true, data: [audience] });
  vi.mocked(audiencesApi.preview).mockResolvedValue({ success: true, data: counts });
  vi.mocked(campaignsApi.create).mockResolvedValue({ success: true, data: { id: 'saved-id' } as never });
  vi.mocked(campaignsApi.update).mockResolvedValue({ success: true, data: { id: 'saved-id' } as never });
  vi.mocked(campaignsApi.send).mockResolvedValue({ success: true, data: { campaignId: 'saved-id', eligibleRecipients: 2, submittedRecipients: 2, failedRecipients: 0, status: 'SENT' } });
});
afterEach(cleanup);
function fill() {
  fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'September Campaign' } });
  fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'ALL' } });
  fireEvent.change(screen.getByLabelText(/Subject Line/), { target: { value: 'Hello {{first_name}}' } });
  fireEvent.change(screen.getByLabelText(/Body/), { target: { value: 'Hi {{first_name}}' } });
}
describe('campaign composer', () => {
  it('allows editing a draft without enabling Send', async () => {
    access.denied.add('campaigns.send');
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    expect((screen.getByRole('button', { name: 'Send Now' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send Now' }));
    expect(campaignsApi.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(campaignsApi.create).toHaveBeenCalledTimes(1));
  });
  it('lets an explicitly authorized sender send a saved draft without editing it', async () => {
    access.denied.add('campaigns.edit'); access.denied.add('campaigns.create');
    render(<CampaignBuilder onBack={vi.fn()} initialCampaign={{ id: 'saved-id', name: 'Existing', type: 'Email', status: 'Draft', subject: 'Saved subject', body: 'Saved body', audienceSource: 'ALL' } as never} />);
    expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText(/Campaign Name/).closest('fieldset')?.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send Now' }));
    await waitFor(() => expect(campaignsApi.send).toHaveBeenCalledWith('saved-id'));
    expect(campaignsApi.update).not.toHaveBeenCalled(); expect(campaignsApi.create).not.toHaveBeenCalled();
  });
  it('places one required error below each field without calling the API', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send Now' }));
    expect(await screen.findAllByRole('alert')).toHaveLength(4);
    expect(screen.getByLabelText(/Campaign Name/).nextElementSibling?.textContent).toContain('required');
    expect(screen.getByLabelText(/Subject Line/).nextElementSibling?.textContent).toContain('required');
    expect(screen.getByLabelText(/Body/).nextElementSibling?.textContent).toContain('required');
    expect(campaignsApi.create).not.toHaveBeenCalled();
  });
  it('saves a database draft with its selected audience and content without sending', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(campaignsApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'September Campaign', audienceSource: 'ALL', body: 'Hi {{first_name}}', subject: 'Hello {{first_name}}' })));
    expect(campaignsApi.send).not.toHaveBeenCalled();
  });
  it('prevents double clicks and reports submitted counts, not delivery', async () => {
    let finish!: (value: Awaited<ReturnType<typeof campaignsApi.send>>) => void;
    vi.mocked(campaignsApi.send).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    const send = screen.getByRole('button', { name: 'Send Now' }); fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(campaignsApi.send).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: 'Sending...' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ success: true, data: { campaignId: 'saved-id', eligibleRecipients: 2, submittedRecipients: 1, failedRecipients: 1, status: 'PARTIALLY_SENT' } }));
    expect(toast.warning).toHaveBeenCalledWith('1 of 2 emails were submitted successfully. 1 failed.');
    expect(campaignsApi.create).toHaveBeenCalledTimes(1);
  });
  it('polls an accepted background send before reporting submitted results', async () => {
    vi.mocked(campaignsApi.send).mockResolvedValueOnce({ success: true, data: { campaignId: 'saved-id', eligibleRecipients: 2, submittedRecipients: 0, failedRecipients: 0, status: 'SENDING' } });
    vi.mocked(campaignsApi.get).mockResolvedValueOnce({ success: true, data: { id: 'saved-id', recipientCount: 99, sentCount: 0, failedCount: 0, status: 'Sent', sendResult: { campaignId: 'saved-id', eligibleRecipients: 2, submittedRecipients: 2, failedRecipients: 0, status: 'SENT' } } as never });
    const back = vi.fn(); render(<CampaignBuilder onBack={back} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send Now' }));
    await waitFor(() => expect(campaignsApi.send).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 of 2 emails were submitted successfully.'), { timeout: 4000 });
    expect(campaignsApi.get).toHaveBeenCalledWith('saved-id'); expect(back).toHaveBeenCalledTimes(1);
  });
  it.each([
    { submitted: 4, failed: 0, status: 'SENT', level: 'success', message: '4 of 4 emails were submitted successfully.' },
    { submitted: 3, failed: 1, status: 'PARTIALLY_SENT', level: 'warning', message: '3 of 4 emails were submitted successfully. 1 failed.' },
    { submitted: 0, failed: 4, status: 'FAILED', level: 'error', message: 'Campaign sending failed. 0 of 4 emails were submitted.' },
  ] as const)('reports the authoritative $status result and refreshes once', async ({ submitted, failed, status, level, message }) => {
    vi.mocked(campaignsApi.send).mockResolvedValueOnce({ success: true, data: { campaignId: 'saved-id', eligibleRecipients: 4, submittedRecipients: submitted, failedRecipients: failed, status } });
    const back = vi.fn(); render(<CampaignBuilder onBack={back} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send Now' }));
    await waitFor(() => expect(toast[level]).toHaveBeenCalledWith(message));
    expect(back).toHaveBeenCalledTimes(1);
    expect(campaignsApi.send).toHaveBeenCalledTimes(1);
    expect(campaignsApi.get).not.toHaveBeenCalled();
  });
  it('reopens an existing draft and updates the same database record', async () => {
    render(<CampaignBuilder onBack={vi.fn()} initialCampaign={{ id: 'saved-id', name: 'Existing', type: 'Email', status: 'Draft', subject: 'Saved subject', body: 'Saved body', targetAudienceId: audience.id } as never} />);
    await screen.findByRole('option', { name: 'Customers' });
    expect((screen.getByLabelText(/Target Audience/) as HTMLSelectElement).value).toBe(audience.id);
    expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe('Saved body');
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(campaignsApi.update).toHaveBeenCalledWith('saved-id', expect.objectContaining({ targetAudienceId: audience.id, body: 'Saved body' })));
    expect(campaignsApi.create).not.toHaveBeenCalled();
  });
  it('preserves content and the saved ID after a failed send request', async () => {
    vi.mocked(campaignsApi.send).mockRejectedValueOnce(new Error('Daily allowance reached.'));
    const back = vi.fn(); render(<CampaignBuilder onBack={back} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send Now' }));
    expect(await screen.findByText('Daily allowance reached.')).toBeTruthy(); expect(back).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe('Hi {{first_name}}');
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(campaignsApi.update).toHaveBeenCalledWith('saved-id', expect.any(Object)));
  });
  it('adds a newly persisted audience immediately to the selector', async () => {
    vi.mocked(audiencesApi.create).mockResolvedValue({ success: true, data: { ...audience, name: 'New audience' } });
    render(<CampaignBuilder onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create New/ }));
    fireEvent.change(screen.getByLabelText(/Audience Name/), { target: { value: 'New audience' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Audience' }));
    await screen.findByRole('option', { name: 'New audience' });
    expect((screen.getByLabelText(/Target Audience/) as HTMLSelectElement).value).toBe(audience.id);
    expect(audiencesApi.create).toHaveBeenCalledWith({ name: 'New audience', source: 'ALL', conditions: [] });
  });
});
