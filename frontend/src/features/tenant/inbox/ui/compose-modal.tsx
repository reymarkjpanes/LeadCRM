'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Minus, Maximize2, Send, Loader2, Link2, Smile, MoreVertical, Trash2, Bold, Italic, Underline, List, ChevronDown, Paperclip } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useReducedMotion } from 'motion/react';
import { ManilaDateTimePicker } from '@/shared/components/ui/manila-date-time-picker';
import { manilaLocalDateTime, manilaTaskDueInstant } from '@/lib/manila-time';
import { SendMailboxEmailSchema, mailboxAttachmentType, MAILBOX_FORWARD_RECIPIENT_ERROR, MAILBOX_ATTACHMENT_TYPES, MAILBOX_ATTACHMENT_MAX_BYTES, MAILBOX_ATTACHMENTS_MAX_BYTES, type MailboxComposeMode, type MailboxUploadAttachment, type MailboxRecordContext } from '@leadcrm/shared';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { toast } from '@/shared/utils/toast';
import { initiateGmailConnect, associateThreadDeal, sendGmailEmail, saveGmailDraft, scheduleGmailEmail, deleteGmailDraft, fetchGmailThread, fetchGmailMessageContent, fetchGmailAttachment, getGmailStatus, type GmailEmail } from '../services/gmail.service';
import { readComposeFiles } from '../services/compose-attachments';
import { ComposeDealSelect } from './compose-deal-select';
import EmojiPicker from './emoji-picker';
import { safeMailboxHtml } from '../services/email-html';
import type { MailboxComposeDraft } from '../services/email-presentation';
import type { ApiRequestError } from '@/lib/api/client';
import { useFocusMode } from '@/shared/lib/overlay-state';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useModalInteraction } from '@/shared/hooks/use-modal-interaction';
import { Input } from '@/shared/components/ui/input';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSent: () => void;
  initialDraft?: MailboxComposeDraft | null;
  authorizationRevision?: number;
  retryAt?: number;
  onDealLinkResult?: (link: { threadId: string; sourceDealId: string; messageId?: string }, linked: boolean) => void;
}

export default function ComposeModal({ isOpen, onClose, onSent, initialDraft, authorizationRevision = 0, retryAt = 0, onDealLinkResult }: ComposeModalProps): React.ReactElement | null {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [dealId, setDealId] = useState('');
  const [recordContext, setRecordContext] = useState<MailboxRecordContext>();
  const [attachments, setAttachments] = useState<MailboxUploadAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentRetry, setAttachmentRetry] = useState(0);
  const [attachmentIssues, setAttachmentIssues] = useState<{ id: string; filename: string; error: string }[]>([]);
  const [inlineAttachmentNotice, setInlineAttachmentNotice] = useState(false);
  const restoredAttachments = useRef(new Map<string, MailboxUploadAttachment>());
  const omittedAttachments = useRef(new Set<string>());
  const attachmentBytes = attachments.reduce((sum, file) => sum + file.content.length * 3 / 4 - (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0), 0);
  const attachmentLimitError = attachments.length > 10 ? 'Remove attachments until at most 10 remain.' : attachmentBytes > MAILBOX_ATTACHMENTS_MAX_BYTES ? 'Remove attachments until they total 10 MB or less.' : '';
  const attachmentBlocked = !!attachmentError || !!attachmentIssues.length || !!attachmentLimitError;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readingFiles = useRef(false);
  const [sentLink, setSentLink] = useState<{ threadId: string; sourceDealId: string; messageId?: string } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
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
  const draftRequest = useRef<{ key: string; id: string } | null>(null);
  const mutationPending = useRef(false);
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(undefined);
  const [composeMode, setComposeMode] = useState<MailboxComposeMode | ''>('compose');
  const [forwardRecipients, setForwardRecipients] = useState<string[] | null>(null);
  const [forwardRecipientsFailed, setForwardRecipientsFailed] = useState(false);
  const [forwardRecipientsRetry, setForwardRecipientsRetry] = useState(0);
  const [connectionRequired, setConnectionRequired] = useState(false);
  const [sourceMessageId, setSourceMessageId] = useState('');
  const [sourceOptions, setSourceOptions] = useState<GmailEmail[]>([]);
  const employeeRecipientsRequired = composeMode === 'forward' || !!initialDraft?.isInternal || !!sourceOptions.find(email => email.id === sourceMessageId)?.isInternal;
  const forwardRecipientsBlocked = employeeRecipientsRequired && forwardRecipients === null;
  const [sourceLoading, setSourceLoading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const toInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const minimizedBody = useRef('');
  const retainedComposer = useRef<{ to: string; subject: string; body: string; attachments: MailboxUploadAttachment[]; recordContext?: MailboxRecordContext; dealId?: string } | null>(null);
  const lastAuthorizationRevision = useRef(authorizationRevision);
  const operationGeneration = useRef(0);
  const authoredContent = useRef(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const owner = React.useId();
  const compact = useMediaQuery('(max-width: 767px)');
  const modal = isOpen && !isMinimized && (compact || isFullscreen);
  useFocusMode(isOpen && !isMinimized && isFullscreen);
  const closeComposer = () => {
    if (mutationPending.current) return;
    // Keep independently authored work in this actor's mounted Inbox. Source drafts remain provider-owned.
    if (!currentDraftId && !initialDraft?.draftId && !initialDraft?.replyToMessageId && !initialDraft?.forwardSourceMessageId && !initialDraft?.sourceDealId) {
      const body = getEditorContent() || minimizedBody.current;
      retainedComposer.current = authoredContent.current || attachments.length || (editorRef.current?.textContent ?? '').trim() ? { to, subject, body, attachments, recordContext, dealId } : null;
    }
    onClose();
  };
  useModalInteraction({ open: modal, panelRef, owner, onClose: closeComposer });

  useEffect(() => {
    if (lastAuthorizationRevision.current === authorizationRevision) return;
    lastAuthorizationRevision.current = authorizationRevision;
    operationGeneration.current++;
    if (currentDraftId || recordContext || initialDraft?.draftId || initialDraft?.replyToMessageId || initialDraft?.forwardSourceMessageId || initialDraft?.sourceDealId) {
      retainedComposer.current = null; minimizedBody.current = '';
      scheduleRequest.current = null; sendRequest.current = null; draftRequest.current = null;
      setTo(''); setSubject(''); setCurrentDraftId(undefined); setSentLink(null); setError(null);
      setAttachments([]); setDealId(''); setRecordContext(undefined); setAttachmentError('');
      setAttachmentIssues([]); setInlineAttachmentNotice(false); setAttachmentBusy(false);
      restoredAttachments.current.clear(); omittedAttachments.current.clear();
      if (editorRef.current) editorRef.current.innerHTML = '';
      onClose();
    }
  }, [authorizationRevision, currentDraftId, recordContext, initialDraft, onClose]);

  useEffect(() => {
    operationGeneration.current++;
    setAttachmentBusy(false);
  }, [isOpen, initialDraft]);

  useEffect(() => {
    if (!isOpen || !initialDraft?.draftContextRequired || !initialDraft.draftThreadId) return;
    const controller = new AbortController(), generation = operationGeneration.current;
    setSourceOptions([]); setSourceLoading(true);
    void fetchGmailThread(initialDraft.draftThreadId, controller.signal).then(result => {
      if (!controller.signal.aborted && generation === operationGeneration.current) setSourceOptions(result.emails.filter(email => !email.labels.includes('DRAFT')));
    }).catch(() => { if (!controller.signal.aborted && generation === operationGeneration.current) setError('Original messages are unavailable. Refresh your Inbox to check current access.'); })
      .finally(() => { if (!controller.signal.aborted && generation === operationGeneration.current) setSourceLoading(false); });
    return () => controller.abort();
  }, [isOpen, initialDraft, authorizationRevision]);

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

  // An explicit source takes precedence over independently authored, unsaved work.
  useEffect(() => {
    if (isOpen) {
      const restored = initialDraft ?? retainedComposer.current;
      authoredContent.current = !initialDraft && !!retainedComposer.current;
      setError(null); setToError(null); setShowScheduleMenu(false); setConfirmDiscard(false);
      if (initialDraft || !retainedComposer.current) { scheduleRequest.current = null; sendRequest.current = null; draftRequest.current = null; }
      setSentLink(null);
      setTo(restored?.to ?? '');
      setSubject(restored?.subject ?? '');
      setDealId(restored?.dealId ?? ''); setRecordContext(restored?.recordContext);
      setAttachments(!initialDraft ? retainedComposer.current?.attachments ?? [] : []);
      setAttachmentError('');
      setAttachmentIssues([]); setInlineAttachmentNotice(!!initialDraft?.forwardImageNotice);
      restoredAttachments.current.clear(); omittedAttachments.current.clear();
      setCurrentDraftId(initialDraft?.draftId);
      setComposeMode(initialDraft?.draftContextRequired ? '' : initialDraft?.composeMode ?? (initialDraft?.replyToMessageId ? 'reply' : initialDraft?.forwardSourceMessageId ? 'forward' : 'compose'));
      setSourceMessageId(initialDraft?.replyToMessageId ?? initialDraft?.forwardSourceMessageId ?? '');
      // Refs are mounted before effects; delayed initialization could overwrite newly typed content.
      if (editorRef.current) editorRef.current.innerHTML = safeMailboxHtml(restored?.body ?? '');
      else minimizedBody.current = safeMailboxHtml(restored?.body ?? '');
    }
  }, [isOpen, initialDraft]);

  useEffect(() => {
    const messageId = initialDraft?.attachmentSourceMessageId;
    if (!isOpen || !messageId) return;
    const controller = new AbortController(), generation = operationGeneration.current;
    const stale = () => controller.signal.aborted || generation !== operationGeneration.current;
    setAttachmentBusy(true); setAttachmentError('');
    void (async () => {
      const files = initialDraft.sourceAttachments ?? (await fetchGmailMessageContent(messageId, controller.signal)).attachments;
      if (stale()) return;
      const issues: { id: string; filename: string; error: string }[] = [];
      setInlineAttachmentNotice(!!initialDraft.forwardImageNotice || files.some(file => file.disposition === 'inline' || !!file.contentId));
      for (const [index, file] of files.entries()) {
        if (stale()) return;
        if (omittedAttachments.current.has(file.id) || restoredAttachments.current.has(file.id)) continue;
        const extension = Object.keys(MAILBOX_ATTACHMENT_TYPES).find(key => MAILBOX_ATTACHMENT_TYPES[key] === file.mimeType);
        const filename = file.filename || (extension ? `inline-image-${index + 1}.${extension}` : `attachment-${index + 1}`);
        try {
          if (!mailboxAttachmentType(filename)) throw new Error('This file format cannot be forwarded. Remove it to continue.');
          if (file.size !== undefined && (!file.size || file.size > MAILBOX_ATTACHMENT_MAX_BYTES)) throw new Error('Forwarded files must be nonempty and up to 5 MB each. Remove this file to continue.');
          const blob = await fetchGmailAttachment(messageId, file.id, controller.signal);
          const [restored] = await readComposeFiles([new File([blob], filename, { type: file.mimeType })]);
          if (stale()) return;
          restoredAttachments.current.set(file.id, restored);
          setAttachments(current => [...current, restored]);
        } catch (error) {
          if (stale()) return;
          const request = error as ApiRequestError;
          const fileFailure = request.code === 'MAILBOX_ATTACHMENT_UNAVAILABLE' || request.code?.startsWith('GMAIL_') && request.code !== 'GMAIL_RECONNECT_REQUIRED';
          if ((!fileFailure && [401, 403, 404].includes(request.status ?? 0)) || request.code === 'MAILBOX_SCOPE_CHANGED') { actionFailed(error, 'Original attachments are unavailable.'); return; }
          if (request.retryAt || request.status === 429) setActionRetryAt(Date.parse(request.retryAt ?? '') || Date.now() + 60000);
          issues.push({ id: file.id, filename, error: error instanceof Error ? error.message : 'Unable to load this attachment.' });
        }
      }
      if (!stale()) setAttachmentIssues(issues);
    })().catch(error => { if (!stale()) {
      const request = error as ApiRequestError;
      if ([401, 403, 404].includes(request.status ?? 0) || request.code === 'MAILBOX_SCOPE_CHANGED') actionFailed(error, 'Original attachments are unavailable.');
      else {
        if (request.retryAt || request.status === 429) setActionRetryAt(Date.parse(request.retryAt ?? '') || Date.now() + 60000);
        setAttachmentError('Original attachments could not be loaded. Retry before sending or saving.');
      }
    } })
      .finally(() => { if (!stale()) setAttachmentBusy(false); });
    return () => controller.abort();
  }, [isOpen, initialDraft, attachmentRetry]);

  useEffect(() => {
    setForwardRecipients(null); setForwardRecipientsFailed(false); setConnectionRequired(false);
    if (!isOpen || !employeeRecipientsRequired) return;
    const controller = new AbortController(), generation = operationGeneration.current;
    void getGmailStatus(controller.signal, true).then(status => {
      if (!status.isConnected) { if (!controller.signal.aborted && generation === operationGeneration.current) setConnectionRequired(true); return; }
      if (!Array.isArray(status.forwardRecipientEmails)) throw new Error('Employee recipients unavailable.');
      if (!controller.signal.aborted && generation === operationGeneration.current) setForwardRecipients(status.forwardRecipientEmails.map(email => email.trim().toLowerCase()));
    }).catch(() => { if (!controller.signal.aborted && generation === operationGeneration.current) setForwardRecipientsFailed(true); });
    return () => controller.abort();
  }, [isOpen, employeeRecipientsRequired, initialDraft, authorizationRevision, forwardRecipientsRetry]);

  const addAttachments = async (files: File[]) => {
    if (readingFiles.current || mutationPending.current || attachmentBusy || attachmentBlocked || !files.length) return;
    readingFiles.current = true; setAttachmentBusy(true);
    const generation = operationGeneration.current;
    try { const result = await readComposeFiles(files, attachments); if (generation === operationGeneration.current) { setAttachments(result); authoredContent.current = true; } }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to attach files.'); }
    finally { readingFiles.current = false; if (generation === operationGeneration.current) setAttachmentBusy(false); }
  };

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
  const sourceContext = { composeMode: composeMode || undefined, recordContext: employeeRecipientsRequired ? undefined : recordContext, dealId: employeeRecipientsRequired ? undefined : dealId || initialDraft?.sourceDealId || undefined,
    replyToMessageId: composeMode === 'reply' || composeMode === 'replyAll' ? sourceMessageId || undefined : undefined,
    forwardSourceMessageId: composeMode === 'forward' ? sourceMessageId || undefined : undefined };
  const sourceRequired = !!initialDraft?.draftContextRequired && (!composeMode || !sourceOptions.some(email => email.id === sourceMessageId));
  const forwardRecipientError = (values: string[]) => employeeRecipientsRequired && values.some(value => !forwardRecipients?.includes(value.trim().toLowerCase())) ? MAILBOX_FORWARD_RECIPIENT_ERROR : null;
  const actionFailed = (error: unknown, fallback: string) => {
    const request = error as ApiRequestError;
    const editableFailure = request.code === 'MAILBOX_RECIPIENT_REJECTED' || request.code === 'GMAIL_WRITE_REJECTED';
    if (!editableFailure && ([401, 403, 404].includes(request.status ?? 0) || request.code === 'MAILBOX_SCOPE_CHANGED') && (currentDraftId || sourceMessageId || recordContext || initialDraft?.sourceDealId)) {
      operationGeneration.current++; resetForm(); onClose(); return;
    }
    setError(error instanceof Error ? error.message : fallback);
    setActionRetryAt(Date.parse(request.retryAt ?? '') || (request.status === 429 ? Date.now() + 60000 : 0));
  };

  const handleSend = async (scheduledAt?: string): Promise<void> => {
    if (mutationPending.current || paused || attachmentBusy || attachmentBlocked || forwardRecipientsBlocked) return;
    if (sourceRequired) { setError('Choose the original authorized message and its action before continuing.'); return; }
    if (sentLink) {
      mutationPending.current = true; setIsSending(true);
      const generation = operationGeneration.current;
      try { await associateThreadDeal(sentLink.threadId, sentLink.sourceDealId, sentLink.messageId ? { messageId: sentLink.messageId } : {}); if (generation !== operationGeneration.current) return; onDealLinkResult?.(sentLink, true); setSentLink(null); resetForm(); onClose(); toast.success('Email linked to deal.'); }
      catch { if (generation === operationGeneration.current) setError('Email sent, but linking to the Deal failed.'); }
      finally { mutationPending.current = false; setIsSending(false); }
      return;
    }
    if (!to.trim()) {
      setError('Please specify at least one recipient');
      return;
    }

    // Validate email format
    const recipients = to.split(',').map(value => value.trim());
    if (!SendMailboxEmailSchema.shape.to.safeParse(recipients).success) {
      setError('Enter valid email addresses separated by commas (at most 50).');
      return;
    }

    const employeeError = forwardRecipientError(recipients);
    if (employeeError) { setToError(employeeError); setError(employeeError); return; }
    const htmlBody = getEditorContent();
    const textContent = editorRef.current?.textContent ?? '';

    if (!textContent.trim()) {
      setError('Cannot send an empty message');
      return;
    }

    const parsed = SendMailboxEmailSchema.omit({ requestId: true }).safeParse({ to: recipients, subject: subject.trim() || '(no subject)', body: htmlBody, attachments, ...sourceContext });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    mutationPending.current = true; setIsSending(true);
    setError(null);
    const generation = operationGeneration.current;

    try {
      if (scheduledAt) {
        const payload = { to: recipients, subject: subject.trim() || '(no subject)', body: htmlBody, attachments, scheduledAt, draftId: currentDraftId, ...sourceContext };
        const key = JSON.stringify(payload);
        if (scheduleRequest.current?.key !== key) scheduleRequest.current = { key, id: crypto.randomUUID() };
        await scheduleGmailEmail({ ...payload, requestId: scheduleRequest.current.id });
        if (generation !== operationGeneration.current) return;
      } else {
        const key = JSON.stringify([recipients, subject, htmlBody, currentDraftId, sourceContext, attachments]);
        if (sendRequest.current?.key !== key) sendRequest.current = { key, id: crypto.randomUUID() };
        const result = await sendGmailEmail(recipients, subject.trim() || '(no subject)', htmlBody, sourceContext.replyToMessageId, currentDraftId, sourceContext.forwardSourceMessageId, sendRequest.current.id, sourceContext.composeMode, { attachments, recordContext: sourceContext.recordContext, dealId: sourceContext.dealId });
        if (generation !== operationGeneration.current) return;
        if (!employeeRecipientsRequired && initialDraft?.sourceDealId) {
          const link = { threadId: result.threadId, sourceDealId: initialDraft.sourceDealId, messageId: result.messageId };
          try { await associateThreadDeal(link.threadId, link.sourceDealId, { messageId: link.messageId }); if (generation !== operationGeneration.current) return; onDealLinkResult?.(link, true); }
          catch { if (generation !== operationGeneration.current) return; setSentLink(link); onDealLinkResult?.(link, false); setError('Email sent, but linking to the Deal failed.'); onSent(); toast.success('Email sent.'); return; }
        }
        toast.success('Email sent.');
      }
      resetForm();
      onSent();
      onClose();
    } catch (err) {
      if (generation === operationGeneration.current) actionFailed(err, 'Failed to send email');
    } finally {
      mutationPending.current = false; setIsSending(false);
    }
  };

  const resetForm = (): void => {
    retainedComposer.current = null;
    setTo('');
    setSubject('');
    setAttachments([]); setDealId(''); setRecordContext(undefined); setAttachmentError('');
    setAttachmentIssues([]); setInlineAttachmentNotice(false);
    restoredAttachments.current.clear(); omittedAttachments.current.clear();
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
    if (mutationPending.current || paused || sentLink || attachmentBusy || attachmentBlocked || forwardRecipientsBlocked) return;
    if (sourceRequired) { setError('Choose the original authorized message and its action before continuing.'); return; }
    if (to.trim() && !SendMailboxEmailSchema.shape.to.safeParse(to.split(',').map(value => value.trim())).success) { setError('Enter valid email addresses separated by commas (at most 50).'); return; }
    const employeeError = to.trim() ? forwardRecipientError(to.split(',')) : null;
    if (employeeError) { setToError(employeeError); setError(employeeError); return; }
    const htmlBody = getEditorContent();
    if (!to.trim() && !subject.trim() && !htmlBody.trim() && !attachments.length) {
      return; // Nothing to save
    }

    mutationPending.current = true; setIsSavingDraft(true);
    const generation = operationGeneration.current;
    try {
      const key = JSON.stringify([to.trim(), subject.trim(), htmlBody, currentDraftId, sourceContext, attachments]);
      if (draftRequest.current?.key !== key) draftRequest.current = { key, id: crypto.randomUUID() };
      const result = await saveGmailDraft(to.trim(), subject.trim(), htmlBody, currentDraftId, sourceContext.replyToMessageId, sourceContext.forwardSourceMessageId, draftRequest.current.id, sourceContext.composeMode, { attachments, recordContext: sourceContext.recordContext, dealId: sourceContext.dealId });
      if (generation !== operationGeneration.current) return;
      setCurrentDraftId(result.draftId);
      setDraftSaved(true);
      // Reset saved indicator after 3 seconds
      setTimeout(() => setDraftSaved(false), 3000);
    } catch (error) {
      if (generation === operationGeneration.current) actionFailed(error, 'Draft was not saved.');
    } finally {
      mutationPending.current = false; setIsSavingDraft(false);
    }
  };

  const handleDiscard = async (): Promise<void> => {
    if (mutationPending.current || currentDraftId && paused) return;
    mutationPending.current = true;
    const generation = operationGeneration.current;
    try { if (currentDraftId) await deleteGmailDraft(currentDraftId); if (generation !== operationGeneration.current) return; setConfirmDiscard(false); resetForm(); onSent(); onClose(); toast.success('Draft discarded.'); }
    catch (error) { if (generation === operationGeneration.current) throw error; }
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
              onClick={closeComposer}
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
    <>
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={springTransition}
      className={`${containerClasses} flex flex-col border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 shadow-2xl`}
      role="dialog"
      aria-modal={modal ? true : undefined}
      aria-label="Compose email"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (showEmojiPicker || showLinkInput || showMoreMenu || showScheduleMenu) { setShowEmojiPicker(false); setShowLinkInput(false); setShowMoreMenu(false); setShowScheduleMenu(false); } else closeComposer(); } }}
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
            onClick={closeComposer}
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
          <Input
            ref={toInputRef}
            id="compose-to"
            type="email"
            placeholder="name@example.com"
            multiple
            readOnly={!!sentLink || composeMode !== 'forward' && !!initialDraft?.sourceDealId}
            value={to}
            onChange={(e) => {
              authoredContent.current = true;
              setTo(e.target.value);
              setError(null);
              // Clear error if user is typing a valid email
              if (toError && SendMailboxEmailSchema.shape.to.safeParse(e.target.value.split(',').map(value => value.trim())).success && !forwardRecipientError(e.target.value.split(','))) {
                setToError(null);
              }
            }}
            onBlur={() => {
              if (to.trim() && !SendMailboxEmailSchema.shape.to.safeParse(to.split(',').map(value => value.trim())).success) {
                setToError('Enter valid email addresses separated by commas (at most 50).');
              } else {
                setToError(to.trim() && forwardRecipients ? forwardRecipientError(to.split(',')) : null);
              }
            }}
            className="h-auto min-w-0 flex-1 py-2.5 text-[13px]"
            aria-invalid={!!toError}
          />
        </div>
        {toError && (
          <p className="text-[11px] text-red-500 dark:text-red-400 pb-1.5 pl-8">
            {toError}
          </p>
        )}
      </div>

      {composeMode === 'forward' && <p className="px-4 py-1 text-xs text-muted-foreground">Forward to active employees in your workspace.</p>}
      {connectionRequired && <p role="alert" className="px-4 py-2 text-sm text-red-600">Connect your work Gmail account first. <button type="button" className="underline" onClick={() => void initiateGmailConnect().catch(error => setError(error instanceof Error ? error.message : 'Unable to connect Gmail.'))}>Connect Gmail</button></p>}
      {forwardRecipientsBlocked && !connectionRequired && (forwardRecipientsFailed
        ? <div role="alert" className="px-4 py-1 text-xs">Employee recipients could not be loaded. <button type="button" className="underline" onClick={() => setForwardRecipientsRetry(value => value + 1)}>Retry employee recipients</button></div>
        : <p role="status" className="px-4 py-1 text-xs">Checking employee recipients…</p>)}

      {/* Subject */}
      <div className="flex items-center border-b border-gray-100 dark:border-white/[0.05] px-4 shrink-0">
        <Input
          id="compose-subject"
          aria-label="Subject"
          type="text"
          readOnly={!!sentLink}
          value={subject}
          onChange={(e) => { authoredContent.current = true; setSubject(e.target.value); }}
          placeholder="Subject"
          className="h-auto min-w-0 flex-1 py-2.5 text-[13px]"
        />
      </div>

      {!employeeRecipientsRequired && recordContext && <ComposeDealSelect context={recordContext} dealId={dealId} disabled={isSending || isSavingDraft || !!sentLink} onSelect={(id, title) => { setDealId(id); if (title) setSubject(title); authoredContent.current = true; }} />}

      {initialDraft?.draftContextRequired && <div className="space-y-2 border-b border-gray-100 px-4 py-2 text-xs dark:border-white/[0.05]">
        <p>This older draft needs its original message and action selected before delivery.</p>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Draft action" value={composeMode} disabled={sourceLoading || isSending || isSavingDraft} onChange={event => setComposeMode(event.target.value as MailboxComposeMode | '')} className="min-h-9 rounded border border-border bg-background px-2">
            <option value="">Choose action</option><option value="reply">Reply</option><option value="replyAll">Reply All</option><option value="forward">Forward</option>
          </select>
          <select aria-label="Original message for draft" value={sourceMessageId} disabled={sourceLoading || isSending || isSavingDraft} onChange={event => setSourceMessageId(event.target.value)} className="min-h-9 min-w-0 flex-1 rounded border border-border bg-background px-2">
            <option value="">{sourceLoading ? 'Loading authorized messages…' : 'Choose original message'}</option>
            {sourceOptions.map(email => <option key={email.id} value={email.id}>{email.subject || '(no subject)'} · {email.from} · {new Date(email.date).toLocaleString()}</option>)}
          </select>
        </div>
      </div>}

      {/* Rich Text Body Editor */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div
          ref={editorRef}
          contentEditable={!sentLink}
          role="textbox"
          aria-label="Email body"
          aria-multiline="true"
          onInput={() => { authoredContent.current = true; }}
          onKeyUp={updateActiveFormats}
          onMouseUp={updateActiveFormats}
          onPaste={event => { event.preventDefault(); const html = event.clipboardData.getData('text/html'); document.execCommand(html ? 'insertHTML' : 'insertText', false, html ? safeMailboxHtml(html) : event.clipboardData.getData('text/plain')); }}
          className="inbox-message-typography w-full flex-1 px-4 py-3 text-slate-900 dark:text-white bg-transparent focus:outline-none overflow-y-auto min-h-[100px] [&_a]:text-blue-500 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5"
          suppressContentEditableWarning
        />

      </div>

      {!!attachments.length && <ul aria-label="Email attachments" className="max-h-28 shrink-0 overflow-y-auto px-4 py-2 text-xs">{attachments.map((file, index) => <li key={index} className="flex min-w-0 items-center gap-2 py-1"><Paperclip size={13} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{file.filename}</span><button type="button" disabled={isSending || isSavingDraft || attachmentBusy || !!sentLink} aria-label={`Remove attachment ${file.filename}`} onClick={() => {
        for (const [id, restored] of restoredAttachments.current) if (restored === file) omittedAttachments.current.add(id);
        setAttachments(current => current.filter((_, position) => position !== index));
      }} className="grid h-8 w-8 place-items-center"><X size={14} /></button></li>)}</ul>}
      {!!attachmentIssues.length && <ul aria-label="Attachments needing attention" className="max-h-28 overflow-y-auto px-4 text-xs">{attachmentIssues.map(file => <li key={file.id} className="py-1"><p role="alert">{file.filename}: {file.error}</p><button type="button" disabled={attachmentBusy || isSending || isSavingDraft || paused} onClick={() => setAttachmentRetry(value => value + 1)} className="mr-3 underline">Retry {file.filename}</button><button type="button" disabled={attachmentBusy || isSending || isSavingDraft} onClick={() => { omittedAttachments.current.add(file.id); setAttachmentIssues(current => current.filter(issue => issue.id !== file.id)); }} className="underline">Remove {file.filename} from forward</button></li>)}</ul>}
      {inlineAttachmentNotice && <p role="status" className="px-4 py-1 text-xs text-muted-foreground">Available embedded images are included as attachments. Original image placement and remote images are not preserved.</p>}
      {attachmentLimitError && <p role="alert" className="px-4 py-1 text-xs text-destructive">{attachmentLimitError}</p>}
      {attachmentBusy && <p role="status" className="px-4 py-1 text-xs text-muted-foreground">Loading attachments…</p>}
      {attachmentError && <p role="alert" className="px-4 py-1 text-xs text-destructive">{attachmentError} <button type="button" disabled={attachmentBusy || paused} onClick={() => setAttachmentRetry(value => value + 1)} className="underline">Retry attachments</button></p>}
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
              disabled={isSending || isSavingDraft || paused || sourceRequired || attachmentBusy || attachmentBlocked || forwardRecipientsBlocked}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-l-full bg-primary hover:bg-[var(--primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-medium active:scale-95 transition-all cursor-pointer"
              aria-label={sentLink ? "Retry deal link" : "Send email"}
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>{isSending ? (sentLink ? 'Linking…' : 'Sending...') : sentLink ? 'Retry deal link' : 'Send'}</span>
            </button>
            <button
              disabled={isSending || isSavingDraft || paused || sourceRequired || attachmentBusy || attachmentBlocked || forwardRecipientsBlocked || composeMode !== 'forward' && !!initialDraft?.sourceDealId || !!sentLink}
              onClick={() => setShowScheduleMenu(value => !value)}
              aria-expanded={showScheduleMenu}
              title="Schedule send"
              className="h-9 px-2 rounded-r-full bg-primary hover:bg-[var(--primary-hover)] disabled:opacity-60 border-l border-primary text-white cursor-pointer transition-colors"
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
            <input ref={fileInputRef} type="file" multiple hidden accept={Object.keys(MAILBOX_ATTACHMENT_TYPES).map(extension => `.${extension}`).join(',')} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addAttachments(files); }} />
            <button type="button" aria-label="Attach files" title="Attach files (up to 5 MB each, 10 MB total)" disabled={isSending || isSavingDraft || attachmentBusy || attachmentBlocked || !!sentLink} onClick={() => fileInputRef.current?.click()} className="rounded-full p-2 text-slate-500 hover:bg-muted disabled:opacity-50"><Paperclip className="h-4 w-4" /></button>
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
                      <Input
                        type="url"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        placeholder="https://..."
                        className="min-w-0 flex-1 h-8 px-2.5 rounded-md border text-xs"
                        onKeyDown={(e) => { if (e.key === 'Enter') insertLink(); }}
                        autoFocus
                      />
                      <button
                        onClick={insertLink}
                        className="h-8 px-3 rounded-md bg-primary text-white text-xs font-medium hover:bg-[var(--primary-hover)] cursor-pointer"
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
            disabled={isSavingDraft || isSending || paused || sourceRequired || attachmentBusy || attachmentBlocked || forwardRecipientsBlocked}
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
            onClick={() => { if (currentDraftId || to.trim() || subject.trim() || getEditorContent().trim() || attachments.length) setConfirmDiscard(true); else void handleDiscard(); }}
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
    <ConfirmActionDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} title="Discard draft?"
      description="This draft and its unsaved content will be discarded. This action cannot be undone."
      variant="destructive" confirmLabel="Discard draft" onConfirm={handleDiscard} />
    </>
  );
}
