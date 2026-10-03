import { salesPipeline, salesTransaction } from '../leads/lead-automation.service';
import * as repo from './pipeline.repository';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { CreatePipelineDto, UpdatePipelineDto, CreateStageDto, UpdateStageDto, ReorderStagesDto, ReorderDealsDto } from './pipeline.dto';

export async function getPipelines(tenantId: string) {
  await salesTransaction(tx => salesPipeline(tx, tenantId));
  return repo.findAllPipelines(tenantId);
}

export async function getPipelineById(id: string, tenantId: string) {
  const pipeline = await repo.findPipelineById(id, tenantId);
  if (!pipeline) throw new NotFoundError('Pipeline');
  return pipeline;
}

export async function createPipeline(tenantId: string, userId: string, dto: CreatePipelineDto) {
  const pipeline = await repo.createPipeline(tenantId, dto);
  await writeAuditLog({ tenantId, userId, action: 'pipeline.created', entityType: 'Pipeline', entityId: pipeline.id, after: { name: dto.name } });
  return pipeline;
}

export async function updatePipeline(id: string, tenantId: string, userId: string, dto: UpdatePipelineDto) {
  const pipeline = await repo.updatePipeline(id, tenantId, dto);
  if (!pipeline) throw new NotFoundError('Pipeline');
  await writeAuditLog({ tenantId, userId, action: 'pipeline.updated', entityType: 'Pipeline', entityId: id, after: dto as Record<string, unknown> });
  return pipeline;
}

export async function deletePipeline(id: string, tenantId: string, userId: string) {
  const result = await repo.deletePipeline(id, tenantId);
  if (!result) throw new NotFoundError('Pipeline');
  if ('hasActiveDeals' in result) {
    throw new ValidationError('Cannot delete a pipeline with active deals. Archive or move deals first.');
  }
  await writeAuditLog({ tenantId, userId, action: 'pipeline.deleted', entityType: 'Pipeline', entityId: id });
}

export async function archivePipeline(id: string, tenantId: string, userId: string) {
  const result = await repo.deletePipeline(id, tenantId);
  if (!result) throw new NotFoundError('Pipeline');
  if ('hasActiveDeals' in result) {
    throw new ValidationError('Cannot archive a pipeline with active deals. Move deals to another pipeline first.');
  }
  await writeAuditLog({ tenantId, userId, action: 'pipeline.archived', entityType: 'Pipeline', entityId: id });
}

export async function createStage(tenantId: string, userId: string, dto: CreateStageDto) {
  const stage = await repo.createStage(tenantId, dto);
  if (!stage) throw new NotFoundError('Pipeline');
  await writeAuditLog({ tenantId, userId, action: 'stage.created', entityType: 'Stage', entityId: stage.id, after: { name: dto.name, order: dto.order } });
  return stage;
}

export async function updateStage(id: string, tenantId: string, userId: string, dto: UpdateStageDto) {
  const stage = await repo.updateStage(id, tenantId, dto);
  if (!stage) throw new NotFoundError('Stage');
  await writeAuditLog({ tenantId, userId, action: 'stage.updated', entityType: 'Stage', entityId: id, after: dto as Record<string, unknown> });
  return stage;
}

export async function deleteStage(id: string, tenantId: string, userId: string) {
  const result = await repo.deleteStage(id, tenantId);
  if (!result) throw new NotFoundError('Stage');
  if ('hasActiveDeals' in result) {
    throw new ValidationError('Cannot delete a stage with active deals. Move deals to another stage first.');
  }
  await writeAuditLog({ tenantId, userId, action: 'stage.deleted', entityType: 'Stage', entityId: id });
}

export async function reorderStages(pipelineId: string, tenantId: string, userId: string, dto: ReorderStagesDto) {
  const pipeline = await repo.reorderStages(pipelineId, tenantId, dto.stageIds);
  if (!pipeline) throw new NotFoundError('Pipeline');
  await writeAuditLog({ tenantId, userId, action: 'stages.reordered', entityType: 'Pipeline', entityId: pipelineId, after: { stageIds: dto.stageIds } });
  return pipeline;
}

export async function reorderDeals(pipelineId: string, tenantId: string, userId: string, dto: ReorderDealsDto) {
  const result = await repo.reorderDeals(pipelineId, tenantId, dto.dealIds);
  if (!result) throw new NotFoundError('Pipeline');
  return result;
}
