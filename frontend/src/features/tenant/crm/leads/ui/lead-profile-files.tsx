'use client';
import { uuid } from '@/lib/utils';

import React, { useState } from 'react';
import { Upload, FileText, Download, Trash2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { usePagination } from '@/shared/hooks/use-pagination';
import { Pagination } from '@/shared/components/ui/pagination';

export interface Attachment {
  id: string;
  name: string;
  size: string;
  uploadedAt: string;
  uploadedBy: string;
}

interface Props {
  leadId: string;
  initialAttachments?: Attachment[];
  currentUser?: string;
}

export const ClientProfileFiles = ({ leadId, initialAttachments = [], currentUser = 'Client Admin' }: Props) => {
  const [attachments, setAttachments] = useState<Attachment[]>(() => {
    const saved = localStorage.getItem(`crm_attachments_${leadId}`);
    if (saved) return JSON.parse(saved);
    return initialAttachments.length > 0 ? initialAttachments : [
      { id: '1', name: 'Service_Agreement_v2.pdf', size: '1.4 MB', uploadedAt: 'Yesterday at 3:15 PM', uploadedBy: 'Admin' },
      { id: '2', name: 'Proposal_CCTV_TechFlow.pdf', size: '2.8 MB', uploadedAt: '2 days ago', uploadedBy: 'Admin' }
    ];
  });

  const [isDragOver, setIsDragOver] = useState(false);

  const saveAttachments = (items: Attachment[]) => {
    setAttachments(items);
    localStorage.setItem(`crm_attachments_${leadId}`, JSON.stringify(items));
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach(file => {
        const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
        const newFile: Attachment = {
          id: uuid(),
          name: file.name,
          size: `${sizeInMb} MB`,
          uploadedAt: new Date().toLocaleDateString('en-US', { hour: '2-digit', minute: '2-digit' }),
          uploadedBy: currentUser
        };
        const updated = [newFile, ...attachments];
        saveAttachments(updated);
        toast.success(`Success! Attached file '${file.name}'`);
      });
    }
  };

  const deleteAttachment = (id: string, name: string) => {
    const remaining = attachments.filter(a => a.id !== id);
    saveAttachments(remaining);
    toast.error(`Removed attachment '${name}'`);
  };

  const pagination = usePagination({
    totalItems: attachments.length,
    initialPageSize: 10,
    pageSizeOptions: [10, 25, 50],
  });
  const paginatedAttachments = pagination.paginateItems(attachments);

  return (
    <div className="space-y-4" id="client-profile-files">
      <div 
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (e.dataTransfer.files) {
            Array.from(e.dataTransfer.files).forEach(file => {
              const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
              const newFile: Attachment = {
                id: uuid(),
                name: file.name,
                size: `${sizeInMb} MB`,
                uploadedAt: 'Just now',
                uploadedBy: currentUser
              };
              saveAttachments([newFile, ...attachments]);
              toast.success(`Document '${file.name}' uploaded successfully.`);
            });
          }
        }}
        className={`border-2 border-dashed rounded-xl p-6 text-center select-none transition-colors duration-150 ${
          isDragOver 
            ? 'border-primary bg-primary/5'
            : 'border-slate-200 dark:border-white/[0.05] hover:bg-slate-50 dark:hover:bg-white/[0.01]'
        }`}
      >
        <div className="flex flex-col items-center justify-center">
          <Upload className="text-slate-500 mb-3" size={28} />
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Drag and drop documents</h4>
          <p className="text-xs text-slate-500 mt-1 mb-4">Support PDF, DOCX, ZIP, JPG up to 10MB</p>
          <label className="bg-white dark:bg-white/[0.05] hover:bg-gray-50 dark:hover:bg-white/[0.1] text-xs font-semibold px-4 py-2 hover:text-slate-900 border border-gray-200 dark:border-white/[0.1] rounded-lg cursor-pointer transition-all dark:text-slate-350">
            Choose Files
            <input type="file" multiple className="hidden" onChange={handleUpload} />
          </label>
        </div>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
        {paginatedAttachments.map(file => (
          <div key={file.id} className="flex items-center justify-between p-3.5 bg-white dark:bg-white/[0.02] border border-gray-150 dark:border-white/[0.04] rounded-xl text-xs hover:border-gray-250 dark:hover:border-white/10 transition-all">
            <div className="flex items-center gap-3 truncate min-w-0">
              <div className="p-2 bg-blue-50 dark:bg-primary/10 text-blue-500 rounded-lg shrink-0">
                <FileText size={16} />
              </div>
              <div className="truncate text-left">
                <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">{file.name}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{file.size} • Uploaded by {file.uploadedBy} on {file.uploadedAt}</div>
              </div>
            </div>
            
            <div className="flex items-center gap-1 shrink-0 ml-4">
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); toast.success(`Simulated downloading document: ${file.name}`); }} 
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 rounded hover:bg-gray-100 dark:hover:bg-white/5 transition-all"
                title="Download Attachment"
              >
                <Download size={14} />
              </a>
              <button 
                type="button" 
                onClick={() => deleteAttachment(file.id, file.name)}
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded hover:bg-gray-100 dark:hover:bg-white/5 transition-all"
                title="Delete Attachment"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {attachments.length === 0 && (
          <div className="text-center py-8 text-slate-500 border border-dotted border-gray-200 dark:border-white/5 rounded-xl text-xs">
            No dynamic attachments added yet. Drag some files above.
          </div>
        )}
      </div>

      {attachments.length > 0 && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          pageSizeOptions={[10, 25, 50]}
          onPageChange={pagination.goToPage}
          onPageSizeChange={pagination.setPageSize}
        />
      )}
    </div>
  );
};
