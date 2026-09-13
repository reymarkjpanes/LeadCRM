'use client';

import React, { useState, useRef } from 'react';
import {
  Upload,
  FileText,
  Image,
  Download,
  Trash2,
  File as FileIcon,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import type { PermissionKey } from '@leadcrm/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FileRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  uploadedBy?: string;
  url?: string;
}

export interface RecordFilesTabProps {
  /** Existing files for this record */
  files: FileRecord[];
  /** Permission key for delete access */
  deletePermission?: PermissionKey;
  /** Callback when a file is uploaded */
  onUpload?: (file: File) => Promise<void>;
  /** Callback when a file is deleted */
  onDelete?: (fileId: string) => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1);
  return `${size} ${units[idx]}`;
}

function getFileIcon(mimeType: string): React.ComponentType<{ className?: string }> {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.includes('pdf')) return FileText;
  return FileIcon;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Upload Zone ─────────────────────────────────────────────────────────────

interface UploadZoneProps {
  onUpload?: (file: File) => Promise<void>;
}

function UploadZone({ onUpload }: UploadZoneProps): React.ReactElement {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File): Promise<void> => {
    if (!onUpload) {
      toast.info('File upload coming soon');
      return;
    }
    setIsUploading(true);
    try {
      await onUpload(file);
      toast.success(`${file.name} uploaded`);
    } catch {
      toast.error('Failed to upload file');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) handleFile(droppedFile);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFile(selectedFile);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        'border-2 border-dashed rounded-xl p-8 text-center transition-colors',
        isDragOver
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-muted-foreground/50',
        isUploading && 'opacity-50 pointer-events-none'
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleChange}
        className="hidden"
        aria-label="Upload file"
      />
      <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
      <p className="text-sm text-muted-foreground mb-1">
        {isUploading ? 'Uploading...' : 'Drag and drop a file here, or'}
      </p>
      {!isUploading && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Browse files
        </Button>
      )}
    </div>
  );
}

// ─── File Row ────────────────────────────────────────────────────────────────

interface FileRowProps {
  file: FileRecord;
  canDelete: boolean;
  onDelete?: (fileId: string) => Promise<void>;
}

function FileRow({ file, canDelete, onDelete }: FileRowProps): React.ReactElement {
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const Icon = getFileIcon(file.type);

  const handleDeleteClick = (): void => {
    if (!onDelete) return;
    setConfirmOpen(true);
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(file.id);
      toast.success('File deleted');
    } catch {
      toast.error('Failed to delete file');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className={cn(
        'flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors group',
        isDeleting && 'opacity-50 pointer-events-none',
      )}>
        {/* File icon */}
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Icon className="h-4.5 w-4.5 text-muted-foreground" />
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(file.size)} · {formatDate(file.uploadedAt)}
            {file.uploadedBy && ` · ${file.uploadedBy}`}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {file.url && (
            <a
              href={file.url}
              download={file.name}
              className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-accent transition-colors"
              aria-label={`Download ${file.name}`}
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
            </a>
          )}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={isDeleting}
              className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={`Delete ${file.name}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </button>
          )}
        </div>
      </div>

      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete File"
        description={`Delete "${file.name}"?`}
        warning="This file will be permanently removed."
        confirmLabel="Delete"
        variant="destructive"
        isLoading={isDeleting}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function RecordFilesTab({
  files,
  deletePermission,
  onUpload,
  onDelete,
}: RecordFilesTabProps): React.ReactElement {
  const canDelete = useHasPermission(deletePermission ?? 'contacts.delete' as PermissionKey);

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      {/* Upload zone */}
      <UploadZone onUpload={onUpload} />

      {/* File list */}
      {files.length > 0 ? (
        <div className="border border-border rounded-xl bg-card overflow-hidden divide-y divide-border/50">
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              canDelete={canDelete}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <FileIcon className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
        </div>
      )}
    </div>
  );
}
