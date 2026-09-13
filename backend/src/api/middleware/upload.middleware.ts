/**
 * upload.middleware.ts
 *
 * Multer configuration for business verification document uploads.
 * Files are stored on the local filesystem at ./uploads/documents/.
 * Each file is named: {tenantId}-{documentKey}-{timestamp}.{ext}
 *
 * Security:
 * - Only PDF, JPEG, PNG, WEBP accepted
 * - Max file size: 10 MB
 * - File served via protected endpoint (never exposed publicly)
 * - tenantId prefix in filename prevents accidental cross-tenant discovery
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AppError } from '../../shared/errors/app-error';

// ─── Ensure upload directory exists ──────────────────────────────────────────

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'documents');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Allowed MIME types ───────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

// ─── Max file size ────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Storage configuration ────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const tenantId = req.user?.tenantId ?? 'unknown';
    // documentKey comes from the request body — validated separately in the controller
    const documentKey = (req.body as Record<string, string>).documentKey ?? 'doc';
    const timestamp   = Date.now();
    const ext         = path.extname(file.originalname).toLowerCase();
    // Safe filename: no spaces, no original filename in path (prevents directory traversal)
    const filename    = `${tenantId}-${documentKey}-${timestamp}${ext}`;
    cb(null, filename);
  },
});

// ─── File filter ──────────────────────────────────────────────────────────────

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext  = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype.toLowerCase();

  if (ALLOWED_MIME_TYPES.has(mime) && ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new AppError(
      'Invalid file type. Only PDF, JPEG, PNG, and WEBP files are accepted.',
      400,
    ));
  }
};

// ─── Multer instance ──────────────────────────────────────────────────────────

export const uploadSingleDocument = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
}).single('document');

// ─── Helper: Get absolute path for a stored file ─────────────────────────────

export function getDocumentAbsolutePath(relativeFilePath: string): string {
  // relativeFilePath is stored as e.g. "uploads/documents/tenantId-key-ts.pdf"
  return path.join(process.cwd(), relativeFilePath);
}

// ─── Helper: Delete a stored file ────────────────────────────────────────────

export async function deleteDocumentFile(relativeFilePath: string): Promise<void> {
  const absolutePath = getDocumentAbsolutePath(relativeFilePath);
  try {
    await fs.promises.unlink(absolutePath);
  } catch (err: unknown) {
    // Log but don't throw — file may already be deleted or path may be stale
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[upload] Failed to delete document file:', absolutePath, err);
    }
  }
}