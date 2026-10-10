'use client';

import React, { createContext, useContext, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

// ─── Context ─────────────────────────────────────────────────────────────────

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (value: string) => void;
  orientation: 'horizontal' | 'vertical';
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs compound components must be used within <Tabs>');
  }
  return context;
}

// ─── Root Component ──────────────────────────────────────────────────────────

interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  children: React.ReactNode;
}

export function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  orientation = 'horizontal',
  className,
  children,
}: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const activeTab = isControlled ? controlledValue : internalValue;

  const setActiveTab = (newValue: string) => {
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
  };

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab, orientation }}>
      <div className={cn('w-full', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

// ─── Tab List Component ──────────────────────────────────────────────────────

interface TabsListProps {
  className?: string;
  children: React.ReactNode;
  variant?: 'default' | 'pills' | 'underline';
}

export function TabsList({
  className,
  children,
  variant = 'default',
}: TabsListProps) {
  const { orientation } = useTabsContext();

  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      className={cn(
        'inline-flex items-center justify-start gap-1',
        orientation === 'horizontal'
          ? 'flex-row overflow-x-auto scrollbar-none'
          : 'flex-col',
        variant === 'default' &&
          'bg-gray-100 dark:bg-slate-900 p-1 rounded-xl border border-gray-200 dark:border-white/8',
        variant === 'pills' && 'gap-1.5',
        variant === 'underline' &&
          'border-b border-gray-200 dark:border-white/5 pb-0 gap-1.5',
        className
      )}
    >
      {children}
    </div>
  );
}

// ─── Tab Trigger Component ───────────────────────────────────────────────────

interface TabsTriggerProps {
  value: string;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
  badge?: string | number;
}

export function TabsTrigger({
  value,
  className,
  children,
  disabled,
  icon,
  badge,
}: TabsTriggerProps) {
  const { activeTab, setActiveTab } = useTabsContext();
  const shouldReduceMotion = useReducedMotion();
  const isActive = activeTab === value;

  return (
    <button
      role="tab"
      type="button"
      data-state={isActive ? 'active' : 'inactive'}
      aria-selected={isActive}
      aria-controls={`tabpanel-${value}`}
      id={`tab-${value}`}
      onClick={() => !disabled && setActiveTab(value)}
      disabled={disabled}
      className={cn(
        'relative px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
    >
      <span className="flex items-center gap-2">
        {icon && <span className="shrink-0">{icon}</span>}
        <span>{children}</span>
        {badge !== undefined && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={cn(
              'inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded-full',
              isActive
                ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {badge}
          </motion.span>
        )}
      </span>
    </button>
  );
}

// ─── Tab Content Component ───────────────────────────────────────────────────

interface TabsContentProps {
  value: string;
  className?: string;
  children: React.ReactNode;
  forceMount?: boolean;
}

export function TabsContent({
  value,
  className,
  children,
  forceMount,
}: TabsContentProps) {
  const { activeTab } = useTabsContext();
  const shouldReduceMotion = useReducedMotion();
  const isActive = activeTab === value;

  if (!isActive && !forceMount) {
    return null;
  }

  return (
    <motion.div
      role="tabpanel"
      id={`tabpanel-${value}`}
      aria-labelledby={`tab-${value}`}
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
      animate={{
        opacity: isActive ? 1 : 0,
        y: 0,
        display: isActive ? 'block' : 'none',
      }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
      className={cn(
        'mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg',
        !isActive && 'pointer-events-none',
        className
      )}
      tabIndex={0}
    >
      {children}
    </motion.div>
  );
}

// ─── Underline Variant Tab Trigger ──────────────────────────────────────────

interface UnderlineTabTriggerProps extends TabsTriggerProps {
  // Uses same props as TabsTrigger
}

export function UnderlineTabTrigger({
  value,
  className,
  children,
  disabled,
  icon,
  badge,
}: UnderlineTabTriggerProps) {
  const { activeTab, setActiveTab } = useTabsContext();
  const shouldReduceMotion = useReducedMotion();
  const isActive = activeTab === value;

  return (
    <button
      role="tab"
      type="button"
      aria-selected={isActive}
      aria-controls={`tabpanel-${value}`}
      id={`tab-${value}`}
      onClick={() => !disabled && setActiveTab(value)}
      disabled={disabled}
      className={cn(
        'relative px-4 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        isActive
          ? 'border-primary text-primary dark:text-primary'
          : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-white/10',
        className
      )}
    >
      <span className="flex items-center gap-2">
        {icon && <span className="shrink-0">{icon}</span>}
        <span>{children}</span>
        {badge !== undefined && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={cn(
              'inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded-full',
              isActive
                ? 'bg-primary/10 text-primary dark:text-primary'
                : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400'
            )}
          >
            {badge}
          </motion.span>
        )}
      </span>
    </button>
  );
}

// ─── Pills Variant Tab Trigger ──────────────────────────────────────────────

interface PillTabTriggerProps extends TabsTriggerProps {
  // Uses same props as TabsTrigger
}

export function PillTabTrigger({
  value,
  className,
  children,
  disabled,
  icon,
  badge,
}: PillTabTriggerProps) {
  const { activeTab, setActiveTab } = useTabsContext();
  const shouldReduceMotion = useReducedMotion();
  const isActive = activeTab === value;

  return (
    <motion.button
      role="tab"
      type="button"
      aria-selected={isActive}
      aria-controls={`tabpanel-${value}`}
      id={`tab-${value}`}
      onClick={() => !disabled && setActiveTab(value)}
      disabled={disabled}
      whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
      whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
      className={cn(
        'relative px-4 py-2 text-sm font-medium rounded-full transition-all whitespace-nowrap',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        isActive
          ? 'bg-primary text-white shadow-lg shadow-primary/30'
          : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-white/8 hover:border-blue-300 dark:hover:border-primary/30 shadow-sm',
        className
      )}
    >
      <span className="flex items-center gap-2">
        {icon && <span className="shrink-0">{icon}</span>}
        <span>{children}</span>
        {badge !== undefined && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={cn(
              'inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded-full',
              isActive
                ? 'bg-white/20 text-white'
                : 'bg-primary/10 text-primary dark:text-primary'
            )}
          >
            {badge}
          </motion.span>
        )}
      </span>
    </motion.button>
  );
}

// ─── Export All ──────────────────────────────────────────────────────────────

export { useTabsContext };
