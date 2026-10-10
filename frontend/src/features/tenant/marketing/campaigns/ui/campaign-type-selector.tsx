'use client';

import React from 'react';
import { Mail, MessageSquare, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CampaignTypeSelectorProps {
  value: string;
  onChange: (type: string) => void;
}

interface CampaignTypeOption {
  value: string;
  label: string;
  icon: React.ReactNode;
  ariaLabel: string;
}

const CAMPAIGN_TYPE_OPTIONS: CampaignTypeOption[] = [
  {
    value: 'EMAIL',
    label: 'Email',
    icon: <Mail size={14} />,
    ariaLabel: 'Select Email campaign type',
  },
  {
    value: 'SMS',
    label: 'SMS',
    icon: <MessageSquare size={14} />,
    ariaLabel: 'Select SMS campaign type',
  },
  {
    value: 'MULTI_CHANNEL',
    label: 'Multi-Channel',
    icon: <Zap size={14} />,
    ariaLabel: 'Select Multi-Channel campaign type',
  },
];

export function CampaignTypeSelector({ value, onChange }: CampaignTypeSelectorProps): React.ReactElement {
  return (
    <div
      className="flex rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden bg-slate-50 dark:bg-white/[0.03]"
      role="group"
      aria-label="Campaign type"
    >
      {CAMPAIGN_TYPE_OPTIONS.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={isActive}
            aria-label={option.ariaLabel}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
              isActive
                ? 'bg-primary text-white shadow-sm shadow-primary/20'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
            )}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
