'use client';

import { apiClient } from '@/lib/api/client';
import type {
  PricingPlanDto,
  UpdatePlanRequest,
  AttachStripePriceRequest,
  AttachStripePriceResult,
} from '@leadcrm/shared';

export const pricingApiService = {
  /** GET /admin/plans — returns all active pricing plans with features */
  getPlans: () =>
    apiClient.get<{ success: boolean; data: PricingPlanDto[] }>('/admin/plans'),

  /**
   * PUT /admin/plans/:id — update plan name, price, and/or feature list.
   * Features array is the full replacement list; disabled features are
   * stored with enabled:false so the UI can display them struck-through.
   */
  updatePlan: (planId: string, data: UpdatePlanRequest) =>
    apiClient.put<{ success: boolean; data: PricingPlanDto }>(`/admin/plans/${planId}`, data),

  /**
   * POST /admin/plans/:id/stripe-price — attach an EXISTING Stripe price
   * (created in the Stripe Dashboard) to a plan for a billing cycle.
   * The backend verifies the price against Stripe and derives the product id.
   */
  attachStripePrice: (planId: string, data: AttachStripePriceRequest) =>
    apiClient.post<{ success: boolean; data: AttachStripePriceResult }>(
      `/admin/plans/${planId}/stripe-price`,
      data,
    ),
};
