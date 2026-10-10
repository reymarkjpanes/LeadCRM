'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Minus, Maximize2, Send, Loader2, Link2, Smile, MoreVertical, Trash2, Bold, Italic, Underline, List, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useReducedMotion } from 'motion/react';
import { ManilaDateTimePicker } from '@/shared/components/ui/manila-date-time-picker';
import { manilaLocalDateTime, manilaTaskDueInstant } from '@/lib/manila-time';
import { SendMailboxEmailSchema } from '@leadcrm/shared';
import { sendGmailEmail, saveGmailDraft, scheduleGmailEmail, deleteGmailDraft } from '../services/gmail.service';
import EmojiPicker from './emoji-picker';
import { safeMailboxHtml } from '../services/email-html';
import type { MailboxComposeDraft } from '../services/email-presentation';
import type { ApiRequestError } from '@/lib/api/client';
import { useFocusMode } from '@/shared/lib/overlay-state';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useModalInteraction } from '@/shared/hooks/use-modal-interaction';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSent: () => void;
  initialDraft?: MailboxComposeDraft | null;
  retryAt?: number;
}

export default function ComposeModal({ isOpen, onClose, onSent, initialDraft, retryAt = 0 }: ComposeModalProps): React.ReactElement | null {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionRetryAt, setActionRetryAt] = useState(0);
  const [, refreshCooldown] = useState(0);
  const pauseUntil = Math.max(retryAt, actionRetryAt), paused = pauseUntil > Date.now();
  const [toError, setToError] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showScheduleMenu, setShowScheduleMenu] = useState(false);
  const scheduleRequest = useRef<{ key: string; id: string } | null>(null);
  const sendRequest = useRef<{ key: string; id: string } | null>(null);
  const mutationPending = useRef(false);
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(undefined);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const toInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const minimizedBody = useRef('');
  const emojiRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const owner = React.useId();
  const compact = useMediaQuery('(max-width: 767px)');
  const modal = isOpen && !isMinimized && (compact || isFullscreen);
  useFocusMode(isOpen && !isMinimized && isFullscreen);
  useModalInteraction({ open: modal, panelRef, owner, onClose: () => { if (!mutationPending.current) { resetForm(); onClose(); } } });

  useEffect(() => {
    if (!pauseUntil) return;
    const timer = setTimeout(() => { setActionRetryAt(0); refreshCooldown(value => value + 1); }, Math.max(0, pauseUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [pauseUntil]);

  // Focus the "To" field when opened
  useEffect(() => {
    if (isOpen && !isMinimized && toInputRef.current) {
      setTimeout(() => toInputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  // Every new compose starts with its explicit draft or an empty recipient.
  useEffect(() => {
    if (isOpen) {
      setError(null); setShowScheduleMenu(false); scheduleRequest.current = null; sendRequest.current = null;
      setTo(initialDraft?.to ?? '');
      setSubject(initialDraft?.subject ?? '');
      setCurrentDraftId(initialDraft?.draftId);
      // Set body content in the editor after a short delay to ensure ref is mounted
      const timer = setTimeout(() => {
        if (editorRef.current) editorRef.current.innerHTML = safeMailboxHtml(initialDraft?.body ?? '');
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialDraft]);

  useEffect(() => {
    if (!isMinimized && editorRef.current && minimizedBody.current) {
      editorRef.current.innerHTML = minimizedBody.current;
      minimizedBody.current = '';
    }
  }, [isMinimized]);

  // Close popups on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (linkRef.current && !linkRef.current.contains(e.target as Node)) {
        setShowLinkInput(false);
      }
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
      if (scheduleRef.current && !scheduleRef.current.contains(e.target as Node)) {
        setShowScheduleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Track which formats are active at the cursor
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  const updateActiveFormats = useCallback((): void => {
    const formats = new Set<string>();
    if (document.queryCommandState('bold')) formats.add('bold');
    if (document.queryCommandState('italic')) formats.add('italic');
    if (document.queryCommandState('underline')) formats.add('underline');
    if (document.queryCommandState('insertUnorderedList')) formats.add('list');
    setActiveFormats(formats);
  }, []);

  // Rich text formatting using execCommand
  const execFormat = useCallback((command: string, value?: string): void => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    updateActiveFormats();
  }, [updateActiveFormats]);

  if (!isOpen) return null;

  const getEditorContent = (): string => {
    return safeMailboxHtml(editorRef.current?.innerHTML ?? '');
  };
  const actionFailed = (error: unknown, fallback: string) => {
    setError(error instanceof Error ? error.message : fallback);
    const request = error as ApiRequestError;
    setActionRetryAt(Date.parse(request.retryAt ?? '') || (request.status === 429 ? Date.now() + 60000 : 0));
  };

  const handleSend = async (scheduledAt?: string): Promise<void> => {
    if (mutationPending.current || paused) return;
    if (!to.trim()) {
      setError('Please specify at least one recipient');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = to.split(',').map(value => value.trim());
    if (recipients.some(value => !emailRegex.test(value))) {
      setError('Please enter a valid email address (e.g., name@gmail.com)');
      return;
    }

    const htmlBody = getEditorContent();
    const textContent = editorRef.current?.textContent ?? '';

    if (!textContent.trim()) {
      setError('Cannot send an empty message');
      return;
    }

    const parsed = SendMailboxEmailSchema.safeParse({ to: recipients, subject: subject.trim() || '(no subject)', body: htmlBody, replyToMessageId: initialDraft?.replyToMessageId });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    mutationPending.current = true; setIsSending(true);
    setError(null);

    try {
      if (scheduledAt) {
        const payload = { to: recipients, subject: subject.trim() || '(no subject)', body: htmlBody, scheduledAt, draftId: currentDraftId, replyToMessageId: initialDraft?.replyToMessageId, forwardSourceMessageId: initialDraft?.forwardSourceMessageId };
        const key = JSON.stringify(payload);
        if (scheduleRequest.current?.key !== key) scheduleRequest.current = { key, id: crypto.randomUUID() };
        await scheduleGmailEmail({ ...payload, requestId: scheduleRequest.current.id });
      } else {
        const key = JSON.stringify([recipients, subject, htmlBody, initialDraft?.replyToMessageId, currentDraftId, initialDraft?.forwardSourceMessageId]);
        if (sendRequest.current?.key !== key) sendRequest.current = { key, id: crypto.randomUUID() };
        await sendGmailEmail(recipients, subject.trim() || '(no subject)', htmlBody, initialDraft?.replyToMessageId, currentDraftId, initialDraft?.forwardSourceMessageId, sendRequest.current.id);
      }
      resetForm();
      onSent();
      onClose();
    } catch (err) {
      actionFailed(err, 'Failed to send email');
    } finally {
      mutationPending.current = false; setIsSending(false);
    }
  };

  const resetForm = (): void => {
    setTo('');
    setSubject('');
    setError(null);
    setToError(null);
    setIsMinimized(false);
    setIsFullscreen(false);
    setShowEmojiPicker(false);
    setShowLinkInput(false);
    setShowMoreMenu(false);
    setShowScheduleMenu(false);
    setCurrentDraftId(undefined);
    setDraftSaved(false);
    minimizedBody.current = '';
    if (editorRef.current) editorRef.current.innerHTML = '';
  };

  const handleSaveDraft = async (): Promise<void> => {
    if (mutationPending.current || paused) return;
    const htmlBody = getEditorContent();
    if (!to.trim() && !subject.trim() && !htmlBody.trim()) {
      return; // Nothing to save
    }

    mutationPending.current = true; setIsSavingDraft(true);
    try {
      const result = await saveGmailDraft(to.trim(), subject.trim(), htmlBody, currentDraftId, initialDraft?.replyToMessageId, initialDraft?.forwardSourceMessageId);
      setCurrentDraftId(result.draftId);
      setDraftSaved(true);
      // Reset saved indicator after 3 seconds
      setTimeout(() => setDraftSaved(false), 3000);
    } catch (error) {
      actionFailed(error, 'Draft was not saved.');
    } finally {
      mutationPending.current = false; setIsSavingDraft(false);
    }
  };

  const handleDiscard = async (): Promise<void> => {
    if (mutationPending.current || currentDraftId && paused) return;
    mutationPending.current = true;
    try { if (currentDraftId) await deleteGmailDraft(currentDraftId); resetForm(); onSent(); onClose(); }
    catch (error) { actionFailed(error, 'Draft could not be deleted.'); }
    finally { mutationPending.current = false; }
  };

  // Insert emoji at cursor position in the editor
  const insertEmoji = (emoji: string): void => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, emoji);
    setShowEmojiPicker(false);
  };

  // Insert link
  const insertLink = (): void => {
    if (linkUrl.trim()) {
      if (!/^https?:\/\//i.test(linkUrl.trim())) { setError('Use an http or https link.'); return; }
      editorRef.current?.focus();
      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().length > 0;

      if (hasSelection) {
        document.execCommand('createLink', false, linkUrl.trim());
      } else {
        const link = document.createElement('a'); link.href = linkUrl.trim(); link.textContent = linkUrl.trim();
        document.execCommand('insertHTML', false, link.outerHTML);
      }

      setLinkUrl('');
      setShowLinkInput(false);
    }
  };

  const springTransition = shouldReduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, damping: 30, stiffness: 280 };

  // Minimized state
  if (isMinimized) {
    return (
      <div className="fixed bottom-0 right-6 z-50">
        <div className="flex items-center justify-between px-4 py-2.5 rounded-t-lg bg-slate-800 dark:bg-slate-800 text-white shadow-xl w-[min(320px,calc(100vw-3rem))]">
          <button
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-2 flex-1 cursor-pointer"
          >
            <span className="text-sm font-medium">New Message</span>
            {to && <span className="text-slate-400 truncate max-w-[120px] text-xs">— {to}</span>}
          </button>
          <div className="flex items-center gap-0.5 ml-3">
            <button
              onClick={() => { setIsMinimized(false); setIsFullscreen(true); }}
              className="p-1.5 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
              aria-label="Maximize"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { if (!mutationPending.current) { resetForm(); onClose(); } }}
              className="p-1.5 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const containerClasses = isFullscreen
    ? 'fixed inset-2 sm:inset-4 z-50 rounded-xl'
    : 'fixed bottom-0 right-2 sm:right-6 z-50 w-[580px] max-w-[calc(100vw-1rem)] h-[min(600px,calc(100dvh-1rem))] rounded-t-xl';

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={springTransition}
      className={`${containerClasses} flex flex-col border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 shadow-2xl`}
      role="dialog"
      aria-modal={modal ? true : undefined}
      aria-label="Compose email"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (showEmojiPicker || showLinkInput || showMoreMenu || showScheduleMenu) { setShowEmojiPicker(false); setShowLinkInput(false); setShowMoreMenu(false); setShowScheduleMenu(false); } else if (!mutationPending.current) { resetForm(); onClose(); } } }}
    >
      {/* Title Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800 dark:bg-slate-800 rounded-t-xl shrink-0">
        <span className="text-[13px] font-medium text-white truncate">
          {subject || 'New Message'}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => { minimizedBody.current = getEditorContent(); setIsMinimized(true); }}
            className="p-1.5 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
            aria-label="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="p-1.5 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { if (!mutationPending.current) { resetForm(); onClose(); } }}
            className="p-1.5 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Recipients */}
      <div className="flex flex-col border-b border-gray-100 dark:border-white/[0.05] px-4 shrink-0">
        <div className="flex items-center">
          <label htmlFor="compose-to" className="text-[13px] text-slate-500 dark:text-slate-400 w-8 shrink-0">
            To
          </label>
          <input
            ref={toInputRef}
            id="compose-to"
            type="email"
            multiple
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setError(null);
              // Clear error if user is typing a valid email
              if (toError && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value.trim())) {
                setToError(null);
              }
            }}
            onBlur={() => {
              if (to.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
                setToError('Please enter a valid email address (e.g., name@gmail.com)');
              } else {
                setToError(null);
              }
            }}
            className={`min-w-0 flex-1 py-2.5 text-[13px] text-slate-900 dark:text-white bg-transparent focus:outline-none ${toError ? 'text-red-500 dark:text-red-400' : ''}`}
          />
        </div>
        {toError && (
          <p className="text-[11px] text-red-500 dark:text-red-400 pb-1.5 pl-8">
            {toError}
          </p>
        )}
      </div>

      {/* Subject */}
      <div className="flex items-center border-b border-gray-100 dark:border-white/[0.05] px-4 shrink-0">
        <input
          id="compose-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="min-w-0 flex-1 py-2.5 text-[13px] text-slate-900 dark:text-white bg-transparent placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
        />
      </div>

      {/* Rich Text Body Editor */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div
          ref={editorRef}
          contentEditable
          role="textbox"
          aria-label="Email body"
          aria-multiline="true"
          onKeyUp={updateActiveFormats}
          onMouseUp={updateActiveFormats}
          onPaste={event => { event.preventDefault(); const html = event.clipboardData.getData('text/html'); document.execCommand(html ? 'insertHTML' : 'insertText', false, html ? safeMailboxHtml(html) : event.clipboardData.getData('text/plain')); }}
          className="w-full flex-1 px-4 py-3 text-[13px] text-slate-900 dark:text-white bg-transparent focus:outline-none overflow-y-auto leading-relaxed min-h-[100px] [&_a]:text-blue-500 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5"
          suppressContentEditableWarning
        />

      </div>

      {/* Error */}
      {paused && <p role="status" className="px-4 py-1.5 text-xs text-muted-foreground">Gmail updates are temporarily paused. Your message remains open.</p>}
      {error && (
        <div className="px-4 py-1.5 shrink-0">
          <p role="alert" className="text-xs text-red-500 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex min-w-0 flex-col gap-2 px-3 py-2.5 border-t border-gray-100 dark:border-white/[0.05] shrink-0">
        <div className="flex min-w-0 flex-col items-start gap-2">
          {/* Send button with schedule dropdown */}
          <div className="flex items-center" ref={scheduleRef}>
            <button
              onClick={() => void handleSend()}
              disabled={isSending || isSavingDraft || paused}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-l-full bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-medium active:scale-95 transition-all cursor-pointer"
              aria-label="Send email"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>{isSending ? 'Sending...' : 'Send'}</span>
            </button>
            <button
              disabled={isSending || isSavingDraft || paused}
              onClick={() => setShowScheduleMenu(value => !value)}
              aria-expanded={showScheduleMenu}
              title="Schedule send"
              className="h-9 px-2 rounded-r-full bg-primary hover:bg-primary/90 disabled:opacity-60 border-l border-primary text-white cursor-pointer transition-colors"
              aria-label="Schedule send options"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {showScheduleMenu && <div className="absolute bottom-[112px] left-2 right-2 z-30 max-h-[calc(100dvh-180px)] overflow-y-auto rounded-xl bg-card shadow-xl sm:left-3 sm:right-auto sm:w-96">
              <p className="px-3 py-2 text-sm font-semibold">Schedule send</p>
              <ManilaDateTimePicker value={manilaLocalDateTime(new Date(Date.now() + 3600000))} busy={isSending || isSavingDraft || paused} onCancel={() => setShowScheduleMenu(false)} onDone={value => void handleSend(manilaTaskDueInstant(value))} />
            </div>}
          </div>

          {/* Formatting toolbar */}
          <div role="toolbar" aria-label="Message formatting" className="flex w-full min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto [&>*]:shrink-0">
            <button
              onClick={() => execFormat('bold')}
              className={`p-2 rounded-full transition-colors cursor-pointer ${activeFormats.has('bold') ? 'text-primary dark:text-primary bg-blue-50 dark:bg-blue-950/40' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-label="Bold"
              title="Bold (Ctrl+B)"
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              onClick={() => execFormat('italic')}
              className={`p-2 rounded-full transition-colors cursor-pointer ${activeFormats.has('italic') ? 'text-primary dark:text-primary bg-blue-50 dark:bg-blue-950/40' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-label="Italic"
              title="Italic (Ctrl+I)"
            >
              <Italic className="w-4 h-4" />
            </button>
            <button
              onClick={() => execFormat('underline')}
              className={`p-2 rounded-full transition-colors cursor-pointer ${activeFormats.has('underline') ? 'text-primary dark:text-primary bg-blue-50 dark:bg-blue-950/40' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-label="Underline"
              title="Underline (Ctrl+U)"
            >
              <Underline className="w-4 h-4" />
            </button>
            <button
              onClick={() => execFormat('insertUnorderedList')}
              className={`p-2 rounded-full transition-colors cursor-pointer ${activeFormats.has('list') ? 'text-primary dark:text-primary bg-blue-50 dark:bg-blue-950/40' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-label="Bullet list"
              title="Bullet list"
            >
              <List className="w-4 h-4" />
            </button>

            {/* Divider */}
            <div className="w-px h-5 bg-gray-200 dark:bg-white/[0.08] mx-1" />

            {/* Insert link */}
            <div className="static" ref={linkRef}>
              <button
                onClick={() => { setShowLinkInput((prev) => !prev); setShowEmojiPicker(false); setShowMoreMenu(false); }}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Insert link"
                title="Insert link"
              >
                <Link2 className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {showLinkInput && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-24 left-3 right-3 sm:bottom-24 sm:left-auto sm:right-3 sm:w-64 mb-2 p-2 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg z-10"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="url"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        placeholder="https://..."
                        className="min-w-0 flex-1 h-8 px-2.5 rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-primary"
                        onKeyDown={(e) => { if (e.key === 'Enter') insertLink(); }}
                        autoFocus
                      />
                      <button
                        onClick={insertLink}
                        className="h-8 px-3 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Emoji picker */}
            <div className="static" ref={emojiRef}>
              <button
                onClick={() => { setShowEmojiPicker((prev) => !prev); setShowLinkInput(false); setShowMoreMenu(false); }}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Insert emoji"
                title="Insert emoji"
              >
                <Smile className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {showEmojiPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-24 left-3 right-3 sm:left-auto sm:right-3 sm:w-80 max-w-[calc(100vw-2.5rem)] mb-2 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg z-10"
                  >
                    <EmojiPicker onSelect={insertEmoji} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          {/* Draft status */}
          {draftSaved && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mr-1">
              Draft saved
            </span>
          )}
          {isSavingDraft && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 mr-1">
              Saving...
            </span>
          )}

          {/* Save Draft */}
          <button
            onClick={handleSaveDraft}
            disabled={isSavingDraft || isSending || paused}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            aria-label="Save as draft"
            title="Save as draft"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          </button>

          {/* More options */}
          <div className="static" ref={moreRef}>
            <button
              onClick={() => { setShowMoreMenu((prev) => !prev); setShowEmojiPicker(false); setShowLinkInput(false); }}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="More options"
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            <AnimatePresence>
              {showMoreMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute bottom-16 left-3 right-3 sm:bottom-24 sm:left-auto sm:right-3 sm:w-48 mb-2 py-1 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg z-10"
                >
                  <button
                    onClick={() => { if (editorRef.current) editorRef.current.innerHTML = ''; setShowMoreMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                  >
                    Clear body
                  </button>
                  <button
                    onClick={() => { setSubject(''); setShowMoreMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                  >
                    Clear subject
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Discard */}
          <button
            onClick={() => void handleDiscard()}
            disabled={isSavingDraft || isSending || !!currentDraftId && paused}
            className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Discard draft"
            title="Discard"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
