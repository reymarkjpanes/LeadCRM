import { groupWhere } from '../../crm/access/record-visibility';
import type { Prisma } from '@prisma/client';
import { Role, type WorkflowAssignmentPurpose, type WorkflowAssignmentTarget, type WorkflowAssignmentPoolOption, type WorkflowEntity } from '@leadcrm/shared';
import { eligibleAssignedAgents, hasAssignedAgentAccess, crmAssignmentRequirements, TASK_ASSIGNEE_REQUIREMENTS } from '../../crm/access/assigned-agent-eligibility';
import { crmActor, crmOwnerCandidateIds, readWorkflowAssignmentWorkloads } from '../../crm/access/crm-record-access.service';

type Client = Prisma.TransactionClient;
export async function assignmentCandidates(client: Client, tenantId: string, purpose: WorkflowAssignmentPurpose, entity?: WorkflowEntity) {
  if (purpose === 'crm_owner' && entity === 'account') return [];
  if (purpose === 'crm_owner') {
    const modules = entity ? [entity === 'lead' ? 'leads' : entity === 'contact' ? 'contacts' : 'deals'] as const : ['leads', 'deals'] as const;
    const users = await eligibleAssignedAgents(client, tenantId, modules.flatMap(module => [...crmAssignmentRequirements(module)]));
    const scopes = await Promise.all(modules.map(module => crmOwnerCandidateIds(client, tenantId, module)));
    return users.filter(user => scopes.some(ids => ids === undefined || ids.includes(user.id)));
  }
  return eligibleAssignedAgents(client, tenantId, TASK_ASSIGNEE_REQUIREMENTS);
}

export async function assignmentPool(client: Client, tenantId: string, target: Extract<WorkflowAssignmentTarget, { type: 'role' | 'group' }>, purpose: WorkflowAssignmentPurpose = 'crm_owner') {
  if (target.type === 'role') {
    const role = await client.roleDefinition.findFirst({ where: { id: target.id, tenantId, isArchived: false },
      select: { name: true, userRoles: { where: { tenantId, user: { tenantId } }, select: { userId: true } } } });
    return role && role.name !== Role.CLIENT_ADMIN ? { name: role.name, memberIds: role.userRoles.map(member => member.userId) } : null;
  }
  const groupScope = purpose === 'crm_owner' && crmActor.getStore() ? await groupWhere(tenantId, client) : { tenantId };
  const group = await client.tenantGroup.findFirst({ where: { id: target.id, ...groupScope },
    select: { name: true, members: { where: { tenantId, user: { tenantId } }, select: { userId: true } } } });
  return group ? { name: group.name, memberIds: group.members.map(member => member.userId) } : null;
}

export async function assignmentOptions(client: Client, tenantId: string, access = { users: false, roles: false, groups: false }) {
  const ownerModules = ['leads', 'contacts', 'deals'] as const;
  const [eligiblePeople, ownerScopes, assignees, roles, groups] = await Promise.all([
    eligibleAssignedAgents(client, tenantId, []),
    Promise.all(ownerModules.map(module => crmOwnerCandidateIds(client, tenantId, module))),
    assignmentCandidates(client, tenantId, 'task_assignee'),
    access.roles ? client.roleDefinition.findMany({ where: { tenantId, isArchived: false }, orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, userRoles: { where: { tenantId, user: { tenantId } }, select: { userId: true } } } }) : [],
    access.groups ? client.tenantGroup.findMany({ where: await groupWhere(tenantId, client), orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, members: { where: { tenantId, user: { tenantId } }, select: { userId: true } } } }) : [],
  ]);
  const owners = eligiblePeople.filter(user => ownerModules.some((module, index) =>
    hasAssignedAgentAccess(user, tenantId, crmAssignmentRequirements(module)) && (ownerScopes[index] === undefined || ownerScopes[index]!.includes(user.id))));
  const ownerIds = new Set(owners.filter(user => user.role !== 'Client Admin').map(user => user.id));
  const taskIds = new Set(assignees.filter(user => user.role !== 'Client Admin').map(user => user.id));
  const peopleById = new Map([...owners, ...assignees].map(user => [user.id, user]));
  const option = (pool: { id: string; name: string }, members: Array<{ userId: string }>): WorkflowAssignmentPoolOption => ({
    ...pool, memberCount: members.length, eligibleMemberCounts: {
      crm_owner: members.filter(member => ownerIds.has(member.userId)).length,
      task_assignee: members.filter(member => taskIds.has(member.userId)).length,
    },
    members: members.flatMap(({ userId }) => {
      const user = peopleById.get(userId);
      const purposes: WorkflowAssignmentPurpose[] = [...(ownerIds.has(userId) ? ['crm_owner' as const] : []), ...(taskIds.has(userId) ? ['task_assignee' as const] : [])];
      return user && purposes.length ? [{ id: userId, name: `${user.firstName} ${user.lastName}`, purposes }] : [];
    }),
  });
  const people = (users: typeof owners) => users.map(user => ({ id: user.id, name: `${user.firstName} ${user.lastName}` }));
  return { users: access.users ? people(owners) : [], taskAssignees: access.users ? people(assignees) : [],
    roles: roles.filter(role => role.name !== Role.CLIENT_ADMIN).map(({ userRoles, ...role }) => option(role, userRoles)), groups: groups.map(({ members, ...group }) => option(group, members)) };
}

/** Match the record this action adds to an assignee's workload; completed/archived work is excluded. */
export async function assignmentWorkloads(client: Client, tenantId: string, ids: string[], purpose: WorkflowAssignmentPurpose, entity?: 'lead' | 'contact' | 'account' | 'deal', entityId?: string) {
  if (purpose === 'task_assignee') return readWorkflowAssignmentWorkloads(client, tenantId, ids, 'tasks');
  if (!entity || entity === 'account') return new Map<string, number>();
  return readWorkflowAssignmentWorkloads(client, tenantId, ids, entity === 'lead' ? 'leads' : entity === 'contact' ? 'contacts' : 'deals', entityId);
}

export function assignmentLeadScores(client: Client, tenantId: string, ids: string[], excludeId?: string) {
  return readWorkflowAssignmentWorkloads(client, tenantId, ids, 'leads', excludeId, true);
}
