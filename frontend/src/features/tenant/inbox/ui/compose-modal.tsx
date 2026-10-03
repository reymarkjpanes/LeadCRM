'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Minus, Maximize2, Send, Loader2, Paperclip, Link2, Smile, Image, MoreVertical, Trash2, Bold, Italic, Underline, List, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useReducedMotion } from 'motion/react';
import { sendGmailEmail, saveGmailDraft } from '../services/gmail.service';
import EmojiPicker from './emoji-picker';
import { safeMailboxHtml } from '../services/email-html';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSent: () => void;
  initialDraft?: { to: string; subject: string; body: string; draftId?: string } | null;
}

interface Attachment {
  name: string;
  size: number;
  type: string;
}

export default function ComposeModal({ isOpen, onClose, onSent, initialDraft }: ComposeModalProps): React.ReactElement | null {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toError, setToError] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showScheduleMenu, setShowScheduleMenu] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(undefined);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const toInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);

  // Focus the "To" field when opened
  useEffect(() => {
    if (isOpen && !isMinimized && toInputRef.current) {
      setTimeout(() => toInputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  // Every new compose starts with its explicit draft or an empty recipient.
  useEffect(() => {
    if (isOpen) {
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
    return editorRef.current?.innerHTML ?? '';
  };

  const handleSend = async (): Promise<void> => {
    if (!to.trim()) {
      setError('Please specify at least one recipient');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to.trim())) {
      setError('Please enter a valid email address (e.g., name@gmail.com)');
      return;
    }

    const htmlBody = getEditorContent();
    const textContent = editorRef.current?.textContent ?? '';

    if (!textContent.trim()) {
      setError('Cannot send an empty message');
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      await sendGmailEmail(to.trim(), subject.trim() || '(no subject)', htmlBody);
      resetForm();
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  const resetForm = (): void => {
    setTo('');
    setSubject('');
    setError(null);
    setToError(null);
    setAttachments([]);
    setIsMinimized(false);
    setIsFullscreen(false);
    setShowEmojiPicker(false);
    setShowLinkInput(false);
    setShowMoreMenu(false);
    setShowScheduleMenu(false);
    setCurrentDraftId(undefined);
    setDraftSaved(false);
    if (editorRef.current) editorRef.current.innerHTML = '';
  };

  const handleSaveDraft = async (): Promise<void> => {
    const htmlBody = editorRef.current?.innerHTML ?? '';
    if (!to.trim() && !subject.trim() && !htmlBody.trim()) {
      return; // Nothing to save
    }

    setIsSavingDraft(true);
    try {
      const result = await saveGmailDraft(to.trim(), subject.trim(), htmlBody, currentDraftId);
      setCurrentDraftId(result.draftId);
      setDraftSaved(true);
      // Reset saved indicator after 3 seconds
      setTimeout(() => setDraftSaved(false), 3000);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Draft was not saved.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleDiscard = (): void => {
    resetForm();
    onClose();
  };

  // Attach file
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments: Attachment[] = Array.from(files).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
    }));
    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const removeAttachment = (index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
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

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
              onClick={handleDiscard}
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
    ? 'fixed inset-4 z-50 rounded-xl'
    : 'fixed bottom-0 right-6 z-50 w-[580px] max-w-[calc(100vw-3rem)] h-[520px] rounded-t-xl';

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={springTransition}
      className={`${containerClasses} flex flex-col border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 shadow-2xl`}
      role="dialog"
      aria-label="Compose email"
    >
      {/* Title Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800 dark:bg-slate-800 rounded-t-xl shrink-0">
        <span className="text-[13px] font-medium text-white truncate">
          {subject || 'New Message'}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setIsMinimized(true)}
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
            onClick={handleDiscard}
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
            className={`flex-1 py-2.5 text-[13px] text-slate-900 dark:text-white bg-transparent focus:outline-none ${toError ? 'text-red-500 dark:text-red-400' : ''}`}
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
          className="flex-1 py-2.5 text-[13px] text-slate-900 dark:text-white bg-transparent placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
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
          className="w-full flex-1 px-4 py-3 text-[13px] text-slate-900 dark:text-white bg-transparent focus:outline-none overflow-y-auto leading-relaxed min-h-[100px] [&_a]:text-blue-500 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5"
          suppressContentEditableWarning
        />

        {/* Attachments list */}
        {attachments.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 dark:border-white/[0.05] shrink-0">
            <div className="flex flex-wrap gap-2">
              {attachments.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-gray-200 dark:border-white/[0.08] text-xs"
                >
                  <Paperclip className="w-3 h-3 text-slate-400" />
                  <span className="text-slate-700 dark:text-slate-300 truncate max-w-[120px]">{file.name}</span>
                  <span className="text-slate-400 dark:text-slate-500">{formatSize(file.size)}</span>
                  <button
                    onClick={() => removeAttachment(index)}
                    className="p-0.5 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-1.5 shrink-0">
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-gray-100 dark:border-white/[0.05] shrink-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {/* Send button with schedule dropdown */}
          <div className="relative flex items-center" ref={scheduleRef}>
            <button
              onClick={handleSend}
              disabled={isSending}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-l-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-medium active:scale-95 transition-all cursor-pointer"
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
              disabled
              title="Schedule sending in Gmail"
              className="h-9 px-2 rounded-r-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 border-l border-blue-500 text-white cursor-pointer transition-colors"
              aria-label="Schedule send options"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            <AnimatePresence>
              {showScheduleMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg py-2 z-10"
                >
                  <p className="px-3 pb-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                    Schedule Send
                  </p>
                  <button
                    onClick={() => {
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      tomorrow.setHours(8, 0, 0, 0);
                      setScheduledDate(tomorrow.toISOString());
                      setShowScheduleMenu(false);
                      handleSend();
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                  >
                    Tomorrow morning (8:00 AM)
                  </button>
                  <button
                    onClick={() => {
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      tomorrow.setHours(13, 0, 0, 0);
                      setScheduledDate(tomorrow.toISOString());
                      setShowScheduleMenu(false);
                      handleSend();
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                  >
                    Tomorrow afternoon (1:00 PM)
                  </button>
                  <button
                    onClick={() => {
                      const nextMonday = new Date();
                      nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
                      nextMonday.setHours(8, 0, 0, 0);
                      setScheduledDate(nextMonday.toISOString());
                      setShowScheduleMenu(false);
                      handleSend();
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                  >
                    Monday morning (8:00 AM)
                  </button>
                  <div className="border-t border-gray-100 dark:border-white/[0.05] my-1.5" />
                  <div className="px-3 py-2">
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                      Pick date & time
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        id="schedule-date"
                        type="date"
                        value={scheduledDate ? scheduledDate.split('T')[0] : ''}
                        onChange={(e) => {
                          const time = scheduledDate ? scheduledDate.split('T')[1]?.slice(0, 5) : '09:00';
                          setScheduledDate(`${e.target.value}T${time}:00`);
                        }}
                        min={new Date().toISOString().split('T')[0]}
                        className="flex-1 h-9 px-3 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                      />
                      <input
                        id="schedule-time"
                        type="time"
                        value={scheduledDate ? scheduledDate.split('T')[1]?.slice(0, 5) : ''}
                        onChange={(e) => {
                          const date = scheduledDate ? scheduledDate.split('T')[0] : new Date().toISOString().split('T')[0];
                          setScheduledDate(`${date}T${e.target.value}:00`);
                        }}
                        className="w-24 h-9 px-3 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    {scheduledDate && (
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                        Scheduled for {new Date(scheduledDate).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                    <button
                      onClick={() => {
                        if (scheduledDate) {
                          setShowScheduleMenu(false);
                          handleSend();
                        }
                      }}
                      disabled={!scheduledDate}
                      className="w-full h-9 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold cursor-pointer transition-colors"
                    >
                      Schedule Send
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Formatting toolbar */}
          <div className="flex min-w-0 flex-wrap items-center gap-0.5 sm:ml-2">
            <button
              onClick={() => execFormat('bold')}
              className={`p-2 rounded-full transition-colors cursor-pointer ${activeFormats.has('bold') ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-label="Bold"
              title="Bold (Ctrl+B)"
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              onClick={() => execFormat('italic')}
              className={`p-2 rounded-full transition-colors cursor-pointer ${activeFormats.has('italic') ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-label="Italic"
              title="Italic (Ctrl+I)"
            >
              <Italic className="w-4 h-4" />
            </button>
            <button
              onClick={() => execFormat('underline')}
              className={`p-2 rounded-full transition-colors cursor-pointer ${activeFormats.has('underline') ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-label="Underline"
              title="Underline (Ctrl+U)"
            >
              <Underline className="w-4 h-4" />
            </button>
            <button
              onClick={() => execFormat('insertUnorderedList')}
              className={`p-2 rounded-full transition-colors cursor-pointer ${activeFormats.has('list') ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-label="Bullet list"
              title="Bullet list"
            >
              <List className="w-4 h-4" />
            </button>

            {/* Divider */}
            <div className="w-px h-5 bg-gray-200 dark:bg-white/[0.08] mx-1" />

            {/* Attach file */}
            <button
              disabled
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Attach file"
              title="Send attachments from Gmail"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              aria-hidden="true"
            />

            {/* Insert link */}
            <div className="static sm:relative" ref={linkRef}>
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
                    className="absolute bottom-24 left-3 right-3 sm:bottom-full sm:left-auto sm:right-0 sm:w-64 mb-2 p-2 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg z-10"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="url"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        placeholder="https://..."
                        className="min-w-0 flex-1 h-8 px-2.5 rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                        onKeyDown={(e) => { if (e.key === 'Enter') insertLink(); }}
                        autoFocus
                      />
                      <button
                        onClick={insertLink}
                        className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Emoji picker */}
            <div className="static sm:relative" ref={emojiRef}>
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
                    className="absolute bottom-24 left-3 right-3 overflow-x-auto sm:bottom-full sm:left-auto sm:right-0 mb-2 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg z-10"
                  >
                    <EmojiPicker onSelect={insertEmoji} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Insert image */}
            <button
              disabled
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Insert image"
              title="Send images from Gmail"
            >
              <Image className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1">
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
            disabled={isSavingDraft}
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
          <div className="static sm:relative" ref={moreRef}>
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
                  className="absolute bottom-16 left-3 right-3 sm:bottom-full sm:left-auto sm:right-0 sm:w-48 mb-2 py-1 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-800 shadow-lg z-10"
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
                  <button
                    onClick={() => { setAttachments([]); setShowMoreMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
                  >
                    Remove all attachments
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Discard */}
          <button
            onClick={handleDiscard}
            className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Discard draft"
            title="Discard"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
