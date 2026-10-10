// ── Shared Import System Types ────────────────────────────────────────────────
// Defines the contract for module-specific import configurations.

/**
 * Supported field types for import validation.
 */
export type ImportFieldType = 'text' | 'email' | 'url' | 'phone' | 'select';

/**
 * Defines a single field that can be mapped during CSV import.
 */
export interface FieldDefinition {
  /** Internal key matching the API payload property name */
  key: string;
  /** Human-readable label shown in the mapping UI */
  label: string;
  /** Whether this field must be mapped and non-empty for a valid row */
  required: boolean;
  /** Field type — used for client-side validation */
  type: ImportFieldType;
  /** Allowed values for select-type fields */
  options?: string[];
  /** Lowercase patterns used for automatic column matching */
  autoMapPatterns: string[];
}

/**
 * Module-level import configuration. One config per CRM module (leads, accounts).
 */
export interface ImportModuleConfig {
  /** Unique module identifier */
  moduleKey: string;
  /** Plural display name: "Leads", "Accounts" */
  moduleLabel: string;
  /** Singular display name: "Lead", "Account" */
  moduleSingular: string;
  /** Navigation route back to the module list page */
  backRoute: string;
  /** Base API path for import endpoints: "/crm/leads/imports" */
  importApiPath: string;
  /** Generates the route to a specific import's detail page */
  detailsRoute: (importId: string) => string;
  /** Fields that MUST be mapped and non-empty */
  requiredFields: FieldDefinition[];
  /** Optional schema fields available for mapping */
  optionalFields: FieldDefinition[];
  /** Downloaded template file name */
  templateFileName: string;
  /** RBAC permission string required to access this import */
  permission: string;
  /** Field key used for duplicate detection on the backend (informational) */
  duplicateCheckField?: string;
}

// ── CSV / Mapping Types ──────────────────────────────────────────────────────

/**
 * Represents a detected CSV column header.
 */
export interface CsvColumn {
  index: number;
  name: string;
}

/**
 * Mapping from a CRM field to a specific CSV column.
 */
export interface ColumnMapping {
  csvColumnIndex: number | null;
  csvColumnName: string | null;
}

/**
 * Result of parsing a CSV file.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

// ── Validation Types ─────────────────────────────────────────────────────────

/**
 * A single validated row with field data and validation results.
 */
export interface ValidatedRow {
  rowNumber: number;
  data: Record<string, string>;
  isValid: boolean;
  errors: string[];
}

// ── Import Result Types ──────────────────────────────────────────────────────

/**
 * Summary returned after submitting an import to the backend.
 */
export interface ImportSummary {
  module: 'LEAD' | 'CONTACT' | 'ACCOUNT' | 'DEAL';
  idempotencyKey?: string | null;
  id: string;
  fileName: string;
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  duplicateRecords: number;
  status: 'pending' | 'importing' | 'completed' | 'completed_with_errors' | 'failed';
  createdAt: string;
  completedAt: string | null;
  createdBy?: { id: string; firstName: string; lastName: string };
}

/**
 * A single row result from an import operation.
 */
export interface ImportResultRow {
  id: string;
  importId: string;
  rowNumber: number;
  status: 'imported' | 'failed' | 'duplicate';
  importJobId: string;
  recordId: string | null;
  remarks: string | null;
  data: Record<string, string | null>;
  createdAt: string;
}

/**
 * Paginated API response shape.
 */
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
}
