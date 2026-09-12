'use client';

/**
 * business-verification-modal.tsx
 *
 * Multi-step business verification modal shown to SANDBOX guests
 * before they can subscribe. Flow:
 *
 *   Step 1 � Business Type Selection
 *   Step 2 � Document Upload (dynamic based on business type)
 *   Step 3 � Status (Pending / Approved / Rejected)
 *
 * The selected plan and billing cycle from PlanSelectionModal are
 * preserved and shown throughout, so the guest never loses context.
 * On APPROVED status, the "Continue to Checkout" button becomes active.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clock, CheckCircle2, Upload, X, FileText,
  Building2, AlertTriangle, Loader2, ChevronRight, RefreshCw,
  ArrowLeft, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { verificationApi } from '@/shared/services/verification.api';
import { ModalCloseButton } from '@/shared/components/ui/modal-close-button';
import {
  BUSINESS_TYPES,
  getRequirementsForBusinessType,
} from '../config/document-requirements';
import type {
  TenantVerificationState,
  VerificationDocument,
  BusinessType,
  DocumentKey,
  UploadStatus,
  DocumentUploadState,
  BusinessDocumentRequirement,
} from '../types/verification.types';
import type { BillingCycle } from '../types/billing.types';

// --- Helpers ------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
  if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase()) && !ALLOWED_EXTENSIONS.includes(ext)) {
    return 'Invalid file type. Please upload a PDF, JPEG, PNG, or WEBP file.';
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File is too large. Maximum size is 10 MB (your file: ${formatFileSize(file.size)}).`;
  }
  return null;
}

// --- Props --------------------------------------------------------------------

interface BusinessVerificationModalProps {
  isOpen: boolean;
  pendingPlanId: string | null;
  pendingCycle: BillingCycle | null;
  pendingPlanName: string | null;
  onProceedToCheckout: (planId: string, cycle: BillingCycle) => void;
  onClose: () => void;
}

// --- Step type ----------------------------------------------------------------

type ModalStep = 'loading' | 'business-type' | 'documents' | 'status';

// --- Plan Badge (shows selected plan context throughout) ---------------------

function PlanBadge({ planName, cycle }: { planName: string | null; cycle: BillingCycle | null }) {
  if (!planName || !cycle) return null;
  const cycleLabel = cycle === 'MONTHLY' ? '/mo' : cycle === 'QUARTERLY' ? '/qtr' : '/yr';
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400 text-xs font-medium">
      <Sparkles size={11} />
      {planName} � {cycleLabel}
    </div>
  );
}

// --- Document Upload Row ------------------------------------------------------

interface DocumentRowProps {
  requirement: BusinessDocumentRequirement;
  uploadState: DocumentUploadState;
  serverDocument: VerificationDocument | null;
  onFileSelect: (key: DocumentKey, file: File) => void;
  onRemove: (key: DocumentKey) => void;
}

function DocumentRow({ requirement, uploadState, serverDocument, onFileSelect, onRemove }: DocumentRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isUploaded = uploadState.uploadStatus === 'uploaded' || (serverDocument !== null && uploadState.uploadStatus === 'idle');
  const isUploading = uploadState.uploadStatus === 'uploading';
  const hasError = uploadState.uploadStatus === 'error';

  return (
    <div className={cn(
      'rounded-xl border p-4 transition-colors',
      isUploaded
        ? 'border-emerald-200 dark:border-emerald-700/50 bg-emerald-50/50 dark:bg-emerald-900/10'
        : hasError
          ? 'border-red-200 dark:border-red-700/50 bg-red-50/30 dark:bg-red-900/10'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40',
    )}>
      {/* Row header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <FileText size={16} className={cn(
            'mt-0.5 shrink-0',
            isUploaded ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500',
          )} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {requirement.name}
              </span>
              <span className={cn(
                'inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide',
                requirement.required
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
              )}>
                {requirement.required ? 'Required' : 'Optional'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {requirement.description}
            </p>
          </div>
        </div>
      </div>

      {/* File status / upload control */}
      {isUploaded ? (
        <div className="flex items-center justify-between mt-2 pl-[26px]">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-xs text-emerald-700 dark:text-emerald-400 truncate font-medium">
              {serverDocument?.fileName ?? uploadState.file?.name ?? 'Uploaded'}
            </span>
            {serverDocument?.fileSize != null && (
              <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
                ({formatFileSize(serverDocument.fileSize)})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => onRemove(requirement.key)}
              className="text-xs text-red-500 dark:text-red-400 hover:underline cursor-pointer"
            >
              Remove
            </button>
          </div>
        </div>
      ) : isUploading ? (
        <div className="flex items-center gap-2 mt-2 pl-[26px]">
          <Loader2 size={14} className="animate-spin text-blue-500" />
          <span className="text-xs text-slate-500 dark:text-slate-400">Uploading...</span>
        </div>
      ) : (
        <div className="mt-2 pl-[26px]">
          {hasError && uploadState.errorMessage && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-1.5">{uploadState.errorMessage}</p>
          )}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
              'border border-dashed',
              hasError
                ? 'border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400',
            )}
          >
            <Upload size={12} />
            Choose File
          </button>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            PDF, JPEG, PNG or WEBP � Max 10 MB
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(requirement.key, file);
          // Reset so the same file can be re-selected after removal
          e.target.value = '';
        }}
      />
    </div>
  );
}

// --- Main Component -----------------------------------------------------------

export function BusinessVerificationModal({
  isOpen,
  pendingPlanId,
  pendingCycle,
  pendingPlanName,
  onProceedToCheckout,
  onClose,
}: BusinessVerificationModalProps): React.ReactElement | null {
  const [step, setStep] = useState<ModalStep>('loading');
  const [verificationState, setVerificationState] = useState<TenantVerificationState | null>(null);
  const [selectedBusinessType, setSelectedBusinessType] = useState<BusinessType | null>(null);
  const [uploadStates, setUploadStates] = useState<Partial<Record<DocumentKey, DocumentUploadState>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  // --- Load verification state on open ------------------------------------
  const loadVerificationState = useCallback(async () => {
    setIsFetching(true);
    try {
      const res = await verificationApi.getVerificationStatus();
      const state = res.data;
      setVerificationState(state);

      // Restore business type if already set
      if (state.businessType) {
        setSelectedBusinessType(state.businessType as BusinessType);
      }

      // Determine step based on status
      if (state.verificationStatus === 'PENDING' || state.verificationStatus === 'APPROVED') {
        setStep('status');
      } else if (state.verificationStatus === 'REJECTED' || state.verificationStatus === 'REQUIRES_RESUBMISSION') {
        // Has existing documents � go straight to documents so they can resubmit
        setStep(state.businessType ? 'documents' : 'business-type');
      } else {
        // NOT_SUBMITTED
        setStep(state.businessType ? 'documents' : 'business-type');
      }
    } catch {
      toast.error('Failed to load verification status. Please try again.');
      setStep('business-type');
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadVerificationState();
    }
  }, [isOpen, loadVerificationState]);

  // --- Build upload states from server documents --------------------------
  useEffect(() => {
    if (!verificationState) return;
    const newStates: Partial<Record<DocumentKey, DocumentUploadState>> = {};
    for (const doc of verificationState.documents) {
      newStates[doc.documentKey] = {
        file: null,
        uploadStatus: 'idle',
        errorMessage: null,
        uploadedDocument: doc,
      };
    }
    setUploadStates((prev) => {
      // Merge: keep any in-progress states, add server-backed ones
      const merged = { ...newStates };
      for (const [k, v] of Object.entries(prev)) {
        const key = k as DocumentKey;
        if (v.uploadStatus === 'uploading' || v.uploadStatus === 'error') {
          merged[key] = v;
        }
      }
      return merged;
    });
  }, [verificationState]);

  // --- File select handler -------------------------------------------------
  const handleFileSelect = useCallback(async (key: DocumentKey, file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setUploadStates((prev) => ({
        ...prev,
        [key]: { file, uploadStatus: 'error', errorMessage: validationError, uploadedDocument: prev[key]?.uploadedDocument ?? null },
      }));
      return;
    }

    // Set uploading state
    setUploadStates((prev) => ({
      ...prev,
      [key]: { file, uploadStatus: 'uploading', errorMessage: null, uploadedDocument: prev[key]?.uploadedDocument ?? null },
    }));

    try {
      const res = await verificationApi.uploadDocument(key, file);
      setUploadStates((prev) => ({
        ...prev,
        [key]: { file, uploadStatus: 'uploaded', errorMessage: null, uploadedDocument: res.data.document },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setUploadStates((prev) => ({
        ...prev,
        [key]: { file, uploadStatus: 'error', errorMessage: message, uploadedDocument: prev[key]?.uploadedDocument ?? null },
      }));
      toast.error(message);
    }
  }, []);

  // --- Remove handler ------------------------------------------------------
  const handleRemoveDocument = useCallback(async (key: DocumentKey) => {
    setUploadStates((prev) => ({
      ...prev,
      [key]: { file: null, uploadStatus: 'idle', errorMessage: null, uploadedDocument: null },
    }));
    try {
      await verificationApi.deleteDocument(key);
    } catch {
      // Non-critical � UI already cleared. Server cleanup may have partially succeeded.
    }
  }, []);

  // --- Submit handler ------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (!selectedBusinessType) return;
    setIsSubmitting(true);
    try {
      await verificationApi.submitVerification(selectedBusinessType);
      toast.success('Documents submitted! Our team will review them shortly.');
      await loadVerificationState();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Submission failed. Please try again.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedBusinessType, loadVerificationState]);

  // --- Check if all required docs are uploaded -----------------------------
  const requirements = selectedBusinessType ? getRequirementsForBusinessType(selectedBusinessType) : [];
  const allRequiredUploaded = requirements
    .filter((r) => r.required)
    .every((r) => {
      const state = uploadStates[r.key];
      return (state?.uploadStatus === 'uploaded') || (state?.uploadedDocument != null && state.uploadStatus !== 'error');
    });

  const anyUploading = Object.values(uploadStates).some((s) => s?.uploadStatus === 'uploading');

  // --- Guard: return null when closed -------------------------------------
  if (!isOpen) return null;

  const status = verificationState?.verificationStatus ?? 'NOT_SUBMITTED';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      {/* Modal panel */}
      <AnimatePresence mode="wait">
        <motion.div
          key="verification-modal"
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ duration: 0.2 }}
          className="relative bg-white dark:bg-slate-950 rounded-2xl border border-gray-200 dark:border-white/[0.08] w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
        >
          {/* -- Header ------------------------------------------------------- */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-white/[0.05] shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <Building2 size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Business Verification</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Required before subscribing to a LeadCRM plan
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <PlanBadge planName={pendingPlanName} cycle={pendingCycle} />
              <ModalCloseButton onClose={onClose} ariaLabel="Close verification modal" size={18} />
            </div>
          </div>

          {/* -- Content ------------------------------------------------------ */}
          <div className="overflow-y-auto flex-1">

            {/* -- Loading --------------------------------------------------- */}
            {(step === 'loading' || isFetching) && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 size={28} className="animate-spin text-blue-500" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading verification status�</p>
              </div>
            )}

            {/* -- Step 1: Business Type Selection --------------------------- */}
            {step === 'business-type' && !isFetching && (
              <div className="p-6 space-y-5">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    Before you subscribe to a LeadCRM plan, we need to verify your business account.
                    Select your business type so we can show you the exact documents required.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Business Type</p>
                  <div className="grid grid-cols-1 gap-2">
                    {BUSINESS_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setSelectedBusinessType(type)}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all cursor-pointer',
                          selectedBusinessType === type
                            ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-500/50',
                        )}
                      >
                        <div className={cn(
                          'w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center',
                          selectedBusinessType === type
                            ? 'border-blue-500 dark:border-blue-400'
                            : 'border-slate-300 dark:border-slate-600',
                        )}>
                          {selectedBusinessType === type && (
                            <div className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400" />
                          )}
                        </div>
                        <span className="text-sm font-medium">{type}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Requirement preview */}
                {selectedBusinessType && (
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                      Required Documents
                    </p>
                    <ul className="space-y-1">
                      {getRequirementsForBusinessType(selectedBusinessType).filter((r) => r.required).map((r) => (
                        <li key={r.key} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                          <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                          {r.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* -- Step 2: Document Upload ------------------------------------ */}
            {step === 'documents' && !isFetching && selectedBusinessType && (
              <div className="p-6 space-y-3">
                {(status === 'REJECTED' || status === 'REQUIRES_RESUBMISSION') && verificationState?.verificationRejectionReason && (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50">
                    <AlertTriangle size={16} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                        {status === 'REQUIRES_RESUBMISSION' ? 'Resubmission Required' : 'Verification Rejected'}
                      </p>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 leading-relaxed">
                        {verificationState.verificationRejectionReason}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedBusinessType}</span>
                    {' '}&middot;{' '}
                    <button
                      type="button"
                      onClick={() => setStep('business-type')}
                      className="text-blue-600 dark:text-blue-400 hover:underline text-xs cursor-pointer"
                    >
                      Change
                    </button>
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {requirements.filter((r) => r.required).length} required
                    {requirements.filter((r) => !r.required).length > 0 && (
                      <>, {requirements.filter((r) => !r.required).length} optional</>
                    )}
                  </p>
                </div>

                {requirements.map((req) => (
                  <DocumentRow
                    key={req.key}
                    requirement={req}
                    uploadState={uploadStates[req.key] ?? { file: null, uploadStatus: 'idle', errorMessage: null, uploadedDocument: null }}
                    serverDocument={uploadStates[req.key]?.uploadedDocument ?? null}
                    onFileSelect={handleFileSelect}
                    onRemove={handleRemoveDocument}
                  />
                ))}
              </div>
            )}

            {/* -- Step 3: Status -------------------------------------------- */}
            {step === 'status' && !isFetching && (
              <div className="p-6 flex flex-col items-center text-center gap-5 py-10">
                {status === 'PENDING' && (
                  <>
                    <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                      <Clock size={28} className="text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Under Review</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-md">
                        Your business documents have been submitted and are pending verification.
                        Our team typically reviews submissions within 1�3 business days.
                        We'll notify you once the review is complete.
                      </p>
                    </div>
                    <PlanBadge planName={pendingPlanName} cycle={pendingCycle} />
                    <div className="flex flex-col items-center gap-2">
                      <button
                        type="button"
                        disabled
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 text-sm font-semibold cursor-not-allowed"
                      >
                        <Clock size={15} />
                        Verification Pending�
                      </button>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        Checkout will be available once your business is approved.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={loadVerificationState}
                      className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                    >
                      <RefreshCw size={12} />
                      Refresh status
                    </button>
                  </>
                )}

                {status === 'APPROVED' && (
                  <>
                    <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                      <CheckCircle2 size={28} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Verification Approved!</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-md">
                        Your business has been verified. You can now proceed to checkout and subscribe.
                      </p>
                    </div>
                    <PlanBadge planName={pendingPlanName} cycle={pendingCycle} />
                    <button
                      type="button"
                      onClick={() => {
                        if (pendingPlanId && pendingCycle) {
                          onProceedToCheckout(pendingPlanId, pendingCycle);
                        }
                      }}
                      disabled={!pendingPlanId || !pendingCycle}
                      className={cn(
                        'inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-colors cursor-pointer',
                        'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white shadow-sm',
                        (!pendingPlanId || !pendingCycle) && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      Continue to Checkout
                      <ChevronRight size={16} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* -- Footer ------------------------------------------------------- */}
          {(step === 'business-type' || step === 'documents') && !isFetching && (
            <div className="px-6 py-4 border-t border-gray-200 dark:border-white/[0.05] flex items-center justify-between shrink-0 gap-3">
              <div>
                {step === 'documents' && (
                  <button
                    type="button"
                    onClick={() => setStep('business-type')}
                    className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    <ArrowLeft size={14} />
                    Back
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {step === 'business-type' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedBusinessType) setStep('documents');
                    }}
                    disabled={!selectedBusinessType}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer',
                      selectedBusinessType
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed',
                    )}
                  >
                    Continue
                    <ChevronRight size={15} />
                  </button>
                )}

                {step === 'documents' && (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!allRequiredUploaded || anyUploading || isSubmitting}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer',
                      allRequiredUploaded && !anyUploading && !isSubmitting
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed',
                    )}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Submitting�
                      </>
                    ) : (
                      <>Submit for Verification</>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
