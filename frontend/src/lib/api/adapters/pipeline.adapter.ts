'use client';

import { pipelineStageColor } from '@leadcrm/shared';

/**
 * Maps a backend stage response to the frontend Stage type.
 * Handles safe defaults for null or missing fields.
 * 
 * @param backendStage - The stage object returned from the backend API
 * @returns Formatted frontend Stage object
 */
export function toFrontendStage(backendStage: any): any {
  if (!backendStage) return null;
  
  return {
    id: backendStage.id || '',
    name: backendStage.name || 'Unnamed Stage',
    order: typeof backendStage.order === 'number' ? backendStage.order : 0,
    probability: typeof backendStage.probability === 'number' ? backendStage.probability : undefined,
    color: pipelineStageColor(backendStage),
    isWon: !!backendStage.isWon,
    isLost: !!backendStage.isLost,
    isDefault: !!backendStage.isDefault,
    requiredFields: Array.isArray(backendStage.requiredFields) ? backendStage.requiredFields : [],
    rottenAfterDays: typeof backendStage.rottenAfterDays === 'number' ? backendStage.rottenAfterDays : undefined,
  };
}

/**
 * Maps a backend pipeline response to the frontend Pipeline type structure.
 * Processes nested stages and supplies safe defaults.
 * 
 * @param backendPipeline - The pipeline object returned from the backend API
 * @returns Formatted frontend Pipeline object
 */
export function toFrontendPipeline(backendPipeline: any): any {
  if (!backendPipeline) return null;
  
  let stages: any[] = [];
  
  if (backendPipeline.stages && Array.isArray(backendPipeline.stages)) {
    stages = backendPipeline.stages.map(toFrontendStage);
    // Sort stages by order to ensure consistent UI display
    stages.sort((a, b) => a.order - b.order);
  }
  
  return {
    id: backendPipeline.id || '',
    tenantId: backendPipeline.tenantId || '',
    name: backendPipeline.name || 'Unnamed Pipeline',
    stages: stages,
    isArchived: !!backendPipeline.isArchived,
  };
}

export function toBackendCreatePipeline(frontendPipeline: any): any {
  return {
    name: frontendPipeline.name,
    // stages are NOT sent here — they're created individually via POST /stages
    // after the pipeline is created (Zod strips unknown fields from CreatePipelineSchema)
  };
}

export function toBackendUpdatePipeline(frontendPipeline: any): any {
  return {
    name: frontendPipeline.name,
    // stages are NOT sent here — they're managed individually via stage CRUD endpoints
  };
}
