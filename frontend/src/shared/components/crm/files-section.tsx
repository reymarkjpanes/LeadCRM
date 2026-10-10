'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Upload, File, Trash2, Download, FileUp } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/lib/utils';
import { ConfirmActionDialog } from './confirm-action-dialog';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export interface FileRecord {
  id: string;
  name: string;
  size: number;
  url: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface FilesSectionProps {
  files: FileRecord[];
  canUpload: boolean;
  canDelete: boolean;
  onUpload: (file: File) => Promise<void>;
  onDelete: (fileId: string) => void | Promise<void>;
  maxFileSize?: number; // bytes, default 10MB
  acceptedTypes?: string[]; // MIME types
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/* -------------------------------------------------------------------------- */
/*                              FilesSection                                   */
/* -------------------------------------------------------------------------- */

export function FilesSection({
  files,
  canUpload,
  canDelete,
  onUpload,
  onDelete,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  acceptedTypes,
}: FilesSectionProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const validateFile = useCallback(
    (file: File): string | null => {
      if (file.size > maxFileSize) {
        return `File exceeds maximum size of ${formatFileSize(maxFileSize)}`;
      }
      if (acceptedTypes && acceptedTypes.length > 0 && !acceptedTypes.includes(file.type)) {
        return `File type "${file.type || 'unknown'}" is not accepted`;
      }
      return null;
    },
    [maxFileSize, acceptedTypes]
  );

  const handleUpload = useCallback(
    async (file: File) => {
      const error = validateFile(file);
      if (error) {
        toast.error(error);
        return;
      }
      setUploading(true);
      try {
        await onUpload(file);
        toast.success(`Uploaded ${file.name}`);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      } finally {
        setUploading(false);
      }
    },
    [validateFile, onUpload]
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        handleUpload(file);
      }
      // Reset input so the same file can be uploaded again
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    },
    [handleUpload]
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      if (!canUpload) return;
      const file = event.dataTransfer.files?.[0];
      if (file) {
        handleUpload(file);
      }
    },
    [canUpload, handleUpload]
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      await onDelete(fileId);
      setDeleteConfirmId(null);
      toast.success('File deleted');
    },
    [onDelete]
  );

  const handleDownload = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  /* ─── Empty state with drag-drop zone ─── */
  if (files.length === 0) {
    return (
      <div
        onDragOver={canUpload ? handleDragOver : undefined}
        onDragLeave={canUpload ? handleDragLeave : undefined}
        onDrop={canUpload ? handleDrop : undefined}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 transition-colors',
          isDragging
            ? 'border-primary bg-primary/5 dark:bg-primary/10'
            : 'border-border bg-secondary/30 dark:bg-secondary/20',
          !canUpload && 'opacity-60'
        )}
      >
        <FileUp className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground text-center">
          {canUpload
            ? 'Drag & drop a file here, or click to upload'
            : 'No files attached'}
        </p>
        {canUpload && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'Uploading...' : 'Upload File'}
            </Button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={handleInputChange}
              accept={acceptedTypes?.join(',') ?? undefined}
            />
          </>
        )}
      </div>
    );
  }

  /* ─── File list ─── */
  return (
    <div
      onDragOver={canUpload ? handleDragOver : undefined}
      onDragLeave={canUpload ? handleDragLeave : undefined}
      onDrop={canUpload ? handleDrop : undefined}
      className={cn(
        'space-y-1 rounded-lg transition-colors',
        isDragging && 'ring-2 ring-primary/40 bg-primary/5 dark:bg-primary/10'
      )}
    >
      {/* Header with upload button */}
      {canUpload && (
        <div className="flex items-center justify-end pb-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="h-7 gap-1.5 text-xs"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleInputChange}
            accept={acceptedTypes?.join(',') ?? undefined}
          />
        </div>
      )}

      {/* File rows */}
      <div className="divide-y divide-border rounded-md border border-border dark:border-border">
        {files.map((file) => (
          <div
            key={file.id}
            className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/50 dark:hover:bg-secondary/30"
          >
            <File className="h-4 w-4 shrink-0 text-muted-foreground" />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {file.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.size)} · {file.uploadedBy} · {formatDate(file.uploadedAt)}
              </p>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => handleDownload(file.url)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </button>

              {canDelete && (
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(file.id)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Delete ${file.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <ConfirmActionDialog open={!!deleteConfirmId} onOpenChange={open => { if (!open) setDeleteConfirmId(null); }}
        title="Delete file?" description={`Delete “${files.find(file => file.id === deleteConfirmId)?.name ?? ''}”?`}
        variant="destructive" confirmLabel="Delete" confirmDisabled={!canDelete}
        onConfirm={async () => { if (deleteConfirmId) await handleDelete(deleteConfirmId); }} />
    </div>
  );
}
