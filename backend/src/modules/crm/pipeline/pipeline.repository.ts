import { Prisma } from '@prisma/client';
import { SALES_PIPELINE_STAGES } from '@leadcrm/shared';
import { salesTransaction, crmScope } from '../leads/lead-automation.service';
import { ValidationError } from '../../../shared/errors/http-error';
import prisma from '../../../config/database.config';
import { CreatePipelineDto, UpdatePipelineDto, CreateStageDto, UpdateStageDto } from './pipeline.dto';

export async function findAllPipelines(tenantId: string) {
  return prisma.pipeline.findMany({
    where: { tenantId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    include: {
      stages: {
        orderBy: { order: 'asc' },
        include: { _count: { select: { deals: { where: { isArchived: false } } } } },
      },
    },
  });
}

export async function findPipelineById(id: string, tenantId: string) {
  return prisma.pipeline.findFirst({
    where: { id, tenantId, isArchived: false },
    include: {
      stages: {
        orderBy: { order: 'asc' },
        include: { _count: { select: { deals: { where: { isArchived: false } } } } },
      },
    },
  });
}

export async function createPipeline(tenantId: string, dto: CreatePipelineDto) {
  return prisma.pipeline.create({ data: { ...dto, tenantId } });
}

export async function updatePipeline(id: string, tenantId: string, dto: UpdatePipelineDto) {
  try {
    return await prisma.pipeline.update({ where: { id, tenantId }, data: dto });
  } catch {
    return null;
  }
}

export async function deletePipeline(id: string, tenantId: string) {
  const existing = await prisma.pipeline.findFirst({ where: { id, tenantId } });
  if (!existing) return null;

  const activeDeals = await prisma.deal.count({ where: { pipelineId: id, tenantId, isArchived: false } });
  if (activeDeals > 0) return { hasActiveDeals: true as const };

  await prisma.pipeline.update({ where: { id }, data: { isArchived: true } });
  return { deleted: true as const };
}

export async function createStage(tenantId: string, dto: CreateStageDto) {
  const pipeline = await prisma.pipeline.findFirst({ where: { id: dto.pipelineId, tenantId } });
  if (!pipeline) return null;
  // tenantId derived from the parent pipeline — never independently settable
  if (pipeline.name.trim().toLowerCase() === 'sales pipeline') throw new ValidationError('The Sales Pipeline uses its five official stages. Configure their colors instead of adding stages.');
  return prisma.stage.create({ data: { ...dto, tenantId } });
}

export async function updateStage(id: string, tenantId: string, dto: UpdateStageDto) {
  return salesTransaction(async tx => {
    const stage = await tx.stage.findFirst({ where: { id, tenantId } });
    if (!stage) return null;
    const pipeline = await tx.pipeline.findFirst({ where: { id: stage.pipelineId, tenantId } });
    if (pipeline?.name.trim().toLowerCase() === 'sales pipeline' &&
      (dto.name !== undefined && dto.name.trim().toLowerCase() !== stage.name.trim().toLowerCase() || dto.order !== undefined && dto.order !== stage.order ||
       dto.isWon !== undefined && dto.isWon !== stage.isWon || dto.isLost !== undefined && dto.isLost !== stage.isLost)) {
      throw new ValidationError('Keep the official Sales Pipeline stage names, order and terminal outcomes. Colors and other stage settings remain configurable.');
    }
    if (stage.isDefault && stage.name.toLowerCase() === 'lead' && (dto.name !== undefined && dto.name.toLowerCase() !== 'lead' || dto.isWon || dto.isLost)) {
      throw new ValidationError('Keep the starting Lead stage so new opportunities begin at Lead.');
    }
    const changesTerminalMeaning = dto.isWon !== undefined && dto.isWon !== stage.isWon || dto.isLost !== undefined && dto.isLost !== stage.isLost;
    if (changesTerminalMeaning && (await tx.deal.count({ where: { tenantId, stageId: id } }) || await tx.dealStageHistory.count({ where: { tenantId, OR: [{ previousStageId: id }, { newStageId: id }] } }))) {
      throw new ValidationError('A stage referenced by Deals or history cannot change its Won/Lost meaning. Confirm each Deal through its stage action.');
    }
    return tx.stage.update({ where: { id, tenantId }, data: dto });
  });
}

export async function deleteStage(id: string, tenantId: string) {
  try {
    return await salesTransaction(async tx => {
      const scope = crmScope(tenantId);
      const stage = await tx.stage.findFirst({ where: { id, ...scope } });
      if (!stage) return null;
      const pipeline = await tx.pipeline.findFirst({ where: { id: stage.pipelineId, ...scope } });
      if (pipeline?.name.trim().toLowerCase() === 'sales pipeline' && SALES_PIPELINE_STAGES.some(name => name.toLowerCase() === stage.name.trim().toLowerCase())) throw new ValidationError('The five official Sales Pipeline stages must be retained.');
      if (stage.isDefault || stage.isWon || stage.isLost) throw new ValidationError('The starting, Won, and Lost stages cannot be removed.');
      const deals = await tx.deal.count({ where: { stageId: id, ...scope } });
      const history = await tx.dealStageHistory.count({ where: { ...scope, OR: [{ previousStageId: id }, { newStageId: id }] } });
      if (deals || history) throw new ValidationError('This stage is referenced by Deals or stage history and cannot be removed. Move current Deals first; historical stages must be retained.');
      if (await tx.stage.count({ where: { pipelineId: stage.pipelineId, ...scope } }) <= 1) throw new ValidationError('A pipeline must retain at least one stage.');
      await tx.stage.delete({ where: { id, ...scope } });
      return { deleted: true as const };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new ValidationError('This stage is still referenced and cannot be removed.');
    throw error;
  }
}

export async function reorderStages(pipelineId: string, tenantId: string, stageIds: string[]) {
  const exists = await salesTransaction(async tx => {
    const scope = crmScope(tenantId);
    const pipeline = await tx.pipeline.findFirst({ where: { id: pipelineId, ...scope } });
    if (!pipeline) return false;
    const stages = await tx.stage.findMany({ where: { pipelineId, ...scope }, orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { id: true } });
    if (new Set(stageIds).size !== stageIds.length || stages.length !== stageIds.length || stages.some(stage => !stageIds.includes(stage.id))) throw new ValidationError('Reorder must include every stage of this pipeline exactly once.');
    if (pipeline.name.trim().toLowerCase() === 'sales pipeline' && stages.some((stage, index) => stage.id !== stageIds[index])) throw new ValidationError('Keep the official Sales Pipeline stage order.');
    for (const [index, id] of stageIds.entries()) await tx.stage.update({ where: { id, pipelineId, ...scope }, data: { order: index + 1 } });
    return true;
  });
  return exists ? findPipelineById(pipelineId, tenantId) : null;
}

export async function reorderDeals(pipelineId: string, tenantId: string, dealIds: string[]) {
  const pipeline = await prisma.pipeline.findFirst({ where: { id: pipelineId, tenantId } });
  if (!pipeline) return null;

  await prisma.$transaction(
    dealIds.map((dealId, index) =>
      // SEC: filter by both id and tenantId — prevents cross-tenant deal writes
      prisma.deal.update({ where: { id: dealId, tenantId }, data: { order: index } }),
    ),
  );

  return { reordered: dealIds.length };
}
