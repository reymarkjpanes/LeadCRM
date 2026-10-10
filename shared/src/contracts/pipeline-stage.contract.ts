import { z } from 'zod';

export const StageColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a six-digit hexadecimal color, such as #64748B.');
export const SALES_PIPELINE_STAGES = ['Lead', 'Contacted', 'Qualified', 'Closed Won', 'Closed Lost'] as const;

/** Saved colors always take precedence. Defaults apply only to unconfigured stages. */
export function pipelineStageColor(stage: { name: string; color?: string | null }): string {
  if (stage.color) return stage.color;
  const defaults: Record<string, string> = { lead: '#64748B', contacted: '#3B82F6', qualified: '#8B5CF6', 'closed won': '#10B981', 'closed lost': '#EF4444' };
  return defaults[stage.name.trim().toLowerCase()] ?? '#64748B';
}
