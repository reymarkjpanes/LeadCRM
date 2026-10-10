/**
 * RowActionsMenu — Three-dot (⋯) menu on each row with context actions.
 *
 * Actions (configurable per module):
 * - View
 * - Edit
 * - Send Email
 * - Create Task
 * - Convert
 * - Archive
 * - Copy URL
 * - More...
 *
 * Matches Close CRM / Zoho CRM row context menu pattern.
 */

'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ThemedPortal } from '@/shared/components/theme-scope';
import {
  MoreHorizontal,
  Eye,
  Edit,
  Mail,
  ListTodo,
  Archive,
  RefreshCw,
  Trash2,
  Link,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RowActionItem {
  /** Unique action ID */
  id: string;
  /** Display label */
  label: string;
  /** Icon component */
  icon?: React.ReactNode;
  /** Action callback — receives the row record */
  onClick: () => void;
  /** Whether this is a destructive action (red text) */
  destructive?: boolean;
  /** Whether this action is disabled */
  disabled?: boolean;
  /** Explanation displayed below an unavailable action. */
  disabledReason?: string;
  /** Whether to show a sub-menu indicator (chevron) */
  hasSubmenu?: boolean;
  /** Separator before this item */
  separator?: boolean;
}

export interface RowActionsMenuProps {
  /** Action items for this row */
  actions: RowActionItem[];
  /** Position: 'left' shows menu to the right, 'right' shows to the left */
  position?: 'left' | 'right';
  label?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RowActionsMenu({
  actions,
  position = 'left',
  label = 'Row actions',
}: RowActionsMenuProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [coordinates, setCoordinates] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const placeMenu = () => {
      if (!buttonRef.current || !dropdownRef.current) return;
      const trigger = buttonRef.current.getBoundingClientRect();
      const menu = dropdownRef.current.getBoundingClientRect();
      const margin = 8;
      const below = trigger.bottom + 4;
      const top = below + menu.height <= window.innerHeight - margin
        ? below : trigger.top - menu.height - 4;
      const left = position === 'left' ? trigger.left : trigger.right - menu.width;
      setCoordinates({
        top: Math.max(margin, Math.min(top, window.innerHeight - menu.height - margin)),
        left: Math.max(margin, Math.min(left, window.innerWidth - menu.width - margin)),
      });
    };
    placeMenu();
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(placeMenu);
    if (dropdownRef.current) observer?.observe(dropdownRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [isOpen, position]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent): void {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsOpen((prev) => !prev);
  }, []);

  return (
    <div className="relative inline-flex" ref={menuRef}>
      {/* Trigger — three dots */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={cn(
          'w-7 h-7 flex items-center justify-center rounded-md transition-colors',
          'text-slate-400 dark:text-slate-500',
          'hover:text-slate-700 dark:hover:text-slate-200',
          'hover:bg-slate-100 dark:hover:bg-slate-700',
          isOpen && 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700',
        )}
        aria-label={label}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <MoreHorizontal size={16} />
      </button>

      {/* Dropdown Menu — rendered via portal to escape overflow:hidden */}
      {isOpen && <ThemedPortal>{<div
          className={cn(
            'fixed z-[9999]',
            'w-[180px] py-1.5 px-1',
            'bg-popover border border-border',
            'rounded-lg shadow-xl',
          )}
          style={{
            ...coordinates,
            maxHeight: 'calc(100dvh - 16px)',
            maxWidth: 'calc(100vw - 16px)',
            overflowY: 'auto',
          }}
          role="menu"
          aria-label="Row actions menu"
          ref={dropdownRef}
        >
          {actions.map((action) => (
            <React.Fragment key={action.id}>
              {action.separator && (
                <div className="my-1 border-t border-gray-100 dark:border-white/[0.06]" />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!action.disabled) {
                    setIsOpen(false);
                    action.onClick();
                  }
                }}
                disabled={action.disabled}
                aria-describedby={action.disabledReason ? `action-${action.id}-reason` : undefined}
                className={cn(
                  'flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-left transition-colors rounded-md',
                  action.disabled && 'opacity-40 cursor-not-allowed',
                  !action.disabled && !action.destructive && 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60',
                  !action.disabled && action.destructive && 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10',
                )}
                role="menuitem"
              >
                {action.icon && (
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    {action.icon}
                  </span>
                )}
                <span className="flex-1">{action.label}</span>
                {action.hasSubmenu && <ChevronRight size={12} className="text-slate-400" />}
              </button>
              {action.disabledReason && <p id={`action-${action.id}-reason`} className="px-3 pb-2 text-xs text-slate-500 dark:text-slate-400">{action.disabledReason}</p>}
            </React.Fragment>
          ))}
        </div>}</ThemedPortal>}
    </div>
  );
}

// ─── Default Action Builders ─────────────────────────────────────────────────

/**
 * Build the standard set of row actions for CRM records.
 * Modules can customize by overriding specific actions.
 */
export function buildDefaultRowActions(options: {
  onView: () => void;
  onEdit?: () => void;
  onSendEmail?: () => void;
  onCreateTask?: () => void;
  onArchive?: () => void;
  canArchive?: boolean;
  onConvert?: () => void;
  onDelete?: () => void;
  onCopyUrl?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}): RowActionItem[] {
  const actions: RowActionItem[] = [
    { id: 'view', label: 'View', icon: <Eye size={14} />, onClick: options.onView },
  ];

  if (options.onEdit && options.canEdit !== false) {
    actions.push({ id: 'edit', label: 'Edit', icon: <Edit size={14} />, onClick: options.onEdit });
  }

  if (options.onSendEmail) {
    actions.push({ id: 'send-email', label: 'Send Email', icon: <Mail size={14} />, onClick: options.onSendEmail });
  }

  if (options.onCreateTask) {
    actions.push({ id: 'create-task', label: 'Create Task', icon: <ListTodo size={14} />, onClick: options.onCreateTask });
  }

  if (options.onConvert) {
    actions.push({ id: 'convert', label: 'Convert', icon: <RefreshCw size={14} />, onClick: options.onConvert });
  }

  if (options.onArchive && options.canArchive !== false) {
    actions.push({ id: 'archive', label: 'Archive', icon: <Archive size={14} />,
      onClick: options.onArchive, separator: true });
  } else if (options.onDelete && options.canDelete !== false) {
    actions.push({
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size={14} />,
      onClick: options.onDelete,
      destructive: true,
      separator: true,
    });
  }

  if (options.onCopyUrl) {
    actions.push({ id: 'copy-url', label: 'Copy URL', icon: <Link size={14} />, onClick: options.onCopyUrl });
  }

  return actions;
}
