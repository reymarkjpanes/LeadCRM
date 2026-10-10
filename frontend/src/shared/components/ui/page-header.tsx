'use client';

import React, { ReactNode } from 'react';
import { BackButton, BackButtonProps } from './back-button';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backButtonProps?: BackButtonProps;
  actions?: ReactNode;
  className?: string;
  badge?: ReactNode;
  /** Keep actions beside the title at every width, with the subtitle below (default). */
  actionsInlineWithTitle?: boolean;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  backButtonProps,
  actions,
  className = '',
  badge,
  actionsInlineWithTitle = true,
}) => {
  return (
    <div className={cn('min-w-0 mb-4', actionsInlineWithTitle
      ? 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5'
      : 'flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:flex-wrap sm:items-start', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {backButtonProps && (
          <div className="pt-0.5">
            <BackButton {...backButtonProps} />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold leading-7 tracking-tight text-slate-900 dark:text-white [overflow-wrap:anywhere]">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && !actionsInlineWithTitle && (
            <p className="mt-0.5 text-sm font-normal leading-5 text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div data-page-actions className={cn('flex min-w-0 max-w-full items-center', actionsInlineWithTitle ? 'gap-2' : 'flex-wrap gap-2.5')}>
          {actions}
        </div>
      )}
      {subtitle && actionsInlineWithTitle && (
        <p className="col-span-2 text-sm font-normal leading-5 text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      )}
    </div>
  );
};

export default PageHeader;
