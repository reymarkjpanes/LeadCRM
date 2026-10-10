'use client';
import { RecordBackButton } from '@/shared/components/crm/record-back-button';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import {
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CircleCheck,
  CircleX,
  Clock,
  ChevronDown,
  ChevronUp,
  Plus,
  Sparkles,
  Table2,
  ShieldCheck,
  Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useData } from '@/store/DataContext';
import { apiClient } from '@/lib/api/client';
import { getImportConfig } from '../configs';
import { parseCsv, autoMapColumns, createEmptyMappings } from '../utils';
import { ImportHistoryList } from './import-history-list';
import type {
  ImportModuleConfig,
  CsvColumn,
  ColumnMapping,
  ValidatedRow,
  ImportSummary,
  FieldDefinition,
} from '../types/import.types';
import type { ImportReviewRow, CreateCrmImportInput, PermissionKey } from '@leadcrm/shared';

// ── Props ────────────────────────────────────────────────────────────────────

interface ImportPageProps {
  moduleKey: string;
}

type WizardStep = 1 | 2 | 3;
type PageView = 'wizard' | 'history';

// ── Main Component ───────────────────────────────────────────────────────────

export default function ImportPage({ moduleKey }: ImportPageProps): React.ReactElement {
  const config = useMemo(() => getImportConfig(moduleKey), [moduleKey]);
  const router = useRouter();
  const { refreshDeals, refreshContacts, refreshOrganizations } = useData();
  const canCreate = useHasPermission(config.permission as PermissionKey);
  const [activeView, setActiveView] = useState<PageView>('wizard');

  const [step, setStep] = useState<WizardStep>(1);
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>(() => createEmptyMappings(config));
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [serverRows, setServerRows] = useState<ImportReviewRow[] | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canResume, setCanResume] = useState(false);
  const busyRef = useRef(false);
  const readVersion = useRef(0);
  const submission = useRef<CreateCrmImportInput | null>(null);
  const idempotencyKey = useRef('');
  const uploadedSource = useRef<{ text: string; uploadId: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allFields = useMemo(() => [...config.requiredFields, ...config.optionalFields], [config]);

  // ── Derived State ──────────────────────────────────────────────────────

  const allRequiredMapped = useMemo(
    () => config.requiredFields.every((f) => mappings[f.key]?.csvColumnIndex != null),
    [config.requiredFields, mappings],
  );

  const unmappedColumns = useMemo(() => {
    const mappedIndices = new Set(
      Object.values(mappings)
        .map((m) => m.csvColumnIndex)
        .filter((i): i is number => i !== null),
    );
    return csvHeaders
      .map((name, index) => ({ name, index }))
      .filter((col) => !mappedIndices.has(col.index));
  }, [mappings, csvHeaders]);

  const mapRow = useCallback(
    (row: string[]): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const field of allFields) {
        const idx = mappings[field.key]?.csvColumnIndex;
        result[field.key] = idx !== null && idx !== undefined ? (row[idx] || '') : '';
      }
      return result;
    },
    [mappings, allFields],
  );

  const previewRows = useMemo(() => {
    return csvRows.slice(0, 10).map((row) => mapRow(row));
  }, [csvRows, mapRow]);

  const validatedRows = serverRows ?? [];

  const validCount = useMemo(() => validatedRows.filter((r) => r.isValid).length, [validatedRows]);
  const errorCount = useMemo(() => validatedRows.filter((r) => !r.isValid).length, [validatedRows]);

  const mappedRequiredCount = useMemo(
    () => config.requiredFields.filter((f) => mappings[f.key]?.csvColumnIndex != null).length,
    [config.requiredFields, mappings],
  );

  // ── Reset ──────────────────────────────────────────────────────────────

  const resetState = useCallback(() => {
    if (busyRef.current) return;
    readVersion.current++;
    submission.current = null;
    uploadedSource.current = null;
    idempotencyKey.current = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('importKey');
    window.history.replaceState(null, '', url);
    setCsvText(''); setServerRows(null); setIsParsing(false); setProgress(0); setCanResume(false);
    setStep(1);
    setFile(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setMappings(createEmptyMappings(config));
    setIsImporting(false);
    setImportResult(null);
    setIsDragging(false);
  }, [config]);

  // ── File Processing ────────────────────────────────────────────────────

  const processFile = useCallback(
    (selectedFile: File) => {
      if (busyRef.current) return;
      const version = ++readVersion.current;
      setIsParsing(false);
      if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
        toast.error('Please upload a CSV file.');
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) {
        toast.error('File size exceeds 10MB limit.');
        return;
      }
      const reader = new FileReader();
      setIsParsing(true);
      reader.onload = (e) => {
        if (version !== readVersion.current) return;
        setIsParsing(false);
        const text = e.target?.result as string;
        if (!text || text.trim().length === 0) { toast.error('The uploaded CSV file does not contain any data.'); return; }
        let parsed;
        try { parsed = parseCsv(text); } catch (error) { toast.error(error instanceof Error ? error.message : 'Malformed CSV.'); return; }
        const { headers, rows } = parsed;
        if (rows.length > 5000) { toast.error('Maximum 5000 rows per import.'); return; }
        if (headers.length === 0) { toast.error("We couldn't read this CSV file. Please check its formatting."); return; }
        if (rows.length === 0) { toast.error('The uploaded CSV file does not contain any data rows.'); return; }
        setFile(selectedFile);
        setCsvText(text); setServerRows(null); submission.current = null;
        setCsvHeaders(headers);
        setCsvRows(rows);
        const columns: CsvColumn[] = headers.map((name, index) => ({ index, name }));
        setMappings(autoMapColumns(config, columns));
        setStep(2);
      };
      reader.onerror = () => { if (version !== readVersion.current) return; setIsParsing(false); toast.error("We couldn't read this CSV file."); };
      reader.readAsText(selectedFile);
    },
    [config],
  );

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) processFile(selectedFile);
    if (e.target) e.target.value = '';
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) processFile(droppedFile);
  }, [processFile]);

  const handleMappingChange = useCallback((fieldKey: string, value: string) => {
    if (busyRef.current) return;
    setServerRows(null); submission.current = null;
    setMappings((prev) => {
      const updated = { ...prev };
      if (value === '') {
        updated[fieldKey] = { csvColumnIndex: null, csvColumnName: null };
      } else {
        const colIndex = Number(value);
        for (const key of Object.keys(updated)) {
          if (updated[key].csvColumnIndex === colIndex) {
            updated[key] = { csvColumnIndex: null, csvColumnName: null };
          }
        }
        updated[fieldKey] = { csvColumnIndex: colIndex, csvColumnName: csvHeaders[colIndex] };
      }
      return updated;
    });
  }, [csvHeaders]);

  const handleDownloadTemplate = useCallback(() => {
    const headers = allFields.map((f) => f.label);
    const csvContent = headers.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = config.templateFileName;
    link.click();
    URL.revokeObjectURL(url);
  }, [allFields, config.templateFileName]);

  const buildRequest = useCallback(async (): Promise<CreateCrmImportInput> => {
    if (!idempotencyKey.current) {
      const url = new URL(window.location.href);
      idempotencyKey.current = url.searchParams.get('importKey') || crypto.randomUUID();
      url.searchParams.set('importKey', idempotencyKey.current);
      window.history.replaceState(null, '', url);
    }
    let source: { csvText: string } | { uploadId: string } = { csvText };
    if (new TextEncoder().encode(JSON.stringify(csvText)).length > 512 * 1024) {
      if (uploadedSource.current?.text !== csvText) {
        const uploadId = crypto.randomUUID();
        // Do not split surrogate pairs: UTF-8 byte checks must describe the original file.
        const chunks: string[] = [];
        for (let start = 0; start < csvText.length;) {
          let end = Math.min(start + 65536, csvText.length);
          if (end < csvText.length && /[\uD800-\uDBFF]/.test(csvText[end - 1])) end--;
          chunks.push(csvText.slice(start, end)); start = end;
        }
        for (const [chunkIndex, content] of chunks.entries()) await apiClient.post(config.importApiPath + '/upload', { uploadId, chunkIndex, totalChunks: chunks.length, content });
        uploadedSource.current = { text: csvText, uploadId };
      }
      source = { uploadId: uploadedSource.current!.uploadId };
    }
    return { fileName: file!.name, ...source, idempotencyKey: idempotencyKey.current,
      mappings: Object.fromEntries(Object.entries(mappings).filter(([, m]) => m.csvColumnIndex !== null).map(([key, m]) => [key, m.csvColumnIndex!])) };
  }, [file, csvText, mappings, config.importApiPath]);

  const handleContinue = useCallback(async () => {
    if (busyRef.current) return;
    if (step === 1) { setStep(2); return; }
    busyRef.current = true; setIsValidating(true); setServerRows(null);
    try {
      const payload = await buildRequest();
      const reviewed: ImportReviewRow[] = [];
      for (let offset = 0; offset < csvRows.length; offset += 25) {
        const response = await apiClient.post<{ data: ImportReviewRow[]; import?: ImportSummary }>(config.importApiPath + '/preview?offset=' + offset, payload);
        if (response.import) {
          if (response.import.completedAt) setImportResult(response.import);
          else setCanResume(true);
          break;
        }
        reviewed.push(...response.data);
      }
      setServerRows(reviewed); submission.current = payload; setStep(3);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Validation failed. Please retry.'); }
    finally { busyRef.current = false; setIsValidating(false); }
  }, [step, config.importApiPath, buildRequest, csvRows.length]);

  const handleImport = useCallback(async () => {
    if (!submission.current || busyRef.current) return;
    busyRef.current = true; setIsImporting(true);
    try {
      let result: ImportSummary;
      do {
        const response = await apiClient.post<{ data: ImportSummary }>(config.importApiPath, submission.current);
        result = response.data;
        setProgress(result.successfulRecords + result.failedRecords + (result.duplicateRecords ?? 0));
      } while (result.status === 'importing');
      setImportResult(result);
      if (moduleKey === 'deals' || moduleKey === 'leads') await refreshDeals();
      if (moduleKey === 'accounts') await refreshOrganizations();
      else if (moduleKey !== 'deals') await refreshContacts();
      toast.success('Import completed — ' + result.successfulRecords + ' records imported.');
    } catch (err) {
      toast.error((err instanceof Error ? err.message : 'Import interrupted') + ' Retry to resume the same import safely.');
    } finally { busyRef.current = false; setIsImporting(false); }
  }, [config.importApiPath, moduleKey, refreshDeals, refreshContacts, refreshOrganizations]);

  const firstUnmappedRequired = useMemo(
    () => config.requiredFields.find((f) => mappings[f.key]?.csvColumnIndex === null),
    [config.requiredFields, mappings],
  );

  // ── RBAC Guard ─────────────────────────────────────────────────────────

  if (!canCreate) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-5">
          <AlertCircle size={28} className="text-red-500" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Access Denied</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-sm">
          You don&apos;t have permission to import {config.moduleLabel.toLowerCase()}.
        </p>
        <button onClick={() => router.push(config.backRoute)} className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors cursor-pointer">
          <ArrowLeft size={14} /> Back to {config.moduleLabel}
        </button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 max-w-full">
      {/* ── Full-page scrollable container ─────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-0 sm:px-4 py-3 sm:py-6 space-y-5">

          {/* ── Header Card ───────────────────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-5">
            <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
              <div>
                <RecordBackButton label={config.moduleLabel} onClick={() => router.push(config.backRoute)} />
                <h1 className="text-[22px] font-bold text-slate-900 dark:text-white leading-tight">Import {config.moduleLabel}</h1>
                <p className="text-[13.5px] text-slate-500 dark:text-slate-400 mt-1">
                  {activeView === 'wizard' ? 'Upload your CSV, map your columns, and review your data before importing.' : `View your past ${config.moduleLabel.toLowerCase()} imports and their results.`}
                </p>
              </div>
              {/* View Toggle */}
              <div className="flex max-w-full items-center border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <button disabled={isImporting || isValidating} onClick={() => { resetState(); setActiveView('wizard'); }} className={cn('inline-flex items-center gap-1.5 px-2 sm:px-3.5 py-2 text-[12.5px] font-medium transition-colors cursor-pointer', activeView === 'wizard' ? 'bg-blue-50 dark:bg-primary/10 text-blue-700 dark:text-primary' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800')} aria-pressed={activeView === 'wizard'}>
                  <Upload size={13} /> New import
                </button>
                <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
                <button disabled={isImporting || isValidating} onClick={() => setActiveView('history')} className={cn('inline-flex items-center gap-1.5 px-2 sm:px-3.5 py-2 text-[12.5px] font-medium transition-colors cursor-pointer', activeView === 'history' ? 'bg-blue-50 dark:bg-primary/10 text-blue-700 dark:text-primary' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800')} aria-pressed={activeView === 'history'}>
                  <Clock size={13} /> History
                </button>
              </div>
            </div>
          </div>

          {activeView === 'history' ? (
            <ImportHistoryList moduleKey={moduleKey} onStartNew={() => { resetState(); setActiveView('wizard'); }} />
          ) : importResult ? (
            <ImportResultView config={config} result={importResult} onViewDetails={() => router.push(config.detailsRoute(importResult.id))} onStartNew={resetState} />
          ) : (
            <>
              {/* ── Step Indicator Card ─────────────────────────────── */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-4">
                <StepIndicator currentStep={step} hasErrors={step === 3 && errorCount > 0} fileName={file?.name} mappedCount={mappedRequiredCount} totalRequired={config.requiredFields.length} />
              </div>

              {/* ── Step Content Card ──────────────────────────────── */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-6">
                {moduleKey !== 'deals' && <p className="mb-4 text-sm text-slate-500">Use existing Product names separated by semicolons, for example: CCTV Surveillance System; Biometrics. Imports create new records only; existing customers are reported as duplicates.</p>}
                {isParsing && <p role="status" className="mb-4 text-sm text-slate-500">Reading CSV…</p>}
                {moduleKey === 'deals' && <p className="mb-4 text-sm text-slate-500">Each row creates one Deal for one active Product. Deal Value comes from Settings &gt; Products. Use pipeline and stage names or IDs. Accounts accept names or IDs; customers and assigned agents accept email addresses or IDs. Dates use YYYY-MM-DD. Relationships must already exist in this workspace.</p>}
                {step === 1 && <Step1Upload config={config} file={file} recordCount={csvRows.length} isDragging={isDragging} fileInputRef={fileInputRef} onFileChange={handleFileChange} onDrop={handleDrop} onDragEnter={() => setIsDragging(true)} onDragLeave={() => setIsDragging(false)} onReplaceFile={() => fileInputRef.current?.click()} onDownloadTemplate={handleDownloadTemplate} />}
                {step === 2 && <Step2MapColumns config={config} csvHeaders={csvHeaders} mappings={mappings} unmappedColumns={unmappedColumns} allRequiredMapped={allRequiredMapped} previewRows={previewRows} firstUnmappedRequired={firstUnmappedRequired} onMappingChange={handleMappingChange} mappedRequiredCount={mappedRequiredCount} totalRecords={csvRows.length} />}
                {step === 3 && <Step3Review config={config} validatedRows={validatedRows} validCount={validCount} totalCount={csvRows.length} />}

                {/* ── Footer (inside content card) ──────────────────── */}
                <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  {step === 1 ? (
                    <button onClick={() => router.push(config.backRoute)} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer">Cancel</button>
                  ) : (
                    <button disabled={isImporting || isValidating} onClick={() => { setServerRows(null); setStep((s) => Math.max(1, s - 1) as WizardStep); }} className="inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                      <ArrowLeft size={14} /> Back
                    </button>
                  )}
                  {step < 3 ? (
                    <button onClick={handleContinue} disabled={isParsing || isValidating || (step === 1 && !(file && csvRows.length > 0)) || (step === 2 && !allRequiredMapped)} className={cn('inline-flex items-center gap-1.5 h-9 px-5 text-[13px] font-semibold rounded-lg transition-colors', ((step === 1 && file && csvRows.length > 0) || (step === 2 && allRequiredMapped)) ? 'text-white bg-primary hover:bg-primary/90 cursor-pointer' : 'text-slate-400 bg-slate-100 dark:bg-slate-800 dark:text-slate-500 cursor-not-allowed')}>
                      {isValidating ? <><Loader2 size={14} className="animate-spin" /> Validating…</> : <>Continue <ArrowRight size={14} /></>}
                    </button>
                  ) : (
                    <button onClick={handleImport} disabled={isImporting || (!canResume && validCount === 0)} className={cn('inline-flex items-center gap-2 h-10 px-6 text-[13px] font-semibold rounded-lg transition-colors', !isImporting ? 'text-white bg-primary hover:bg-primary/90 cursor-pointer' : 'text-white bg-primary cursor-not-allowed')}>
                      {isImporting ? <><Loader2 size={14} className="animate-spin" /> Importing {progress}/{csvRows.length}…</> : <><Sparkles size={14} /> {canResume ? 'Resume import' : 'Import ' + validCount + ' ' + config.moduleLabel.toLowerCase()}</>}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" aria-hidden="true" />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function StepIndicator({ currentStep, hasErrors, fileName, mappedCount, totalRequired }: { currentStep: WizardStep; hasErrors?: boolean; fileName?: string; mappedCount: number; totalRequired: number }): React.ReactElement {
  const steps = [
    { num: 1, label: 'Upload CSV', sub: fileName || 'Step 1 of 3', icon: Upload },
    { num: 2, label: 'Map Columns', sub: `${mappedCount}/${totalRequired} required mapped`, icon: Table2 },
    { num: 3, label: 'Review & Validate', sub: 'Final review', icon: ShieldCheck },
  ];

  return (
    <div className="flex min-w-0 items-center justify-between gap-1" role="navigation" aria-label="Import steps">
      {steps.map((s, i) => {
        const isCompleted = currentStep > s.num;
        const isActive = currentStep === s.num;
        const showError = isActive && s.num === 3 && hasErrors;
        const Icon = s.icon;

        return (
          <React.Fragment key={s.num}>
            <div className="flex min-w-0 items-center gap-2.5">
              <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all', isCompleted && 'bg-emerald-500 text-white', isActive && !showError && 'bg-primary text-white', isActive && showError && 'bg-amber-500 text-white', !isCompleted && !isActive && 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500')} aria-current={isActive ? 'step' : undefined} aria-label={s.label}>
                {isCompleted ? <CheckCircle2 size={18} /> : <Icon size={17} />}
              </div>
              <div className="hidden sm:block min-w-0 max-w-40 break-words">
                <p className={cn('text-[13px] font-semibold leading-tight', isActive ? 'text-slate-900 dark:text-white' : isCompleted ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500')}>{s.label}</p>
                <p className={cn('text-[11px] mt-0.5', isActive || isCompleted ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500')}>{isCompleted && s.num === 1 && fileName ? fileName : s.sub}</p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className={cn('flex-1 min-w-0 h-[2px] mx-1 sm:mx-3 rounded-full', isCompleted ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700')} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Step 1: Upload ───────────────────────────────────────────────────────────

function Step1Upload({ config, file, recordCount, isDragging, fileInputRef, onFileChange, onDrop, onDragEnter, onDragLeave, onReplaceFile, onDownloadTemplate }: { config: ImportModuleConfig; file: File | null; recordCount: number; isDragging: boolean; fileInputRef: React.RefObject<HTMLInputElement | null>; onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void; onDrop: (e: React.DragEvent) => void; onDragEnter: () => void; onDragLeave: () => void; onReplaceFile: () => void; onDownloadTemplate: () => void }): React.ReactElement {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">Upload your CSV</h3>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">Drop the file containing the {config.moduleLabel.toLowerCase()} you want to bring into LeadCRM.</p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop} onDragOver={(e) => e.preventDefault()} onDragEnter={onDragEnter} onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={cn('relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all', isDragging ? 'border-primary bg-blue-50/50 dark:bg-primary/5' : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-primary', file && 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-500/5')}
        style={{ backgroundImage: !file ? 'radial-gradient(circle, #e2e8f0 1px, transparent 1px)' : undefined, backgroundSize: !file ? '20px 20px' : undefined }}
        role="button" tabIndex={0} aria-label="Upload CSV file"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
      >
        {file ? (
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mb-3">
              <CheckCircle2 size={24} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-900 dark:text-white break-all">{file.name}</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">{recordCount.toLocaleString()} records detected</p>
            <button onClick={(e) => { e.stopPropagation(); onReplaceFile(); }} className="mt-3 text-[12px] font-medium text-primary dark:text-primary hover:text-blue-700 cursor-pointer">Replace file</button>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-primary/10 flex items-center justify-center mb-3">
              <Upload size={22} className="text-blue-500" />
            </div>
            <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">{isDragging ? 'Drop your CSV here' : 'Drag and drop your CSV here'}</p>
            <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-1">or</p>
            <button type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="mt-2.5 inline-flex items-center h-8 px-4 text-[12px] font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer">Browse files</button>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-3">CSV files only &middot; Max 10MB</p>
          </div>
        )}
      </div>

      {/* Template helper */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-xl px-5 py-3.5">
        <div>
          <p className="text-[13px] font-semibold text-slate-900 dark:text-white">Don&apos;t have a CSV template?</p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">Download our template to see every field LeadCRM expects.</p>
        </div>
        <button onClick={onDownloadTemplate} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary dark:text-primary hover:text-blue-700 dark:hover:text-blue-300 whitespace-nowrap cursor-pointer">
          <Download size={13} /> Download CSV template
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Map Columns ──────────────────────────────────────────────────────

function Step2MapColumns({ config, csvHeaders, mappings, unmappedColumns, allRequiredMapped, previewRows, firstUnmappedRequired, onMappingChange, mappedRequiredCount, totalRecords }: { config: ImportModuleConfig; csvHeaders: string[]; mappings: Record<string, ColumnMapping>; unmappedColumns: { name: string; index: number }[]; allRequiredMapped: boolean; previewRows: Record<string, string>[]; firstUnmappedRequired: FieldDefinition | undefined; onMappingChange: (fieldKey: string, value: string) => void; mappedRequiredCount: number; totalRecords: number }): React.ReactElement {
  const [showOptional, setShowOptional] = useState(true);
  const allFields = [...config.requiredFields, ...config.optionalFields];
  const mappedFields = allFields.filter((f) => mappings[f.key]?.csvColumnIndex != null);

  return (
    <div className="space-y-6 min-w-0">
      {/* Header with badge */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">Map your columns</h3>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">Match each LeadCRM field to the corresponding column in your CSV file.</p>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold border shrink-0', allRequiredMapped ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/50' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700/50')}>
          {allRequiredMapped ? <CircleCheck size={12} /> : <AlertCircle size={12} />}
          {mappedRequiredCount}/{config.requiredFields.length} required
        </span>
      </div>

      {/* Required Fields */}
      <div className="space-y-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Required Fields</p>
        <div className="space-y-2">
          {config.requiredFields.map((field) => (
            <FieldMappingRow key={field.key} field={field} mapping={mappings[field.key]} csvHeaders={csvHeaders} onMappingChange={onMappingChange} />
          ))}
        </div>
      </div>

      {/* Optional Fields */}
      {config.optionalFields.length > 0 && (
        <div className="space-y-3">
          <button onClick={() => setShowOptional(!showOptional)} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer" aria-expanded={showOptional}>
            Additional Fields ({config.optionalFields.length}) {showOptional ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showOptional && (
            <div className="space-y-2">
              {config.optionalFields.map((field) => (
                <FieldMappingRow key={field.key} field={field} mapping={mappings[field.key]} csvHeaders={csvHeaders} onMappingChange={onMappingChange} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add custom column (disabled) */}
      <button disabled className="inline-flex items-center gap-1.5 h-9 px-4 text-[12.5px] font-medium text-slate-400 dark:text-slate-500 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg cursor-not-allowed" title="Custom field creation coming soon">
        <Plus size={14} /> Add custom column
      </button>

      {/* Validation Message */}
      {!allRequiredMapped && firstUnmappedRequired && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-700/40" role="alert">
          <AlertCircle size={15} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-amber-700 dark:text-amber-400"><span className="font-semibold">{firstUnmappedRequired.label}</span> is required. Map a CSV column to continue.</p>
        </div>
      )}

      {/* Live Data Preview */}
      {previewRows.length > 0 && mappedFields.length > 0 && (
        <div className="space-y-2.5 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Uploaded Data Preview</p>
            <p className="text-[11.5px] text-blue-500 dark:text-primary">Showing first {previewRows.length} of {totalRecords} records</p>
          </div>
          <div className="max-w-full overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-slate-200 dark:border-slate-700">
                {mappedFields.map((f) => (<th key={f.key} className="px-3 py-2.5 text-left font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">{f.label}</th>))}
              </tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {previewRows.map((row, i) => (<tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  {mappedFields.map((f) => (<td key={f.key} className="px-3 py-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap truncate max-w-[180px]">{row[f.key] || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>))}
                </tr>))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field Mapping Row ────────────────────────────────────────────────────────

function FieldMappingRow({ field, mapping, csvHeaders, onMappingChange }: { field: FieldDefinition; mapping: ColumnMapping; csvHeaders: string[]; onMappingChange: (fieldKey: string, value: string) => void }): React.ReactElement {
  const isMapped = mapping?.csvColumnIndex != null;

  return (
    <div className={cn('flex flex-wrap sm:flex-nowrap items-center rounded-lg border transition-all', isMapped ? 'bg-emerald-50/50 dark:bg-emerald-500/[0.03] border-emerald-200 dark:border-emerald-700/50' : 'bg-white dark:bg-slate-800/30 border-slate-200 dark:border-slate-700/60')}>
      {/* Label area */}
      <div className={cn('shrink-0 w-full sm:w-48 px-3 py-3 border-b sm:border-b-0 sm:border-r', isMapped ? 'border-emerald-200 dark:border-emerald-700/50 bg-emerald-50/80 dark:bg-emerald-500/[0.05]' : 'border-slate-200 dark:border-slate-700/60')}>
        <span className="text-[13px] font-medium text-slate-900 dark:text-slate-200">{field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}</span>
      </div>
      {/* Select area */}
      <div className="flex-1 min-w-0 px-3 py-2">
        <select value={mapping?.csvColumnIndex != null ? String(mapping.csvColumnIndex) : ''} onChange={(e) => onMappingChange(field.key, e.target.value)} className="w-full h-8 px-2 text-[13px] bg-transparent border-0 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-0 cursor-pointer appearance-none" aria-label={`Map CSV column for ${field.label}`}>
          <option value="">{field.required ? '— Select CSV column —' : '— Don\u2019t import —'}</option>
          {csvHeaders.map((h, i) => (<option key={i} value={i}>{h}</option>))}
        </select>
      </div>
      {/* Status icon */}
      <div className="shrink-0 pr-3">
        {isMapped && <CircleCheck size={18} className="text-emerald-500" />}
      </div>
    </div>
  );
}

// ── Step 3: Review ───────────────────────────────────────────────────────────

function Step3Review({ config, validatedRows, validCount, totalCount }: { config: ImportModuleConfig; validatedRows: ImportReviewRow[]; validCount: number; totalCount: number }): React.ReactElement {
  const [filter, setFilter] = useState<'all' | 'valid' | 'invalid' | 'duplicate'>('all');
  const [reviewPage, setReviewPage] = useState(0);
  const allFields = [...config.requiredFields, ...config.optionalFields];
  const displayFields = allFields.filter((f, index) => index < 6 || f.key === 'productInterest');
  const invalidCount = validatedRows.filter(row => row.status === 'invalid').length;
  const duplicateCount = validatedRows.filter(row => row.status === 'duplicate').length;

  const displayedRows = useMemo(() => {
    const filtered = filter === 'all' ? validatedRows : validatedRows.filter((r) => r.status === filter);
    return filtered.slice(reviewPage * 50, (reviewPage + 1) * 50);
  }, [validatedRows, filter, reviewPage]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">Review & validate</h3>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">Invalid and duplicate rows are skipped. Products and relationships are checked again when importing.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 min-[375px]:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Total Records</p>
          <p className="text-[28px] font-bold text-slate-900 dark:text-white leading-none tabular-nums">{totalCount}</p>
        </div>
        <div className="border border-emerald-200 dark:border-emerald-700/50 bg-emerald-50/50 dark:bg-emerald-500/5 rounded-xl p-4">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">Valid Records</p>
          <p className="text-[28px] font-bold text-emerald-600 dark:text-emerald-400 leading-none tabular-nums">{validCount}</p>
        </div>
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Invalid Records</p>
          <p className="text-[28px] font-bold leading-none tabular-nums text-red-600 dark:text-red-400">{invalidCount}</p>
        </div>
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Duplicate Records</p>
          <p className="text-[28px] font-bold leading-none tabular-nums text-amber-600 dark:text-amber-400">{duplicateCount}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1">
        {(['all', 'valid', 'invalid', 'duplicate'] as const).map((tab) => (
          <button key={tab} onClick={() => { setFilter(tab); setReviewPage(0); }} className={cn('px-3 py-1.5 text-[12px] font-medium rounded-md border transition-colors cursor-pointer', filter === tab ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}>
            {tab === 'all' ? `All (${totalCount})` : tab === 'valid' ? `Valid (${validCount})` : tab === 'duplicate' ? 'Duplicates (' + validatedRows.filter(r => r.status === 'duplicate').length + ')' : 'Invalid (' + validatedRows.filter(r => r.status === 'invalid').length + ')'}
          </button>
        ))}
      </div>

      {/* Review Table */}
      <div className="max-w-full overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
            <th className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400 w-12">Row</th>
            {displayFields.map((f) => (<th key={f.key} className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{f.label}</th>))}
            <th className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400 w-20">Status</th>
            <th className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-400">Remarks</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {displayedRows.map((row) => (
              <tr key={row.rowNumber} className={cn('transition-colors', !row.isValid ? 'bg-red-50/30 dark:bg-red-500/[0.02]' : 'hover:bg-slate-50 dark:hover:bg-slate-800/30')}>
                <td className="px-3 py-2.5 text-slate-400 dark:text-slate-500 font-mono text-[11px]">{row.rowNumber}</td>
                {displayFields.map((f) => (<td key={f.key} className="px-3 py-2.5 text-slate-700 dark:text-slate-300 truncate max-w-[140px]">{row.data[f.key] || '—'}</td>))}
                <td className="px-3 py-2.5">
                  {row.isValid
                    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"><CircleCheck size={11} /> Valid</span>
                    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400"><CircleX size={11} /> {row.status === 'duplicate' ? 'Duplicate' : 'Invalid'}</span>}
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-500 dark:text-slate-400">{row.isValid ? (row.resolvedValue === undefined ? 'Ready to import' : 'Product value: ' + new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(row.resolvedValue)) : row.errors.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {validatedRows.length > 50 && <div className="flex flex-wrap gap-3 items-center text-xs">
        <button className="border rounded px-3 py-2 disabled:opacity-40" disabled={reviewPage === 0} onClick={() => setReviewPage(p => p - 1)}>Previous rows</button>
        <span>Page {reviewPage + 1}</span>
        <button className="border rounded px-3 py-2 disabled:opacity-40" disabled={(reviewPage + 1) * 50 >= (filter === 'all' ? validatedRows : validatedRows.filter(r => r.status === filter)).length} onClick={() => setReviewPage(p => p + 1)}>Next rows</button>
      </div>}
    </div>
  );
}

// ── Import Result ────────────────────────────────────────────────────────────

function ImportResultView({ config, result, onViewDetails, onStartNew }: { config: ImportModuleConfig; result: ImportSummary; onViewDetails: () => void; onStartNew: () => void }): React.ReactElement {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-2xl min-w-0 px-3 sm:px-6 py-6 space-y-5">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle2 size={28} className="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h3 className="text-[17px] font-bold text-slate-900 dark:text-white">{result.successfulRecords ? 'Import Complete' : 'No records imported'}</h3>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">{result.successfulRecords} {config.moduleLabel.toLowerCase()} imported successfully.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3"><p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Total</p><p className="text-[16px] font-bold text-slate-900 dark:text-white">{result.totalRecords}</p></div>
        <div className="border border-emerald-200 dark:border-emerald-700/50 bg-emerald-50/50 dark:bg-emerald-500/5 rounded-lg p-3"><p className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400 mb-1">Imported</p><p className="text-[16px] font-bold text-emerald-600 dark:text-emerald-400">{result.successfulRecords}</p></div>
        {(result.duplicateRecords ?? 0) > 0 && <p className="text-sm text-amber-600">{result.duplicateRecords} duplicates skipped</p>}
        {result.failedRecords > 0 && <div className="border border-red-200 dark:border-red-700/50 bg-red-50/50 dark:bg-red-500/5 rounded-lg p-3"><p className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400 mb-1">Failed</p><p className="text-[16px] font-bold text-red-600 dark:text-red-400">{result.failedRecords}</p></div>}
      </div>
      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
        <button onClick={onViewDetails} className="inline-flex items-center gap-2 h-9 px-5 text-[13px] font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors cursor-pointer">View Details <ArrowRight size={14} /></button>
        <button onClick={onStartNew} className="text-[13px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer">Start new import</button>
      </div>
    </div>
  );
}
