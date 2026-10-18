import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { campaignFields, CUSTOM_FIELD_MODULES, getCrmFieldCatalog, SMS_DEFAULT_FOOTER } from '@leadcrm/shared';
import { CampaignBuilder } from '../campaign-builder';
import { audiencesApi } from '@/shared/services/audiences.api';
import { campaignsApi } from '@/shared/services/campaigns.api';
import { toast } from 'sonner';
import { clearPageCache, invalidatePageCache } from '@/shared/cache/page-cache';
import { requestNavigation } from '@/shared/lib/navigation-intent';
import { useLayout } from '@/features/tenant/layout/use-layout';
const access = vi.hoisted(() => ({ denied: new Set<string>() }));
const routing = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => routing, usePathname: () => window.location.pathname }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'builder-user', tenantId: 'builder-tenant', role: 'Client Admin' }, tenant: { id: 'builder-tenant' }, isLoading: false }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: (key: string) => !access.denied.has(key), usePermissions: () => ['*'] }));
vi.mock('@/shared/services/campaigns.api', () => ({ campaignsApi: { variableFields: vi.fn(), create: vi.fn(), update: vi.fn(), send: vi.fn(), get: vi.fn(), smsSettings: vi.fn(), emailSettings: vi.fn(), schedule: vi.fn(), cancelSchedule: vi.fn() } }));
vi.mock('@/shared/services/audiences.api', () => ({ audiencesApi: { fields: vi.fn(), companies: vi.fn(async () => ({ data: [] })), list: vi.fn(), preview: vi.fn(), create: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const counts = { matched: 2, eligible: 2, missingEmail: 0, invalidEmail: 0, duplicateEmail: 0, staffEmail: 0, unsubscribed: 0, blocked: 0, inactive: 0, recipientNotAllowed: 0, recipients: [], meta: { page: 1, limit: 25, total: 2, hasMore: false } };
const audience = { id: 'ac9a6eb7-c05a-4756-8f6b-9d678f62c559', name: 'Customers', source: 'LEADS' as const, conditions: [] };
beforeEach(() => {
  clearPageCache();
  access.denied.clear();
  vi.mocked(campaignsApi.variableFields).mockResolvedValue({ success: true, data: CUSTOM_FIELD_MODULES.flatMap(module => getCrmFieldCatalog(module)) });
  vi.mocked(audiencesApi.fields).mockImplementation(async source => ({ success: true, data: campaignFields(source) }));
  vi.mocked(campaignsApi.schedule).mockResolvedValue({ success: true, data: { id: 'saved-id', status: 'scheduled' } as never });
  vi.mocked(campaignsApi.cancelSchedule).mockResolvedValue({ success: true, data: { id: 'saved-id', status: 'Draft' } as never });
  vi.mocked(campaignsApi.emailSettings).mockResolvedValue({ success: true, data: { senderName: 'Configured test sender', senderEmail: 'sender@example.test' } });
  vi.mocked(campaignsApi.smsSettings).mockResolvedValue({ success: true, data: { organizationName: 'Configured SMS organization', organizationEmail: 'info@example.test' } });
  vi.clearAllMocks(); vi.mocked(audiencesApi.list).mockResolvedValue({ success: true, data: [audience] });
  vi.mocked(audiencesApi.preview).mockResolvedValue({ success: true, data: counts });
  vi.mocked(campaignsApi.create).mockResolvedValue({ success: true, data: { id: 'saved-id' } as never });
  vi.mocked(campaignsApi.update).mockResolvedValue({ success: true, data: { id: 'saved-id' } as never });
  vi.mocked(campaignsApi.send).mockResolvedValue({ success: true, data: { campaignId: 'saved-id', eligibleRecipients: 2, submittedRecipients: 2, failedRecipients: 0, status: 'SENT' } });
});
afterEach(() => { cleanup(); clearPageCache(); vi.useRealTimers(); });
function sendNow() {
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Send Now' }));
}
async function schedulePicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule Send' }));
  return screen.findByRole('dialog', { name: 'Schedule Send' });
}
function frozenManilaAfternoon() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T07:00:00.000Z'));
}
function fill() {
  fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'September Campaign' } });
  fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'LEADS' } });
  fireEvent.change(screen.getByLabelText(/Subject Line/), { target: { value: 'Hello {{first_name}}' } });
  fireEvent.change(screen.getByLabelText(/Body/), { target: { value: 'Hi {{first_name}}' } });
}
function unloadPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
const existingDraft = { id: 'saved-id', name: 'Saved campaign', type: 'Email', status: 'Draft', subject: 'Saved subject', body: 'Saved body', audienceSource: 'LEADS' };
it('starts with editable SMS footer text and preserves its deletion through save and reopening', async () => {
  const view = render(<CampaignBuilder initialType="SMS" onBack={vi.fn()} />);
  expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe(SMS_DEFAULT_FOOTER);
  expect((screen.getByRole('button', { name: 'Insert default SMS footer' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Body/), { target: { value: '' } });
  expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByText(/For inquiries regarding|This is a no-reply/)).toBeNull();
  fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'Empty SMS draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(campaignsApi.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'SMS', body: '' })));
  view.unmount();
  render(<CampaignBuilder initialCampaign={{ ...existingDraft, type: 'SMS', body: '', subject: '' } as never} onBack={vi.fn()} />);
  expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByText(/For inquiries regarding|This is a no-reply/)).toBeNull();
  expect(campaignsApi.send).not.toHaveBeenCalled();
});
it('keeps edited SMS and email bodies separate and guards inactive-channel edits', () => {
  render(<CampaignBuilder onBack={vi.fn()} />);
  const body = () => screen.getByLabelText(/Body/) as HTMLTextAreaElement;
  fireEvent.change(body(), { target: { value: 'Email content' } });
  fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
  expect(body().value).toBe(SMS_DEFAULT_FOOTER);
  fireEvent.change(body(), { target: { value: 'SMS with my own footer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Email' }));
  expect(body().value).toBe('Email content');
  expect(screen.queryByRole('button', { name: 'Insert default SMS footer' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
  expect(body().value).toBe('SMS with my own footer');
  expect(unloadPrevented()).toBe(true);
});
it('inserts the default footer once on request and sends the author’s edited text', async () => {
  render(<CampaignBuilder initialType="SMS" initialContent="My offer" onBack={vi.fn()} />);
  const body = screen.getByLabelText(/Body/) as HTMLTextAreaElement;
  expect(body.value).toBe('My offer');
  fireEvent.click(screen.getByRole('button', { name: 'Insert default SMS footer' }));
  expect(body.value).toBe(`My offer\n\n${SMS_DEFAULT_FOOTER}`);
  fireEvent.click(screen.getByRole('button', { name: 'Insert default SMS footer' }));
  expect(body.value.match(/This is a no-reply message/g)).toHaveLength(1);
  const edited = body.value.replace('+63 (28) 462-3488', '+63 917 123 4567');
  fireEvent.change(body, { target: { value: edited } });
  fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'Editable footer' } });
  fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'LEADS' } });
  await waitFor(() => expect(audiencesApi.preview).toHaveBeenCalled());
  sendNow();
  await waitFor(() => expect(campaignsApi.send).toHaveBeenCalledOnce());
  expect(campaignsApi.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'SMS', body: edited, subject: '' }));
});
it('previews tracked SMS length while preserving the original editable URL', async () => {
  vi.mocked(campaignsApi.smsSettings).mockResolvedValue({ success: true, data: { organizationName: 'SMS organization', organizationEmail: 'info@example.test', trackingOrigin: 'https://crm.example.test' } });
  render(<CampaignBuilder initialType="SMS" onBack={vi.fn()} />);
  const body = screen.getByLabelText(/Body/) as HTMLTextAreaElement;
  fireEvent.change(body, { target: { value: 'Visit https://destination.test/products?a=1&b=2' } });
  await screen.findByText(/Counts include the tracking URL/);
  expect(body.value).toBe('Visit https://destination.test/products?a=1&b=2');
  expect(screen.getByRole('link', { name: 'https://destination.test/products?a=1&b=2' }).getAttribute('href')).toBe('https://destination.test/products?a=1&b=2');
});
function ModuleNavigation({ label, module, onNavigated }: { label: string; module: string; onNavigated?: () => void }) {
  const { navigate } = useLayout();
  return <nav aria-label="Workspace"><button aria-label={label} onClick={() => requestNavigation(() => { navigate(module); onNavigated?.(); })}><span>{label}</span></button></nav>;
}

describe('campaign unsaved navigation', () => {
  it.each(['empty', 'template', 'edit'])('leaves a clean %s campaign immediately', mode => {
    const back = vi.fn();
    render(<CampaignBuilder onBack={back} initialCampaign={mode === 'edit' ? existingDraft as never : undefined}
      initialType={mode === 'template' ? 'SMS' : undefined} initialContent={mode === 'template' ? 'Template body' : undefined} initialSubject={mode === 'template' ? 'Template subject' : undefined} />);
    expect(unloadPrevented()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' }));
    expect(back).toHaveBeenCalledOnce(); expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(campaignsApi.create).not.toHaveBeenCalled(); expect(campaignsApi.update).not.toHaveBeenCalled();
  });

  describe.each(['create', 'edit'])('%s baseline', mode => {
    it.each(['name', 'type', 'audience', 'subject', 'body'])('tracks %s changes and becomes clean when reverted', field => {
      const back = vi.fn();
      render(<CampaignBuilder onBack={back} initialCampaign={mode === 'edit' ? existingDraft as never : undefined} />);
      const label = { name: /Campaign Name/, audience: /Target Audience/, subject: /Subject Line/, body: /Body/ };
      let revert: () => void;
      if (field === 'type') {
        fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
        revert = () => fireEvent.click(screen.getByRole('button', { name: 'Email' }));
      } else {
        const input = screen.getByLabelText(label[field as keyof typeof label]) as HTMLInputElement;
        const previous = input.value;
        fireEvent.change(input, { target: { value: field === 'audience' ? 'CONTACTS' : 'Changed value' } });
        revert = () => fireEvent.change(input, { target: { value: previous } });
      }
      expect(unloadPrevented()).toBe(true); expect(screen.queryByRole('alertdialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' }));
      expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy(); expect(back).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      revert(); expect(unloadPrevented()).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' }));
      expect(back).toHaveBeenCalledOnce(); expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('resets the baseline after Save Draft and guards new edits', async () => {
      const back = vi.fn(() => { expect(unloadPrevented()).toBe(false); });
      render(<CampaignBuilder onBack={back} initialCampaign={mode === 'edit' ? existingDraft as never : undefined} />); fill();
      const body = 'Product details:\nhttps://example.test/products';
      fireEvent.change(screen.getByLabelText(/Body/), { target: { value: body } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
      await waitFor(() => expect(back).toHaveBeenCalledOnce());
      expect(mode === 'edit' ? campaignsApi.update : campaignsApi.create).toHaveBeenCalledOnce();
      expect(screen.getByLabelText(/Body/)).toHaveProperty('value', body);
      expect(unloadPrevented()).toBe(false); expect(screen.queryByRole('alertdialog')).toBeNull();
      const navigate = vi.fn(); act(() => requestNavigation(navigate)); expect(navigate).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' })); expect(back).toHaveBeenCalledTimes(2);
      fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'Edited again' } });
      expect(unloadPrevented()).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' }));
      expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy(); expect(back).toHaveBeenCalledTimes(2);
    });

    it('keeps values, errors and unload protection when Save Draft fails', async () => {
      vi.mocked(mode === 'edit' ? campaignsApi.update : campaignsApi.create).mockRejectedValueOnce(Object.assign(new Error('Save failed'), { fieldErrors: { name: ['Campaign name unavailable'] } }));
      const back = vi.fn();
      render(<CampaignBuilder onBack={back} initialCampaign={mode === 'edit' ? existingDraft as never : undefined} />); fill();
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' })); await screen.findByText('Campaign name unavailable');
      expect(back).not.toHaveBeenCalled(); expect(unloadPrevented()).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' })); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      expect(screen.getByLabelText(/Campaign Name/)).toHaveProperty('value', 'September Campaign');
      expect(screen.getByLabelText(/Body/)).toHaveProperty('value', 'Hi {{first_name}}');
      expect(screen.getByText('Campaign name unavailable')).toBeTruthy(); expect(unloadPrevented()).toBe(true);
    });
  });

  it.each(['Keep editing', 'Close confirmation', 'Escape', 'backdrop'])('preserves all edits and cancels Back on %s', method => {
    const back = vi.fn(); render(<CampaignBuilder onBack={back} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(within(dialog).getByText('Your unsaved campaign changes will be lost.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Discard changes' }).className).toContain('bg-orange-700');
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).toBeNull();
    if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else if (method === 'backdrop') fireEvent.click(document.querySelector('[data-confirm-action-layer] > [aria-hidden]')!);
    else fireEvent.click(within(dialog).getByRole('button', { name: method }));
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(back).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Campaign Name/)).toHaveProperty('value', 'September Campaign');
    expect(screen.getByLabelText(/Target Audience/)).toHaveProperty('value', 'LEADS');
    expect(screen.getByLabelText(/Subject Line/)).toHaveProperty('value', 'Hello {{first_name}}');
    expect(screen.getByLabelText(/Body/)).toHaveProperty('value', 'Hi {{first_name}}');
    expect(unloadPrevented()).toBe(true); expect(campaignsApi.create).not.toHaveBeenCalled(); expect(campaignsApi.update).not.toHaveBeenCalled();
  });

  it('abandons edits and executes Back once without a native unload warning', () => {
    const back = vi.fn(() => { expect(unloadPrevented()).toBe(false); });
    render(<CampaignBuilder onBack={back} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' }));
    const discard = screen.getByRole('button', { name: 'Discard changes' }); fireEvent.click(discard); fireEvent.click(discard);
    expect(back).toHaveBeenCalledOnce(); expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(campaignsApi.create).not.toHaveBeenCalled(); expect(campaignsApi.update).not.toHaveBeenCalled();
  });
});

describe('campaign module navigation', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/marketing/campaigns'); });
  afterEach(() => { window.history.replaceState(null, '', '/'); });
  it.each([
    ['Dashboard', 'dashboard', '/dashboard'], ['Leads', 'leads', '/crm/leads'], ['Contacts', 'contacts', '/crm/contacts'], ['Accounts', 'accounts', '/crm/accounts'],
    ['Deals', 'pipeline', '/crm/pipeline'], ['Deal records', 'deals', '/crm/deals'], ['Tasks', 'tasks', '/operations/taskboard'], ['Campaigns', 'campaigns', '/marketing/campaigns'],
    ['Workflows', 'workflows', '/automation/workflows'], ['Settings', 'settings', '/settings'], ['Team settings', 'settings-users', '/settings?tab=users'],
    ['Profile settings', 'profile-settings', '/settings/profile'], ['Forms', 'forms', '/marketing/forms'], ['Help', 'help', '/help'], ['Inbox', 'inbox', '/inbox'],
  ])('defers %s navigation and resumes the selected destination once', (label, module, destination) => {
    const closeSidebar = vi.fn(() => { expect(unloadPrevented()).toBe(false); }), back = vi.fn();
    render(<><ModuleNavigation label={label} module={module} onNavigated={closeSidebar} /><CampaignBuilder onBack={back} /></>);
    fill();
    const moduleButton = within(screen.getByRole('navigation', { name: 'Workspace' })).getByText(label);
    fireEvent.click(moduleButton);
    expect(routing.push).not.toHaveBeenCalled(); expect(closeSidebar).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(routing.push).not.toHaveBeenCalled(); expect(closeSidebar).not.toHaveBeenCalled(); expect(unloadPrevented()).toBe(true);
    expect(screen.getByLabelText(/Campaign Name/)).toHaveProperty('value', 'September Campaign');
    fireEvent.click(moduleButton);
    const discard = screen.getByRole('button', { name: 'Discard changes' }); fireEvent.click(discard); fireEvent.click(discard);
    expect(routing.push).toHaveBeenCalledExactlyOnceWith(destination); expect(closeSidebar).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledTimes(label === 'Campaigns' ? 1 : 0);
    expect(campaignsApi.create).not.toHaveBeenCalled(); expect(campaignsApi.update).not.toHaveBeenCalled();
  });

  it('allows clean module navigation and returns a clean Campaigns entry to its list', () => {
    const back = vi.fn(), closeSidebar = vi.fn();
    render(<><ModuleNavigation label="Leads" module="leads" /><ModuleNavigation label="Campaigns" module="campaigns" onNavigated={closeSidebar} /><CampaignBuilder onBack={back} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Leads' }));
    expect(routing.push).toHaveBeenLastCalledWith('/crm/leads'); expect(back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Campaigns' }));
    expect(routing.push).toHaveBeenLastCalledWith('/marketing/campaigns'); expect(back).toHaveBeenCalledOnce(); expect(closeSidebar).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it.each([false, true])('navigates from the dedicated Create route without also invoking Back (dirty=%s)', dirty => {
    window.history.replaceState(null, '', '/campaigns/create');
    const back = vi.fn();
    render(<><ModuleNavigation label="Campaigns" module="campaigns" /><CampaignBuilder onBack={back} /></>);
    if (dirty) fill();
    fireEvent.click(screen.getByRole('button', { name: 'Campaigns' }));
    if (dirty) {
      expect(routing.push).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    }
    expect(routing.push).toHaveBeenCalledExactlyOnceWith('/marketing/campaigns'); expect(back).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('resumes internal links including query/hash and clears canceled destinations', () => {
    const clicked = vi.fn((event: React.MouseEvent) => event.preventDefault()), back = vi.fn();
    render(<><a href="/crm/contacts?highlight=contact-1#details" onClick={clicked}>Contact destination</a><CampaignBuilder onBack={back} /></>); fill();
    const link = screen.getByRole('link', { name: 'Contact destination' });
    fireEvent.click(link); expect(clicked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' })); fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(back).toHaveBeenCalledOnce(); expect(clicked).not.toHaveBeenCalled();
    expect(routing.push).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'More edits' } });
    fireEvent.click(link); fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(clicked).not.toHaveBeenCalled(); expect(routing.push).toHaveBeenCalledExactlyOnceWith('/crm/contacts?highlight=contact-1#details');
  });

  it('keeps the first pending destination until confirmation', () => {
    const first = vi.fn(), second = vi.fn();
    render(<><header><button onClick={() => requestNavigation(first)}>First destination</button><button onClick={() => requestNavigation(second)}>Second destination</button></header><CampaignBuilder onBack={vi.fn()} /></>); fill();
    fireEvent.click(screen.getByText('First destination')); fireEvent.click(screen.getByText('Second destination'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
  });

  it.each(['new tab', 'named target', 'download', 'same page', 'exact current', 'external', 'ctrl', 'meta', 'shift', 'alt', 'middle'])('does not intercept %s links while dirty', kind => {
    const clicked = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(<><a href={kind === 'same page' ? '#section' : kind === 'exact current' ? window.location.href : kind === 'external' ? 'https://example.test' : '/crm/contacts'} target={kind === 'new tab' ? '_blank' : kind === 'named target' ? 'other-window' : undefined} download={kind === 'download' || undefined} onClick={clicked}>Destination</a><CampaignBuilder onBack={vi.fn()} /></>); fill();
    fireEvent.click(screen.getByText('Destination'), { ctrlKey: kind === 'ctrl', metaKey: kind === 'meta', shiftKey: kind === 'shift', altKey: kind === 'alt', button: kind === 'middle' ? 1 : 0 });
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(clicked).toHaveBeenCalledOnce(); expect(unloadPrevented()).toBe(true);
  });

  it('guards browser history only while dirty and removes all guards on unmount', () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
    try {
      const clicked = vi.fn();
      render(<nav aria-label="Workspace"><button onClick={() => requestNavigation(clicked)}>Destination</button></nav>);
      const builder = render(<CampaignBuilder onBack={vi.fn()} />);
      const traverse = (navigationType = 'traverse') => {
        const event = new Event('navigate', { cancelable: true });
        Object.assign(event, { navigationType, destination: { url: 'http://localhost/dashboard' } });
        act(() => { navigation.dispatchEvent(event); }); return event;
      };
      expect(traverse().defaultPrevented).toBe(false); expect(unloadPrevented()).toBe(false);
      fill(); expect(traverse('replace').defaultPrevented).toBe(false); expect(traverse().defaultPrevented).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); expect(unloadPrevented()).toBe(true);
      builder.unmount(); expect(traverse().defaultPrevented).toBe(false); expect(unloadPrevented()).toBe(false);
      fireEvent.click(screen.getByText('Destination')); expect(clicked).toHaveBeenCalledOnce();
    } finally { Reflect.deleteProperty(window, 'navigation'); }
  });
});

describe('campaign guard interactions', () => {
  it('keeps invalid drafts dirty without resetting values', () => {
    render(<CampaignBuilder onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Body/), { target: { value: 'Unsaved body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect(campaignsApi.create).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toMatch(/required/);
    expect(unloadPrevented()).toBe(true); expect(screen.getByLabelText(/Body/)).toHaveProperty('value', 'Unsaved body');
  });

  it('reopens a saved draft clean and guards later edits', async () => {
    const back = vi.fn(), builder = render(<CampaignBuilder onBack={back} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' })); await waitFor(() => expect(back).toHaveBeenCalledOnce());
    builder.unmount();
    const saved = vi.mocked(campaignsApi.create).mock.calls[0][0];
    render(<CampaignBuilder onBack={back} initialCampaign={{ ...saved, id: 'saved-id', type: 'Email', status: 'Draft' } as never} />);
    expect(unloadPrevented()).toBe(false);
    fireEvent.change(screen.getByLabelText(/Body/), { target: { value: 'New body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
  });

  it('keeps preview, picker, send-menu, schedule and audience-panel visibility clean', async () => {
    const back = vi.fn(); render(<CampaignBuilder onBack={back} initialCampaign={existingDraft as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desktop preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mobile preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide live preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show live preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    await schedulePicker(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Schedule Send' })).toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create New/ })); });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Create Target Audience' })).getByRole('button', { name: 'Cancel' }));
    expect(unloadPrevented()).toBe(false); expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' })); expect(back).toHaveBeenCalledOnce();
  });

  it('allows type, audience, variable, preview, Send and Schedule interactions while dirty', async () => {
    const back = vi.fn(); render(<CampaignBuilder onBack={back} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'CONTACTS' } });
    fireEvent.click(await screen.findByRole('button', { name: '{{firstName}}' }));
    expect(screen.getByLabelText(/Body/)).toHaveProperty('value', expect.stringContaining('{{firstName}}'));
    fireEvent.click(screen.getByRole('button', { name: 'Desktop preview' }));
    await schedulePicker(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Schedule Send' })).toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create New/ })); });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Create Target Audience' })).getByRole('button', { name: 'Cancel' }));
    fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: audience.id } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit saved audience' })); });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Edit Target Audience' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(back).not.toHaveBeenCalled(); expect(unloadPrevented()).toBe(true);
  });

  it.each(['Email', 'SMS'])('allows successful %s sending to leave without confirmation or an unload warning', async type => {
    const back = vi.fn(() => { expect(unloadPrevented()).toBe(false); });
    render(<CampaignBuilder onBack={back} initialType={type} />);
    fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'Send campaign' } });
    fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'LEADS' } });
    if (type === 'Email') fireEvent.change(screen.getByLabelText(/Subject Line/), { target: { value: 'Subject' } });
    fireEvent.change(screen.getByLabelText(/Body/), { target: { value: 'Message' } });
    expect(unloadPrevented()).toBe(true); sendNow();
    await waitFor(() => expect(back).toHaveBeenCalledOnce());
    expect(campaignsApi.send).toHaveBeenCalledExactlyOnceWith('saved-id'); expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('campaign composer', () => {
  it.each([['Email', 'LEADS'], ['Email', 'CONTACTS'], ['SMS', 'LEADS'], ['SMS', 'CONTACTS']] as const)('inserts canonical quick fields and picker company keys for %s/%s', async (type, source) => {
    render(<CampaignBuilder onBack={vi.fn()} initialType={type} />);
    fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: source } });
    const body = screen.getByLabelText(/Body/) as HTMLTextAreaElement;
    expect(body.placeholder).toContain('{{firstName}}');
    expect(body.placeholder).not.toContain('{{first_name}}');
    if (type === 'Email') expect((screen.getByLabelText(/Subject Line/) as HTMLInputElement).placeholder).toContain('{{firstName}}');
    const companyKey = 'companyName';
    for (const key of ['firstName', companyKey, 'sender_name', 'sender_email']) {
      fireEvent.change(body, { target: { value: '' } });
      fireEvent.focus(body);
      fireEvent.click(await screen.findByRole('button', { name: `{{${key}}}` }));
      expect(body.value).toBe(`{{${key}}}`);
    }
    fireEvent.change(body, { target: { value: '' } });
    fireEvent.focus(body);
    fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    const search = await screen.findByLabelText('Search variables');
    const picker = within(search.closest('.max-h-80') as HTMLElement);
    fireEvent.click(picker.getByText(`{{${companyKey}}}`).closest('button')!);
    expect(body.value).toBe(`{{${companyKey}}}`);
    expect(body.value).not.toContain('{{company_name}}');
  });

  it.each([
    ['Email', 'create'], ['Email', 'edit'], ['SMS', 'create'], ['SMS', 'edit'],
  ] as const)('limits the %s %s picker to Lead/Contact fields and preserves Quick Fields', async (type, mode) => {
    const body = 'Saved {{first_name}} {{website}} {{value}}';
    render(<CampaignBuilder onBack={vi.fn()} initialType={type} initialCampaign={mode === 'edit' ? { id: 'saved-id', name: 'Existing', type, status: 'Draft', subject: 'Saved subject', body, audienceSource: 'LEADS' } as never : undefined} />);
    fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'LEADS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    const search = await screen.findByLabelText('Search variables');
    await screen.findByRole('button', { name: /First Name.*firstName.*Leads, Contacts/ });
    const picker = search.closest('.max-h-80')!;
    for (const source of ['LEADS', 'CONTACTS']) {
      fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: source } });
      expect(picker.textContent).not.toMatch(/Accounts|Deals/);
      for (const key of ['website', 'value', 'industry', 'pipelineId', 'stageId']) expect(within(picker as HTMLElement).queryByText(`{{${key}}}`)).toBeNull();
      expect(within(picker as HTMLElement).getAllByText('{{firstName}}')).toHaveLength(1);
      expect(screen.getByRole('button', { name: source === 'LEADS' ? '{{companyName}}' : '{{companyName}}' })).toBeTruthy();
      expect(within(picker as HTMLElement).getByText('{{sender_name}}')).toBeTruthy();
      expect(within(picker as HTMLElement).getByText('{{sender_email}}')).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    if (mode === 'edit') {
      expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe(body);
      expect(screen.queryByText(/Repair unavailable variables for this source/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
      await waitFor(() => expect(campaignsApi.update).toHaveBeenCalledWith('saved-id', expect.objectContaining({ body })));
    }
  });
  it('uses one modal preview on small screens, traps focus and preserves form values', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    try {
      render(<CampaignBuilder onBack={vi.fn()} />); fill();
      expect(screen.queryByText('Live Preview')).toBeNull();
      const opener = screen.getByRole('button', { name: 'Show live preview' }); opener.focus();
      fireEvent.click(opener);
      await screen.findByRole('dialog');
      expect(opener.getAttribute('aria-label')).toBe('Hide live preview');
      expect(document.querySelectorAll('#campaign-live-preview')).toHaveLength(1);
      expect(document.body.style.overflow).toBe('hidden');
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
      await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
      expect(document.activeElement).toBe(opener);
      expect((screen.getByLabelText(/Campaign Name/) as HTMLInputElement).value).toBe('September Campaign');
      expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe('Hi {{first_name}}');
      fireEvent.click(opener); await screen.findByRole('dialog'); fireEvent.click(opener);
      await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
      expect(opener.getAttribute('aria-label')).toBe('Show live preview');
      expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe('Hi {{first_name}}');
      fireEvent.click(opener); await screen.findByRole('dialog'); fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
    } finally { vi.unstubAllGlobals(); }
  });
  it('previews pasted URLs as anchors and preserves the safe draft through reopening', async () => {
    render(<CampaignBuilder onBack={vi.fn()} initialCampaign={{ id: 'draft', name: 'Links', type: 'Email', status: 'Draft', body: 'Hi {{first_name}}\nhttps://camxian.com/products?a=1&b=2', subject: 'Hi' } as never} />);
    const frame = screen.getByTitle('Email body preview');
    expect(frame.getAttribute('srcdoc')).toContain('<a href="https://camxian.com/products?a=1&amp;b=2" style="color: #2563eb; text-decoration: underline;">');
    expect(frame.getAttribute('srcdoc')).toContain('Hi John<br>');
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(campaignsApi.update).toHaveBeenCalledWith('draft', expect.objectContaining({ body: 'Hi {{first_name}}<br><a href="https://camxian.com/products?a=1&amp;b=2" style="color: #2563eb; text-decoration: underline;">https://camxian.com/products?a=1&amp;b=2</a>' })));
    expect(campaignsApi.send).not.toHaveBeenCalled();
  });
  it('saves the pasted product-services URL as an anchor before Send Now', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    fireEvent.change(screen.getByLabelText(/Body/), { target: { value: 'hi click this link if you have any inquiries of our products:\nhttps://camxian.com/product-services/' } });
    sendNow();
    await waitFor(() => expect(campaignsApi.send).toHaveBeenCalledOnce());
    expect(campaignsApi.create).toHaveBeenCalledWith(expect.objectContaining({ body: 'hi click this link if you have any inquiries of our products:<br><a href="https://camxian.com/product-services/" style="color: #2563eb; text-decoration: underline;">https://camxian.com/product-services/</a>' }));
  });
  it('uses one panel toggle after Send Now and preserves preview device switching', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />);
    const actions = screen.getByRole('group', { name: 'Campaign actions' });
    expect([...actions.querySelectorAll('button')].map(button => button.getAttribute('aria-label') || button.textContent)).toEqual(['Save Draft', 'Send', 'Hide live preview']);
    expect(document.querySelector('svg.lucide-eye, svg.lucide-eye-off')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close preview' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Desktop preview' }));
    expect(screen.getByRole('button', { name: 'Mobile preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide live preview' }));
    expect(screen.queryByText('Live Preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show live preview' }));
    expect(screen.getByText('Live Preview')).toBeTruthy();
    await act(async () => {});
  });
  it('allows editing a draft without enabling Send', async () => {
    access.denied.add('campaigns.send');
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(campaignsApi.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(campaignsApi.create).toHaveBeenCalledTimes(1));
  });
  it('lets an explicitly authorized sender send a saved draft without editing it', async () => {
    access.denied.add('campaigns.edit'); access.denied.add('campaigns.create');
    render(<CampaignBuilder onBack={vi.fn()} initialCampaign={{ id: 'saved-id', name: 'Existing', type: 'Email', status: 'Draft', subject: 'Saved subject', body: 'Saved body', audienceSource: 'LEADS' } as never} />);
    expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText(/Campaign Name/).closest('fieldset')?.disabled).toBe(true);
    sendNow();
    await waitFor(() => expect(campaignsApi.send).toHaveBeenCalledWith('saved-id'));
    expect(campaignsApi.update).not.toHaveBeenCalled(); expect(campaignsApi.create).not.toHaveBeenCalled();
  });
  it('places one required error below each field without calling the API', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />);
    sendNow();
    expect(await screen.findAllByRole('alert')).toHaveLength(4);
    expect(screen.getByLabelText(/Campaign Name/).nextElementSibling?.textContent).toContain('required');
    expect(screen.getByLabelText(/Subject Line/).nextElementSibling?.textContent).toContain('required');
    expect(screen.getByLabelText(/Body/).nextElementSibling?.textContent).toContain('required');
    expect(campaignsApi.create).not.toHaveBeenCalled();
  });
  it('saves a database draft with its selected audience and content without sending', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(campaignsApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'September Campaign', audienceSource: 'LEADS', body: 'Hi {{first_name}}', subject: 'Hello {{first_name}}' })));
    expect(campaignsApi.send).not.toHaveBeenCalled();
  });
  it('prevents double clicks and reports submitted counts, not delivery', async () => {
    let finish!: (value: Awaited<ReturnType<typeof campaignsApi.send>>) => void;
    vi.mocked(campaignsApi.send).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send' })); const send = screen.getByRole('menuitem', { name: 'Send Now' }); fireEvent.click(send); fireEvent.click(send);
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
    sendNow();
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
    sendNow();
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
    sendNow();
    expect(await screen.findByText('Daily allowance reached.')).toBeTruthy(); expect(back).not.toHaveBeenCalled();
    expect(unloadPrevented()).toBe(true); expect(screen.queryByRole('alertdialog')).toBeNull();
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
    expect(audiencesApi.create).toHaveBeenCalledWith({ name: 'New audience', source: 'LEADS', matchMode: 'AND', conditions: [] });
    expect(screen.queryByRole('alertdialog')).toBeNull(); await waitFor(() => expect(unloadPrevented()).toBe(true));
  });
  it('inserts variables at Subject and Body selections and exposes the same chips as draggable text', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    await screen.findByRole('button', { name: '{{firstName}}' });
    const subject = screen.getByLabelText(/Subject Line/) as HTMLInputElement;
    fireEvent.change(subject, { target: { value: 'Your proposal' } }); fireEvent.focus(subject); subject.setSelectionRange(5, 5);
    fireEvent.click(screen.getByRole('button', { name: '{{firstName}}' }));
    expect(subject.value).toBe('Your {{firstName}}proposal');
    const body = screen.getByLabelText(/Body/) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: 'Thank you, customer.' } }); fireEvent.focus(body); body.setSelectionRange(11, 19);
    fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    fireEvent.click(screen.getByRole('button', { name: /Company Name.*companyName.*Leads/ }));
    expect(body.value).toBe('Thank you, {{companyName}}.');
    const setData = vi.fn(); const transfer = { setData, effectAllowed: '' };
    const chip = screen.getByRole('button', { name: '{{firstName}}' });
    expect(chip.getAttribute('draggable')).toBe('true'); fireEvent.dragStart(chip, { dataTransfer: transfer });
    expect(setData).toHaveBeenCalledWith('text/plain', '{{firstName}}');
    expect(campaignsApi.send).not.toHaveBeenCalled();
  });
  it('previews only entered SMS and sends if the organization email lookup fails', async () => {
    vi.mocked(campaignsApi.smsSettings).mockRejectedValueOnce(new Error('Settings unavailable'));
    render(<CampaignBuilder onBack={vi.fn()} initialType="SMS" initialContent="Hi {{first_name}}, your proposal is ready." />);
    fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'SMS campaign' } });
    fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'LEADS' } });
    await screen.findByText('Hi John, your proposal is ready.');
    expect(screen.queryByText(/For inquiries regarding|This is a no-reply/)).toBeNull();
    expect(screen.queryByLabelText(/Subject Line/)).toBeNull();
    await waitFor(() => expect(audiencesApi.preview).toHaveBeenCalledWith(expect.objectContaining({ channel: 'SMS' })));
    sendNow();
    await waitFor(() => expect(campaignsApi.send).toHaveBeenCalledOnce());
    expect(campaignsApi.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'SMS', body: 'Hi {{first_name}}, your proposal is ready.' }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('SMS campaign submitted. Waiting for gateway confirmation.'));
    expect(campaignsApi.get).not.toHaveBeenCalled();
  });
  it('schedules once using an explicit Manila date converted to UTC and does not call Send Now', async () => {
    frozenManilaAfternoon();
    const onBack = vi.fn(() => { expect(unloadPrevented()).toBe(false); }); render(<CampaignBuilder onBack={onBack} />); fill();
    const picker = await schedulePicker();
    fireEvent.click(within(picker).getByRole('button', { name: '12' }));
    fireEvent.change(screen.getByLabelText('Schedule hour'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Schedule minute'), { target: { value: '59' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(campaignsApi.schedule).toHaveBeenCalledWith('saved-id', '2026-10-12T07:59:00.000Z'));
    expect(campaignsApi.send).not.toHaveBeenCalled(); expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('cancels an unclaimed saved schedule before editing, with Send Now and draft inputs disabled', async () => {
    render(<CampaignBuilder onBack={vi.fn()} initialCampaign={{ id: 'saved-id', name: 'Scheduled', type: 'Email', status: 'scheduled', subject: 'Hi', body: 'Hello', audienceSource: 'LEADS', scheduledFor: '2099-10-11T02:30:00.000Z' } as never} />);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel schedule' }));
    await waitFor(() => expect(campaignsApi.cancelSchedule).toHaveBeenCalledWith('saved-id'));
    expect(campaignsApi.update).not.toHaveBeenCalled();
  });

  it('removes inline delivery controls and opens exactly two icon menu items without mutation', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    expect(screen.queryByLabelText('Delivery')).toBeNull();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(screen.queryByText(/within the backend polling/)).toBeNull();
    const send = screen.getByRole('button', { name: 'Send' }); send.focus();
    expect(send.querySelector('svg.lucide-send')).toBeNull();
    expect(send.querySelector('svg.lucide-chevron-down')).toBeTruthy();
    fireEvent.keyDown(send, { key: 'ArrowDown' });
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Send Now', 'Schedule Send']);
    expect(screen.getByRole('menuitem', { name: 'Send Now' }).querySelector('svg.lucide-send')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Schedule Send' }).querySelector('svg.lucide-calendar-clock')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(send);
    expect(campaignsApi.create).not.toHaveBeenCalled(); expect(campaignsApi.send).not.toHaveBeenCalled(); expect(campaignsApi.schedule).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('Cancel and Escape close the shared picker without saving, preserve fields and restore focus', async () => {
    frozenManilaAfternoon();
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    const picker = await schedulePicker();
    expect(within(picker).queryByText(/scheduler's processing interval/)).toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    expect(picker.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(picker).getByRole('button', { name: '12' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send' }));
    expect((screen.getByLabelText(/Target Audience/) as HTMLSelectElement).value).toBe('LEADS');
    expect((screen.getByLabelText(/Subject Line/) as HTMLInputElement).value).toBe('Hello {{first_name}}');
    expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe('Hi {{first_name}}');
    await schedulePicker(); fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
    expect(campaignsApi.create).not.toHaveBeenCalled(); expect(campaignsApi.update).not.toHaveBeenCalled(); expect(campaignsApi.send).not.toHaveBeenCalled(); expect(campaignsApi.schedule).not.toHaveBeenCalled();
  });

  it('disables yesterday and elapsed or equal times today without Task rollover, then accepts a future minute', async () => {
    frozenManilaAfternoon();
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    const picker = await schedulePicker();
    expect((within(picker).getByRole('button', { name: '10' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Schedule hour'), { target: { value: '3' } });
    expect((screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Schedule minute'), { target: { value: '59' } });
    fireEvent.change(screen.getByLabelText('Schedule hour'), { target: { value: '2' } });
    expect(screen.getByText('Choose a future date and time.')).toBeTruthy();
    expect(screen.queryByText(/Next occurrence/)).toBeNull();
    expect(campaignsApi.schedule).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Schedule hour'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Schedule minute'), { target: { value: '01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(campaignsApi.schedule).toHaveBeenCalledWith('saved-id', '2026-10-11T07:01:00.000Z'));
  });

  it('shows form validation inside the schedule dialog before any draft or schedule mutation', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />);
    const picker = await schedulePicker(); fireEvent.click(within(picker).getByRole('button', { name: 'Done' }));
    expect(within(picker).getByRole('alert').textContent).toContain('required');
    expect(campaignsApi.create).not.toHaveBeenCalled(); expect(campaignsApi.schedule).not.toHaveBeenCalled();
  });

  it('retains the selected instant and same saved draft after scheduling failure, then retries once', async () => {
    frozenManilaAfternoon();
    vi.mocked(campaignsApi.schedule).mockRejectedValueOnce(new Error('No eligible recipients.'));
    const back = vi.fn(); render(<CampaignBuilder onBack={back} />); fill();
    await schedulePicker(); fireEvent.change(screen.getByLabelText('Schedule minute'), { target: { value: '23' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Campaign draft saved, but scheduling failed. No eligible recipients.')).toBeTruthy();
    expect((screen.getByLabelText('Schedule minute') as HTMLSelectElement).value).toBe('23');
    expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe('Hi {{first_name}}');
    expect(back).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled(); expect(campaignsApi.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(back).toHaveBeenCalledOnce());
    expect(campaignsApi.create).toHaveBeenCalledOnce(); expect(campaignsApi.update).toHaveBeenCalledWith('saved-id', expect.any(Object));
    expect(vi.mocked(campaignsApi.schedule).mock.calls.map(call => call.slice(0, 2))).toEqual([['saved-id', '2026-10-11T08:23:00.000Z'], ['saved-id', '2026-10-11T08:23:00.000Z']]);
  });

  it('freezes all picker controls, blocks dismissal and conflicting requests during a slow schedule', async () => {
    let finish!: (value: Awaited<ReturnType<typeof campaignsApi.schedule>>) => void;
    vi.mocked(campaignsApi.schedule).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const back = vi.fn(); render(<CampaignBuilder onBack={back} />); fill();
    const picker = await schedulePicker(), done = within(picker).getByRole('button', { name: 'Done' });
    fireEvent.click(done); fireEvent.click(done);
    await waitFor(() => expect(campaignsApi.schedule).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Schedule minute').closest('fieldset')?.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' })); fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Schedule Send' })).toBeTruthy();
    expect(campaignsApi.create).toHaveBeenCalledOnce(); expect(campaignsApi.update).not.toHaveBeenCalled(); expect(campaignsApi.send).not.toHaveBeenCalled();
    await act(async () => finish({ success: true, data: { id: 'saved-id', status: 'scheduled' } as never }));
    expect(back).toHaveBeenCalledOnce();
  });

  it('revalidates after a slow draft save so an elapsed selection never reaches the scheduling API', async () => {
    frozenManilaAfternoon();
    let finish!: (value: Awaited<ReturnType<typeof campaignsApi.create>>) => void;
    vi.mocked(campaignsApi.create).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<CampaignBuilder onBack={vi.fn()} />); fill(); await schedulePicker();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(campaignsApi.create).toHaveBeenCalledOnce());
    vi.setSystemTime(new Date('2026-10-11T08:00:01Z'));
    await act(async () => finish({ success: true, data: { id: 'saved-id' } as never }));
    expect(screen.getByRole('alert').textContent).toContain('Campaign draft saved, but scheduling failed. Choose a valid future');
    expect(campaignsApi.schedule).not.toHaveBeenCalled(); expect(campaignsApi.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
    await schedulePicker(); expect((screen.getByLabelText('Schedule hour') as HTMLSelectElement).value).toBe('5');
  });

  it('reschedules a locked campaign through the shared picker without creating or editing its draft', async () => {
    frozenManilaAfternoon();
    const back = vi.fn(); render(<CampaignBuilder onBack={back} initialCampaign={{ id: 'saved-id', name: 'Scheduled', type: 'Email', status: 'scheduled', subject: 'Hi', body: 'Hello', audienceSource: 'LEADS', scheduledFor: '2026-10-12T07:59:00.000Z' } as never} />);
    const opener = screen.getByRole('button', { name: 'Reschedule' }); opener.focus(); fireEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Reschedule Campaign' });
    expect((screen.getByLabelText('Schedule hour') as HTMLSelectElement).value).toBe('3');
    fireEvent.change(screen.getByLabelText('Schedule minute'), { target: { value: '58' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(campaignsApi.schedule).toHaveBeenCalledWith('saved-id', '2026-10-12T07:58:00.000Z'));
    expect(campaignsApi.create).not.toHaveBeenCalled(); expect(campaignsApi.update).not.toHaveBeenCalled(); expect(campaignsApi.send).not.toHaveBeenCalled(); expect(back).toHaveBeenCalledOnce();
  });

  it('schedules SMS through the same future-time flow and preserves the SMS payload and sender checks', async () => {
    frozenManilaAfternoon();
    render(<CampaignBuilder onBack={vi.fn()} initialType="SMS" initialContent="Hi {{firstName}} from {{sender_name}}" />);
    fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'SMS schedule' } });
    fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'CONTACTS' } });
    await screen.findByText(/Hi John from Configured SMS organization/);
    await schedulePicker(); fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(campaignsApi.schedule).toHaveBeenCalledWith('saved-id', '2026-10-11T08:00:00.000Z'));
    expect(campaignsApi.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'SMS', audienceSource: 'CONTACTS', body: 'Hi {{firstName}} from {{sender_name}}' }));
    expect(campaignsApi.send).not.toHaveBeenCalled();
  });

  it('uses the newly selected source catalog after a failed schedule returns to Draft', async () => {
    const contactField = { ...getCrmFieldCatalog('contacts')[0], technicalKey: 'contactNote', label: 'Contact Note', kind: 'Custom' as const, required: false, mandatory: false };
    vi.mocked(campaignsApi.variableFields).mockResolvedValue({ success: true, data: [...CUSTOM_FIELD_MODULES.flatMap(module => getCrmFieldCatalog(module)), contactField] });
    render(<CampaignBuilder onBack={vi.fn()} initialCampaign={{ id: 'saved-id', name: 'Repair schedule', type: 'Email', status: 'Draft', subject: 'Hi', body: 'Hello {{contactNote}}', audienceSource: 'LEADS', scheduleConfig: { source: 'LEADS', matchMode: 'AND', conditions: [], timezone: 'Asia/Manila', scheduleFailureReason: 'No eligible recipients.' } } as never} />);
    fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'CONTACTS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    expect(await screen.findByRole('button', { name: /Contact Note.*contactNote/ })).toBeTruthy();
    expect(screen.queryByText(/Repair unavailable variables for this source/)).toBeNull();
    const frame = screen.getByTitle('Email body preview');
    expect(frame.getAttribute('srcdoc')).toContain('Hello Example Contact Note');
    await waitFor(() => expect(audiencesApi.preview).toHaveBeenCalledWith(expect.objectContaining({ source: 'CONTACTS' })));
    expect(screen.getByText('Schedule failed: No eligible recipients.')).toBeTruthy();
  });

  it('refreshes configured labels and sender values on existing cache invalidation without rewriting draft tokens', async () => {
    render(<CampaignBuilder onBack={vi.fn()} />); fill();
    await screen.findByRole('button', { name: '{{firstName}}' });
    fireEvent.change(screen.getByLabelText(/Body/), { target: { value: '{{firstName}} {{sender_name}} {{sender_email}}' } });
    await waitFor(() => expect(screen.getByTitle('Email body preview').getAttribute('srcdoc')).toContain('John Configured test sender sender@example.test'));
    vi.mocked(campaignsApi.variableFields).mockResolvedValue({ success: true, data: CUSTOM_FIELD_MODULES.flatMap(module => getCrmFieldCatalog(module)).map(field => field.technicalKey === 'firstName' && field.module === 'leads' ? { ...field, label: 'Customer First Name' } : field) });
    vi.mocked(campaignsApi.emailSettings).mockResolvedValue({ success: true, data: { senderName: 'Changed sender', senderEmail: 'changed@example.test' } });
    act(() => invalidatePageCache('settings'));
    await waitFor(() => expect(screen.getByTitle('Email body preview').getAttribute('srcdoc')).toContain('John Changed sender changed@example.test'));
    fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    expect(await screen.findByRole('button', { name: /Customer First Name.*firstName.*Leads/ })).toBeTruthy();
    expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toBe('{{firstName}} {{sender_name}} {{sender_email}}');
  });

  it('previews the current SMS organization identity and blocks missing sender tokens while keeping the draft savable', async () => {
    render(<CampaignBuilder onBack={vi.fn()} initialType="SMS" initialContent="{{sender_name}} {{sender_email}}" />);
    fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'SMS identity' } });
    fireEvent.change(screen.getByLabelText(/Target Audience/), { target: { value: 'LEADS' } });
    await screen.findByText(/Configured SMS organization info@example.test/);
    vi.mocked(campaignsApi.smsSettings).mockResolvedValue({ success: true, data: { organizationName: 'Renamed SMS organization', organizationEmail: null } });
    act(() => invalidatePageCache('settings'));
    await screen.findByText(/Renamed SMS organization Sender email unavailable/);
    sendNow();
    expect(screen.getByRole('alert').textContent).toContain('Configure the sender');
    expect(campaignsApi.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(campaignsApi.create).toHaveBeenCalledWith(expect.objectContaining({ body: '{{sender_name}} {{sender_email}}' })));
  });

});
