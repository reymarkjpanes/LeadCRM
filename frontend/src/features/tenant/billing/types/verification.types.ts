export type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'REQUIRES_RESUBMISSION';
export type DocumentKey = 'businessRegistration' | 'birCertificate' | 'businessPermit' | 'proofOfAddress' | 'articlesOfIncorporation' | 'articlesOfPartnership' | 'industryPermit';
export type BusinessType = 'Sole Proprietorship' | 'Corporation' | 'Partnership' | 'Cooperative' | 'Other';
export interface BusinessDocumentRequirement { key: DocumentKey; name: string; description: string; required: boolean; applicableBusinessTypes: BusinessType[] | 'all'; }
export interface VerificationDocument { id: string; documentKey: DocumentKey; fileName: string; fileSize: number | null; mimeType: string | null; status: string; rejectionReason: string | null; uploadedAt: string; }
export interface TenantVerificationState { verificationStatus: VerificationStatus; businessType: BusinessType | null; verificationRejectionReason: string | null; documents: VerificationDocument[]; }
export type UploadStatus = 'idle' | 'uploading' | 'uploaded' | 'error';
export interface DocumentUploadState { file: File | null; uploadStatus: UploadStatus; errorMessage: string | null; uploadedDocument: VerificationDocument | null; }
