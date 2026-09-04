'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, X, Globe, Search, Check, ChevronDown, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/store/AuthContext';
import { domainsApi, TenantDomain, TenantDomainSettings } from '@/shared/services/domains.api';
import { cn } from '@/lib/utils';
import { USE_MOCK_DATA } from '@/lib/config';

interface DomainsSubTabProps {
  roleNames: string[];
}

const DEFAULT_SETTINGS: TenantDomainSettings = {
  id: null,
  tenantId: '',
  restrictToEmailDomains: false,
  joinPolicy: 'after_approval',
  defaultRole: 'Sales Rep',
  createdAt: null,
  updatedAt: null,
};

export function DomainsSubTab({ roleNames }: DomainsSubTabProps): React.ReactElement {
  const { userCan } = useAuth();
  const canManage = userCan('users', 'canEdit');

  const [domains, setDomains] = useState<TenantDomain[]>([]);
  const [settings, setSettings] = useState<TenantDomainSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Local settings draft (committed on Save)
  const [draftSettings, setDraftSettings] = useState<TenantDomainSettings>(DEFAULT_SETTINGS);

  // Add domain modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [domainInput, setDomainInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Role dropdown
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
  const [roleSearch, setRoleSearch] = useState('');
  const roleDropdownRef = useRef<HTMLDivElement>(null);

  const filteredRoles = useMemo(
    () => roleNames.filter((r) => r.toLowerCase().includes(roleSearch.toLowerCase())),
    [roleNames, roleSearch],
  );

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target as Node)) setIsRoleDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (USE_MOCK_DATA) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [domainsRes, settingsRes] = await Promise.all([
        domainsApi.getAll(),
        domainsApi.getSettings(),
      ]);
      setDomains(domainsRes.data ?? []);
      const s = settingsRes.data ?? DEFAULT_SETTINGS;
      setSettings(s);
      setDraftSettings(s);
    } catch {
      // non-critical
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddDomain = async () => {
    if (!domainInput.trim() || !domainInput.includes('.')) { toast.error('Enter a valid domain (e.g. example.com)'); return; }
    setIsAdding(true);
    try {
      const res = await domainsApi.create(domainInput.trim().toLowerCase());
      setDomains((prev) => [...prev, res.data]);
      setDomainInput(''); setIsAddOpen(false);
      toast.success(`Domain ${res.data.domain} added (pending verification)`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add domain');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveDomain = async (id: string) => {
    const domain = domains.find((d) => d.id === id);
    try {
      await domainsApi.remove(id);
      setDomains((prev) => prev.filter((d) => d.id !== id));
      toast.success(`Domain ${domain?.domain ?? ''} removed`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove domain');
    }
  };

  const handleVerifyDomain = async (id: string) => {
    try {
      const res = await domainsApi.verify(id);
      setDomains((prev) => prev.map((d) => d.id === id ? res.data : d));
      toast.success('Domain verified');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to verify domain');
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const res = await domainsApi.updateSettings({
        restrictToEmailDomains: draftSettings.restrictToEmailDomains,
        joinPolicy: draftSettings.joinPolicy,
        defaultRole: draftSettings.defaultRole,
      });
      setSettings(res.data);
      setDraftSettings(res.data);
      toast.success('Domain settings saved');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  if (isLoading) return <div className="py-20 text-center text-xs text-slate-400">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Domain table */}
      <div className="bg-white dark:bg-slate-900/60 border border-gray-200 dark:border-white/[0.07] rounded-xl overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_100px_auto] gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.05]">
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Domain</span>
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</span>
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Verified On</span>
          <span />
        </div>

        {domains.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">No domains configured yet.</div>
        ) : domains.map((d) => (
          <div key={d.id} className="grid grid-cols-[2fr_1fr_100px_auto] gap-3 px-4 py-3 items-center border-b border-gray-100 dark:border-white/[0.04] last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
            <div className="flex items-center gap-2">
              <Globe size={13} className="text-slate-400 shrink-0" />
              <span className="text-xs font-medium text-slate-900 dark:text-white">{d.domain}</span>
            </div>
            <div>
              {d.isVerified
                ? <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold rounded border border-emerald-500/20 flex items-center gap-1 w-fit"><CheckCircle2 size={10} /> Verified</span>
                : <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold rounded border border-amber-500/20 w-fit block">Pending</span>
              }
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">{d.verifiedAt ? new Date(d.verifiedAt).toLocaleDateString() : '—'}</span>
            <div className="flex items-center gap-1">
              {canManage && !d.isVerified && (
                <button onClick={() => handleVerifyDomain(d.id)} title="Mark as verified"
                  className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg cursor-pointer transition-colors">
                  <CheckCircle2 size={13} />
                </button>
              )}
              {canManage && (
                <button onClick={() => handleRemoveDomain(d.id)} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg cursor-pointer transition-colors"><X size={13} /></button>
              )}
            </div>
          </div>
        ))}

        {canManage && (
          <div className="px-4 py-3 border-t border-gray-100 dark:border-white/[0.04]">
            <button onClick={() => setIsAddOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-white/[0.08] rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
              <Plus size={13} /> Add domain
            </button>
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="space-y-5">
        {/* Restrict toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDraftSettings((s) => ({ ...s, restrictToEmailDomains: !s.restrictToEmailDomains }))}
            disabled={!canManage}
            className={cn('w-10 h-6 rounded-full transition-colors cursor-pointer flex items-center px-0.5 shrink-0 disabled:opacity-50',
              draftSettings.restrictToEmailDomains ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600')}
            role="switch" aria-checked={draftSettings.restrictToEmailDomains}>
            <div className={cn('w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200',
              draftSettings.restrictToEmailDomains ? 'translate-x-[18px]' : 'translate-x-0')} />
          </button>
          <span className="text-xs text-slate-600 dark:text-slate-300">Restrict new users to emails from these domains</span>
        </div>

        {/* Join policy */}
        <div className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">Anyone with an email at these domains can join this organisation…</p>
          {(['instantly', 'after_approval'] as const).map((policy) => (
            <label key={policy} className={cn('flex items-center gap-2.5', canManage && 'cursor-pointer')}>
              <button onClick={() => canManage && setDraftSettings((s) => ({ ...s, joinPolicy: policy }))}
                className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors shrink-0', canManage && 'cursor-pointer',
                  draftSettings.joinPolicy === policy ? 'border-blue-500' : 'border-slate-400 dark:border-slate-600')}>
                {draftSettings.joinPolicy === policy && <div className="w-2 h-2 rounded-full bg-blue-500" />}
              </button>
              <span className="text-xs text-slate-700 dark:text-slate-300">{policy === 'after_approval' ? 'After approval' : 'Instantly'}</span>
            </label>
          ))}
        </div>

        {/* Default role */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">Default member role</label>
          <div ref={roleDropdownRef} className="relative max-w-xs">
            <button onClick={() => canManage && setIsRoleDropdownOpen((v) => !v)} disabled={!canManage}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500 disabled:opacity-50 cursor-pointer">
              {draftSettings.defaultRole}
              <ChevronDown size={13} className={cn('transition-transform', isRoleDropdownOpen && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {isRoleDropdownOpen && (
                <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-xl shadow-lg z-20 overflow-hidden">
                  <div className="p-2 border-b border-gray-100 dark:border-white/[0.05]">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)} placeholder="Search…"
                        className="w-full pl-7 pr-2 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs rounded-lg focus:outline-none border border-slate-200 dark:border-slate-700" />
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto custom-scrollbar">
                    {filteredRoles.map((r) => (
                      <button key={r} onClick={() => { setDraftSettings((s) => ({ ...s, defaultRole: r })); setIsRoleDropdownOpen(false); setRoleSearch(''); }}
                        className={cn('w-full flex items-center justify-between px-3 py-2 text-xs cursor-pointer transition-colors',
                          r === draftSettings.defaultRole ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04]')}>
                        {r}
                        {r === draftSettings.defaultRole && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {canManage && (
          <div className="flex justify-end">
            <button onClick={handleSaveSettings} disabled={isSavingSettings}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors">
              {isSavingSettings ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        )}
      </div>

      {/* Add domain modal */}
      <AnimatePresence>
        {isAddOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setIsAddOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.07]">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add Domain</h3>
                <button onClick={() => setIsAddOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"><X size={16} /></button>
              </div>
              <div className="px-6 py-5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Domain</label>
                <input type="text" value={domainInput} onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
                  placeholder="example.com" autoFocus
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-blue-500 text-slate-900 dark:text-white rounded-lg text-sm focus:outline-none" />
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-white/[0.07]">
                <button onClick={() => setIsAddOpen(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer">Cancel</button>
                <button onClick={handleAddDomain} disabled={isAdding}
                  className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg cursor-pointer">
                  {isAdding ? 'Adding…' : 'Add Domain'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
