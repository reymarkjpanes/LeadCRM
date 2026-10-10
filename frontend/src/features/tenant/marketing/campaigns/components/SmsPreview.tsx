import React from 'react';
import { Smartphone, Info } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface SmsPreviewProps {
  sender?: string;
  message: string;
  className?: string;
}

export function SmsPreview({ sender = 'LeadCRM', message, className }: SmsPreviewProps) {
  // ASCII is 160 chars per SMS. Non-ASCII is 70 chars per SMS.
  const isUnicode = /[^\u0000-\u00ff]/.test(message);
  const maxPerPart = isUnicode ? 70 : 160;
  const multiMaxPerPart = isUnicode ? 67 : 153;

  const count = message.length;
  
  let parts = 0;
  let remaining = 0;
  
  if (count === 0) {
    parts = 0;
    remaining = maxPerPart;
  } else if (count <= maxPerPart) {
    parts = 1;
    remaining = maxPerPart - count;
  } else {
    parts = Math.ceil(count / multiMaxPerPart);
    remaining = (parts * multiMaxPerPart) - count;
  }

  return (
    <div className={cn('flex flex-col items-center w-full max-w-sm mx-auto', className)}>
      <div className="relative w-full max-w-[300px] aspect-[1/2] bg-gray-900 rounded-[3rem] border-[8px] border-gray-800 shadow-xl overflow-hidden flex flex-col">
        {/* Dynamic Island / Notch */}
        <div className="absolute top-0 inset-x-0 h-6 flex justify-center z-10">
          <div className="w-24 h-6 bg-gray-800 rounded-b-3xl"></div>
        </div>

        {/* Header */}
        <div className="pt-10 pb-4 px-4 bg-gray-100 dark:bg-gray-800 border-b dark:border-gray-700 flex flex-col items-center shadow-sm">
          <div className="w-12 h-12 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center mb-1">
            <Smartphone className="w-6 h-6 text-gray-500 dark:text-gray-300" />
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {sender}
          </span>
        </div>

        {/* Message Area */}
        <div className="flex-1 bg-white dark:bg-gray-900 p-4 flex flex-col justify-end overflow-y-auto">
          {message && (
            <div className="w-fit max-w-[85%] self-start bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-2 rounded-2xl rounded-bl-sm break-words shadow-sm">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                {message}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Stats Below Phone */}
      <div className="w-full max-w-[300px] mt-4 space-y-2">
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <Info className="w-4 h-4" />
            Characters
          </span>
          <span className="font-medium text-gray-900 dark:text-white">{count}</span>
        </div>
        
        <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
          <div 
            className={cn(
              "h-2 transition-all duration-300 rounded-full",
              parts > 3 ? "bg-red-500" : "bg-blue-500"
            )}
            style={{ width: `${Math.min(100, (count / (parts * multiMaxPerPart || maxPerPart)) * 100)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500">
          <span>{parts} {parts === 1 ? 'part' : 'parts'} (SMS)</span>
          <span>{remaining} remaining</span>
        </div>
      </div>
    </div>
  );
}
