import prisma from '../../../config/database.config';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { CreateActivityDto, UpdateActivityDto } from './activities.dto';

export async function findAllActivities(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;

  const where: any = { tenantId };
  
  if (query.contactId) where.contactId = String(query.contactId);
  if (query.dealId) where.dealId = String(query.dealId);
  if (query.accountId) where.accountId = String(query.accountId);
  if (query.taskId) where.taskId = String(query.taskId);
  if (query.type) where.type = String(query.type);

  const [data, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.activity.count({ where }),
  ]);

  return { data, total, page, limit };
}

export async function findActivityById(id: string, tenantId: string) {
  return prisma.activity.findFirst({
    where: { id, tenantId },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
}

export async function createActivity(tenantId: string, createdById: string, dto: CreateActivityDto) {
  return prisma.activity.create({
    data: {
      ...dto,
      tenantId,
      createdById,
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
}

export async function updateActivity(id: string, tenantId: string, dto: UpdateActivityDto) {
  try {
    return await prisma.activity.update({
      where: { id, tenantId },
      data: dto,
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  } catch {
    return null;
  }
}

export async function deleteActivity(id: string, tenantId: string) {
  try {
    return await prisma.activity.delete({ where: { id, tenantId } });
  } catch {
    return null;
  }
}
