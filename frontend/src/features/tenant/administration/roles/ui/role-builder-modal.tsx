'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PERMISSION_MODULES, ROLE_TEMPLATES, EMPTY_PERMISSION_FLAGS } from '@leadcrm/shared';
import type { PermissionFlags, PermissionAction, RoleListItem } from '@/store/types/roles.types';
import { PermissionMatrix } from './permission-matrix';
import { rolesService } from '../services/roles.service';
import { Dialog, DialogContent } from '@/shared/components/ui/dialog';

interface RoleBuilderModalProps {
  isOpen:    boolean;
  onClose:   () => void;
  onSaved:   () => void;
  editRole?: RoleListItem | null;
}

type PermissionsState = Record<string, PermissionFlags>;

function buildDefaultPermissions(): PermissionsState {
  return Object.fromEntries(
    PERMISSION_MODULES.map(m => [m.key, { ...EMPTY_PERMISSION_FLAGS }]),
  );
}

function buildFromRole(role: RoleListItem): PermissionsState {
  const state = buildDefaultPermissions();
  for (const perm of role.permissions) {
    state[perm.module] = { ...EMPTY_PERMISSION_FLAGS, ...perm };
  }
  return state;
}

export function RoleBuilderModal({ isOpen, onClose, onSaved, editRole }: RoleBuilderModalProps): React.ReactElement | null {
  const [name, setName]             = useState('');
  const [description, setDesc]      = useState('');
  const [permissions, setPerms]     = useState<PermissionsState>(buildDefaultPermissions);
  const [isSaving, setIsSaving]     = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  // Reset / pre-populate when modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (editRole) {
      setName(editRole.name);
      setDesc(editRole.description ?? '');
      setPerms(buildFromRole(editRole));
    } else {
      setName('');
      setDesc('');
      setPerms(buildDefaultPermissions());
    }
    setFormError(null);
    setShowTemplates(false);
  }, [isOpen, editRole]);

  const handlePermissionChange = useCallback((module: string, action: PermissionAction, checked: boolean) => {
    setPerms(prev => {
      const current = prev[module] ?? { ...EMPTY_PERMISSION_FLAGS };
      const next = { ...current, [action]: checked };

      // canCreate/canEdit/canDelete require canView
      if (action !== 'canView' && checked) next.canView = true;
      // Deactivating canView clears all
      if (action === 'canView' && !checked) {
        Object.assign(next, EMPTY_PERMISSION_FLAGS);
      }
      return { ...prev, [module]: next };
    });
  }, []);

  const applyTemplate = useCallback((templateKey: string) => {
    const tpl = ROLE_TEMPLATES.find(t => t.key === templateKey);
    if (!tpl) return;
    const state = buildDefaultPermissions();
    for (const [module, flags] of Object.entries(tpl.permissions)) {
      if (state[module]) state[module] = { ...flags };
    }
    setPerms(state);
    setShowTemplates(false);
    toast.success(`Template "${tpl.name}" applied`);
  }, []);

  const handleSave = async () => {
    setFormError(null);
    if (!name.trim() || name.trim().length < 2) {
      setFormError('Role name must be at least 2 characters.');
      return;
    }

    const permissionsPayload = PERMISSION_MODULES.map(mod => ({
      module:    mod.key,
      ...EMPTY_PERMISSION_FLAGS, ...permissions[mod.key],
    }));

    setIsSaving(true);
    try {
      if (editRole) {
        await rolesService.update(editRole.id, { name: name.trim(), description: description.trim() || undefined, permissions: permissionsPayload });
        toast.success('Role updated');
      } else {
        await rolesService.create({ name: name.trim(), description: description.trim() || undefined, permissions: permissionsPayload });
        toast.success('Role created');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save role');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open && !isSaving) onClose(); }}>
      <DialogContent showClose={false} aria-label={editRole ? 'Edit Role' : 'Create Role'} className="max-w-2xl flex flex-col overflow-hidden p-0 sm:p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">
            {editRole ? 'Edit Role' : 'Create Role'}
          </h2>
          <button type="button" disabled={isSaving} aria-label="Close role editor" onClick={onClose} className="p-1.5 min-h-11 min-w-11 grid place-items-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-[12px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">Role name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={50}
              placeholder="e.g. Senior Sales"
              className="w-full h-9 px-3 text-[13px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDesc(e.target.value)}
              maxLength={200}
              placeholder="Optional short description"
              className="w-full h-9 px-3 text-[13px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-primary"
            />
          </div>

          {/* Template picker — only for create */}
          {!editRole && (
            <div>
              <label className="block text-[12px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">Start from a template</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTemplates(v => !v)}
                  className="w-full h-9 px-3 text-[13px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-between hover:border-slate-400 dark:hover:border-slate-500 transition-colors"
                >
                  <span>Choose a template (optional)</span>
                  <ChevronDown size={14} className={cn('transition-transform', showTemplates && 'rotate-180')} />
                </button>
                {showTemplates && (
                  <div className="absolute z-20 top-10 left-0 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg overflow-hidden">
                    {ROLE_TEMPLATES.map(tpl => (
                      <button
                        key={tpl.key}
                        type="button"
                        onClick={() => applyTemplate(tpl.key)}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        <p className="text-[13px] font-medium text-slate-900 dark:text-white">{tpl.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{tpl.description}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Permission Matrix */}
          <div>
            <label className="block text-[12px] font-medium text-slate-700 dark:text-slate-300 mb-2">Permissions</label>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="px-4 py-3">
                <PermissionMatrix value={permissions} readOnly={false} onChange={handlePermissionChange} />
              </div>
            </div>
          </div>

          {/* Form error */}
          {formError && (
            <p className="text-[12px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800">
              {formError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <button type="button" disabled={isSaving} onClick={onClose} className="min-h-11 px-4 text-[13px] font-medium rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="h-9 px-5 text-[13px] font-medium rounded-lg bg-primary dark:bg-primary text-white hover:bg-primary/90 dark:hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? 'Saving…' : editRole ? 'Update Role' : 'Create Role'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
