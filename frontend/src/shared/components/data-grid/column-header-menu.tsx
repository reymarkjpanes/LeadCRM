/**
 * ColumnHeaderMenu — Dropdown menu triggered by the ≡ icon on each column header.
 *
 * Actions:
 * - Asc: Sort column ascending
 * - Desc: Sort column descending
 * - Pin Column: Pin/unpin column to left
 * - Filter by: Open filter for this column
 * - Hide Column: Hide this column from view
 *
 * Keyboard accessibility:
 * - Enter/Space opens the menu
 * - ArrowDown/ArrowUp navigates between menu items
 * - Enter activates the focused menu item
 * - Escape closes the menu and returns focus to the trigger
 * - Tab closes the menu (focus moves outside)
 *
 * Matches the Close CRM / Zoho CRM column menu pattern.
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Pin,
  Filter,
  EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ColumnHeaderMenuProps {
  /** Column ID */
  columnId: string;
  /** Column label (for display) */
  columnLabel: string;
  /** Whether column is required (cannot be hidden) */
  isRequired?: boolean;
  /** Whether column is currently pinned */
  isPinned?: boolean;
  /** Current sort direction for this column */
  sortDirection?: 'asc' | 'desc' | null;
  /** Sort ascending */
  onSortAsc: (columnId: string) => void;
  /** Sort descending */
  onSortDesc: (columnId: string) => void;
  /** Pin/unpin column */
  onPinColumn?: (columnId: string) => void;
  /** Filter by this column */
  onFilterBy?: (columnId: string) => void;
  /** Hide this column */
  onHideColumn?: (columnId: string) => void;
}

// ─── Menu Item ───────────────────────────────────────────────────────────────

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
  /** Whether this item is currently focused via keyboard navigation */
  isFocused?: boolean;
  /** Ref callback for roving tabindex management */
  itemRef?: (el: HTMLButtonElement | null) => void;
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  active,
  destructive,
  isFocused,
  itemRef,
}: MenuItemProps): React.ReactElement {
  return (
    <button
      ref={itemRef}
      type="button"
      role="menuitem"
      tabIndex={isFocused ? 0 : -1}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={cn(
        'flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-left transition-colors rounded-md',
        'outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        disabled && 'opacity-40 cursor-not-allowed',
        !disabled && !destructive && 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60',
        !disabled && destructive && 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10',
        active && 'bg-blue-50 dark:bg-primary/10 text-primary dark:text-primary',
        isFocused && !active && !disabled && 'bg-slate-100 dark:bg-slate-700/60',
      )}
    >
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ColumnHeaderMenu({
  columnId,
  columnLabel,
  isRequired = false,
  isPinned = false,
  sortDirection = null,
  onSortAsc,
  onSortDesc,
  onPinColumn,
  onFilterBy,
  onHideColumn,
}: ColumnHeaderMenuProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Build the list of menu items (for index-based navigation)
  const menuItems = React.useMemo(() => {
    const items: Array<{ id: string; disabled: boolean }> = [
      { id: 'sort-asc', disabled: false },
      { id: 'sort-desc', disabled: false },
    ];
    if (onPinColumn) items.push({ id: 'pin', disabled: false });
    if (onFilterBy) items.push({ id: 'filter', disabled: false });
    if (onHideColumn) items.push({ id: 'hide', disabled: isRequired });
    return items;
  }, [onPinColumn, onFilterBy, onHideColumn, isRequired]);

  // Close menu helper — returns focus to trigger
  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setFocusedIndex(-1);
    buttonRef.current?.focus();
  }, []);

  // Open menu helper — focuses first item
  const openMenu = useCallback(() => {
    setIsOpen(true);
    setFocusedIndex(0);
  }, []);

  // Focus the item at the given index
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.focus();
    }
  }, [isOpen, focusedIndex]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation within the menu
  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex((prev) => {
          const next = prev + 1;
          return next >= menuItems.length ? 0 : next;
        });
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex((prev) => {
          const next = prev - 1;
          return next < 0 ? menuItems.length - 1 : next;
        });
        break;
      }
      case 'Home': {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex(menuItems.length - 1);
        break;
      }
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        break;
      }
      case 'Tab': {
        // Tab closes the menu and moves focus outside
        closeMenu();
        break;
      }
    }
  }, [menuItems.length, closeMenu]);

  // Handle trigger button keyboard events
  const handleTriggerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    }
    if (e.key === 'ArrowDown' && !isOpen) {
      e.preventDefault();
      e.stopPropagation();
      openMenu();
    }
  }, [isOpen, closeMenu, openMenu]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isOpen) {
      setIsOpen(false);
      setFocusedIndex(-1);
    } else {
      openMenu();
    }
  }, [isOpen, openMenu]);

  // Item ref setter factory
  const setItemRef = useCallback((index: number) => (el: HTMLButtonElement | null) => {
    itemRefs.current[index] = el;
  }, []);

  // Track current item index for rendering
  let itemIndex = 0;

  return (
    <div className="relative inline-flex" ref={menuRef}>
      {/* Trigger — hamburger icon (≡) */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'w-5 h-5 flex items-center justify-center rounded transition-colors',
          'text-slate-400 dark:text-slate-500',
          'hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-600/40',
          'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
          isOpen && 'text-slate-600 dark:text-slate-300 bg-slate-200/60 dark:bg-slate-600/40',
        )}
        aria-label={`Column options for ${columnLabel}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 4h10M2 7h10M2 10h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={cn(
            'absolute top-full left-0 mt-1 z-50',
            'w-[180px] py-1.5 px-1',
            'bg-white dark:bg-slate-800 border border-gray-200 dark:border-white/[0.08]',
            'rounded-lg shadow-xl',
          )}
          role="menu"
          aria-label={`Options for ${columnLabel}`}
          onKeyDown={handleMenuKeyDown}
        >
          <MenuItem
            icon={<ArrowUp size={14} />}
            label="Asc"
            onClick={() => { onSortAsc(columnId); closeMenu(); }}
            active={sortDirection === 'asc'}
            isFocused={focusedIndex === itemIndex}
            itemRef={setItemRef(itemIndex++)}
          />
          <MenuItem
            icon={<ArrowDown size={14} />}
            label="Desc"
            onClick={() => { onSortDesc(columnId); closeMenu(); }}
            active={sortDirection === 'desc'}
            isFocused={focusedIndex === itemIndex}
            itemRef={setItemRef(itemIndex++)}
          />

          {/* Separator */}
          <div className="my-1 border-t border-gray-100 dark:border-white/[0.06]" role="separator" />

          {onPinColumn && (
            <MenuItem
              icon={<Pin size={14} />}
              label={isPinned ? 'Unpin Column' : 'Pin Column'}
              onClick={() => { onPinColumn(columnId); closeMenu(); }}
              isFocused={focusedIndex === itemIndex}
              itemRef={setItemRef(itemIndex++)}
            />
          )}

          {onFilterBy && (
            <MenuItem
              icon={<Filter size={14} />}
              label="Filter by"
              onClick={() => { onFilterBy(columnId); closeMenu(); }}
              isFocused={focusedIndex === itemIndex}
              itemRef={setItemRef(itemIndex++)}
            />
          )}

          {onHideColumn && (
            <MenuItem
              icon={<EyeOff size={14} />}
              label="Hide Column"
              onClick={() => { onHideColumn(columnId); closeMenu(); }}
              disabled={isRequired}
              isFocused={focusedIndex === itemIndex}
              itemRef={setItemRef(itemIndex++)}
            />
          )}
        </div>
      )}
    </div>
  );
}
