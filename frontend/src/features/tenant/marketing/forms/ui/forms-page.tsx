'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Layout, Trash2, ExternalLink, MoreHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '@/store/AuthContext';
import { toast } from 'sonner';
import { FormRecord } from '../types/form.types';
import { getFormsByTenant, createForm, deleteForm } from '../services/forms.service';
import { FormBuilderPage } from './form-builder-page';

export default function FormsPage(): React.ReactElement {
  const { tenant } = useAuth();
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [activeForm, setActiveForm] = useState<FormRecord | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newFormName, setNewFormName] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant?.id) return;
    const loadForms = async (): Promise<void> => {
      try {
        const loaded = await getFormsByTenant(tenant.id);
        setForms(loaded);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to load forms');
      }
    };
    void loadForms();
  }, [tenant?.id]);

  const handleCreate = async (): Promise<void> => {
    if (!newFormName.trim()) { toast.error('Form name is required'); return; }
    if (!tenant?.id) { toast.error('Unable to save. Please refresh and try again.'); return; }
    try {
      const form = await createForm({ name: newFormName.trim(), tenantId: tenant.id });
      setForms((prev) => [...prev, form]);
      setNewFormName('');
      setIsCreating(false);
      setActiveForm(form);
      toast.success('Form created');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create form');
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await deleteForm(id);
      setForms((prev) => prev.filter((f) => f.id !== id));
      setOpenMenuId(null);
      toast.success('Form deleted');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete form');
    }
  };

  const handleFormUpdate = (updated: FormRecord) => {
    setForms((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  };

  if (activeForm) {
    return <FormBuilderPage form={activeForm} onBack={() => setActiveForm(null)} onFormUpdate={handleFormUpdate} />;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Forms</h1>
          <p className="text-xs text-slate-400 mt-0.5">Create and manage web forms to capture leads</p>
        </div>
        <button onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-md shadow-blue-500/20 transition-colors cursor-pointer">
          <Plus size={14} /> New Form
        </button>
      </div>

      {/* New form name modal */}
      <AnimatePresence>
        {isCreating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setIsCreating(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-2xl p-6 w-full max-w-sm shadow-2xl"
              onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4">New Form</h3>
              <input type="text" value={newFormName} onChange={(e) => setNewFormName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
                placeholder="e.g. Contact Us Form" autoFocus
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500 transition-colors mb-4" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setIsCreating(false)} className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer">Cancel</button>
                <button onClick={() => { void handleCreate(); }}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-md shadow-blue-500/20 transition-colors cursor-pointer">Create</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Forms grid */}
      {forms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
          <Layout size={40} className="text-slate-300 dark:text-slate-700 mb-3" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">No forms yet</h3>
          <p className="text-xs text-slate-400 mb-4">Create your first form to start capturing leads</p>
          <button onClick={() => setIsCreating(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer">
            <Plus size={14} /> Create Form
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forms.map((form) => (
            <div key={form.id} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.06] rounded-2xl overflow-hidden hover:border-blue-400/50 transition-all group">
              {/* Preview thumbnail */}
              <div className="h-32 bg-slate-50 dark:bg-slate-800/40 border-b border-gray-100 dark:border-white/[0.05] flex items-center justify-center cursor-pointer" onClick={() => setActiveForm(form)}>
                <div className="w-28 bg-white border border-slate-200 rounded-lg p-2 shadow-sm scale-90 group-hover:scale-95 transition-transform">
                  <div className="h-2.5 w-3/4 bg-slate-800 rounded mb-2" />
                  <div className="h-1.5 w-full bg-slate-200 rounded mb-1" />
                  <div className="h-4 w-full bg-slate-100 border border-slate-200 rounded mb-1" />
                  <div className="h-4 w-full bg-slate-100 border border-slate-200 rounded mb-2" />
                  <div className="h-4 w-full bg-blue-500 rounded" />
                </div>
              </div>
              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors" onClick={() => setActiveForm(form)}>
                      {form.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      {form.status === 'published' ? (
                        <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold rounded border border-emerald-500/20 uppercase">Published</span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold rounded uppercase">Draft</span>
                      )}
                      <span className="text-[10px] text-slate-400">{form.fields.length} fields</span>
                    </div>
                  </div>
                  <div className="relative shrink-0">
                    <button onClick={() => setOpenMenuId(openMenuId === form.id ? null : form.id)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer">
                      <MoreHorizontal size={14} />
                    </button>
                    <AnimatePresence>
                      {openMenuId === form.id && (
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                          className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-xl shadow-lg z-20 py-1 overflow-hidden"
                          onMouseLeave={() => setOpenMenuId(null)}>
                          <button onClick={() => { setActiveForm(form); setOpenMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] cursor-pointer">
                            <ExternalLink size={12} /> Open
                          </button>
                          <button onClick={() => { void handleDelete(form.id); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 cursor-pointer">
                            <Trash2 size={12} /> Delete
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
