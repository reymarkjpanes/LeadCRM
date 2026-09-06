export type PlanType = 'STARTER' | 'PRO' | 'ENTERPRISE';
export type PaymentStatus = 'PAID' | 'PENDING' | 'FAILED' | 'REFUNDED';
export type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface Invoice {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  billingCycle: BillingCycle;
  dueDate: string;
  paidAt?: string;
  createdAt: string;
}

// ── Pricing Plans (System Admin) ──────────────────────────────────────────────

export interface PlanFeatureDto {
  id:      string;
  name:    string;
  enabled: boolean;
}

export interface PricingPlanDto {
  id:             string;
  name:           string;
  planType:       PlanType;
  monthlyPrice:   number;
  quarterlyPrice: number;
  annualPrice:    number;
  maxUsers:       number | null;
  storageLimit:   number | null;
  isActive:       boolean;
  features:       PlanFeatureDto[];
  paymentMethods: PlanPaymentMethod[];
}

// ── Payment Methods (per-plan configuration) ──────────────────────────────────

export interface PlanPaymentMethod {
  id:          string;  // e.g. 'card', 'gcash', 'apple_pay', 'google_pay', 'bank_transfer'
  name:        string;  // Display name
  description: string;  // Short description shown in the editor
  enabled:     boolean; // Whether this method is available for the plan
}

export interface UpdatePlanRequest {
  name?:           string;
  monthlyPrice?:   number;
  features?:       Array<{ name: string; enabled: boolean }>;
  paymentMethods?: Array<{ id: string; name: string; description: string; enabled: boolean }>;
}

// Default payment methods used when a plan has no saved configuration
export const DEFAULT_PAYMENT_METHODS: Omit<PlanPaymentMethod, 'enabled'>[] = [
  { id: 'card',          name: 'Credit / Debit Cards', description: 'Accept major credit and debit cards.' },
  { id: 'gcash',         name: 'GCash',                description: 'Allow customers to pay using GCash.' },
  { id: 'apple_pay',     name: 'Apple Pay',            description: 'Offer a seamless Apple Pay experience.' },
  { id: 'google_pay',    name: 'Google Pay',           description: 'Let customers pay with Google Pay.' },
  { id: 'bank_transfer', name: 'Bank Transfer',        description: 'Accept direct bank transfers.' },
];
