'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronDown, Check, Filter, ArrowDownAZ, Loader2 } from 'lucide-react';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { motion, AnimatePresence } from 'motion/react';
import { getGmailStatus, fetchGmailEmails, GmailConnectionStatus, GmailEmail } from '../services/gmail.service';
import InboxCurrentEmpty from './inbox-current-empty';
import InboxDoneEmpty from './inbox-done-empty';
import InboxFutureEmpty from './inbox-future-empty';
import InboxEmailList from './inbox-email-list';
import EmailConversationView from './email-conversation-view';

type InboxTab = 'current' | 'done' | 'future';

interface InboxPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TAB_OPTIONS: { id: InboxTab; label: string }[] = [
  { id: 'current', label: 'Current' },
  { id: 'done', label: 'Done' },
  { id: 'future', label: 'Future' },
];

export default function InboxPanel({ isOpen, onClose }: InboxPanelProps): React.ReactElement | null {
  const [activeTab, setActiveTab] = useState<InboxTab>('current');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<GmailConnectionStatus | null>(null);
  const [emails, setEmails] = useState<GmailEmail[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<GmailEmail | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hasFetchedRef = useRef(false);

  // Fetch connection status when panel opens
  useEffect(() => {
    if (isOpen && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      setIsLoadingStatus(true);
      getGmailStatus()
        .then((status) => {
          setConnectionStatus(status);
          if (status.isConnected) {
            loadEmails();
          }
        })
        .catch(() => {
          setConnectionStatus({ isConnected: false, email: null, connectedAt: null, lastSyncAt: null });
        })
        .finally(() => setIsLoadingStatus(false));
    }

    if (!isOpen) {
      hasFetchedRef.current = false;
      setSelectedEmail(null);
    }
  }, [isOpen]);

  const loadEmails = useCallback(async (): Promise<void> => {
    setIsLoadingEmails(true);
    setEmailError(null);
    try {
      const result = await fetchGmailEmails({ maxResults: 20 });
      setEmails(result.emails);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to load emails');
    } finally {
      setIsLoadingEmails(false);
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isDropdownOpen) {
        setIsDropdownOpen(false);
      } else {
        onClose();
      }
    }
  }, [onClose, isDropdownOpen]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen]);

  const activeLabel = TAB_OPTIONS.find((t) => t.id === activeTab)?.label ?? 'Current';

  const isConnected = connectionStatus?.isConnected === true;

  const renderTabContent = (): React.ReactElement => {
    if (selectedEmail) return <EmailConversationView email={selectedEmail} onBack={() => setSelectedEmail(null)} onEmailsChanged={() => { setSelectedEmail(null); void loadEmails(); }} />;
    // Show loading state while checking connection
    if (isLoadingStatus) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      );
    }

    switch (activeTab) {
      case 'current':
        if (!isConnected) return <InboxCurrentEmpty />;
        if (isLoadingEmails) {
          return (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              <p className="text-sm text-slate-500 dark:text-slate-400">Loading emails...</p>
            </div>
          );
        }
        if (emailError) {
          return (
            <div className="flex flex-col items-center justify-center h-full px-6 py-16 text-center">
              <p className="text-sm text-red-500 dark:text-red-400 mb-3">{emailError}</p>
              <button
                onClick={loadEmails}
                className="text-sm text-primary dark:text-primary hover:underline cursor-pointer"
              >
                Try again
              </button>
            </div>
          );
        }
        return <InboxEmailList emails={emails} onEmailsChanged={loadEmails} totalCount={emails.length} onEmailClick={setSelectedEmail} />;
      case 'done':
        return <InboxDoneEmpty />;
      case 'future':
        return <InboxFutureEmpty />;
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      {isOpen && (
        <>
          <SheetContent showClose={false} aria-label="Inbox" className="max-w-2xl sm:max-w-2xl flex flex-col overflow-hidden bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-white/[0.05] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.05] shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Inbox
                </h2>

                {/* Dropdown selector */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsDropdownOpen((prev) => !prev)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                    aria-haspopup="listbox"
                    aria-expanded={isDropdownOpen}
                    aria-label={`Filter: ${activeLabel}`}
                  >
                    <span>{activeLabel}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>

                  <AnimatePresence>
                    {isDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.97, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: 4 }}
                        transition={{ duration: 0.12 }}
                        className="absolute top-full left-0 mt-1.5 w-44 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg py-1 z-10"
                        role="listbox"
                        aria-label="Inbox view options"
                      >
                        {TAB_OPTIONS.map((option) => {
                          const isActive = activeTab === option.id;
                          return (
                            <button
                              key={option.id}
                              onClick={() => {
                                setActiveTab(option.id);
                                setIsDropdownOpen(false);
                              }}
                              className={`
                                w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors cursor-pointer
                                ${isActive
                                  ? 'bg-primary/10 dark:bg-primary/15 text-primary dark:text-primary font-medium'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05]'}
                              `}
                              role="option"
                              aria-selected={isActive}
                            >
                              {isActive && <Check className="w-4 h-4 text-blue-500" />}
                              {!isActive && <span className="w-4" />}
                              <span>{option.label}</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Connected email indicator */}
                {isConnected && connectionStatus?.email && (
                  <span className="hidden sm:inline-flex text-xs text-slate-400 dark:text-slate-500 truncate max-w-[160px]">
                    {connectionStatus.email}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  aria-label="Filter inbox"
                >
                  <Filter className="w-4 h-4" />
                </button>
                <button
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  aria-label="Sort inbox"
                >
                  <ArrowDownAZ className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  aria-label="Close inbox"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {renderTabContent()}
            </div>
          </SheetContent>
        </>
      )}
    </Sheet>
  );
}
