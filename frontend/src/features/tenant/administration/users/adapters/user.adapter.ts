import { User } from '@/store/types';

export interface UserDTO {
  assignableAgent?: boolean;
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  phone?: string | null;
  jobTitle?: string | null;
  groups?: { id: string; name: string }[];
  avatarUrl?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
  setupEmailSent?: boolean;
}

export interface CreateUserDTO {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  phone: string;
  jobTitle?: string;
  groupIds?: string[];
}

export interface UpdateUserDTO {
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: string;
  phone?: string;
  jobTitle?: string;
  groupIds?: string[];
}

export const userAdapter = {
  toModel: (dto: UserDTO): User => ({
    id: dto.id,
    assignableAgent: dto.assignableAgent,
    createdAt: dto.createdAt,
    isArchived: dto.status === 'INACTIVE',
    firstName: dto.firstName,
    lastName: dto.lastName,
    email: dto.email,
    role: dto.role,
    status: (dto.status.toLowerCase() as 'active' | 'inactive' | 'pending'),
    tenantId: dto.tenantId,
    phone: dto.phone || undefined,
    jobTitle: dto.jobTitle || undefined,
    groups: dto.groups ?? [],
    avatarUrl: dto.avatarUrl || undefined,
    lastLoginAt: dto.lastLoginAt || undefined,
  }),
  
  toModels: (dtos: UserDTO[]): User[] => dtos.map(userAdapter.toModel),
  
  toCreateDTO: (user: Partial<User>): CreateUserDTO => ({
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    email: user.email || '',
    role: user.role || '',
    phone: user.phone || '',
    jobTitle: user.jobTitle,
    groupIds: user.groupIds,
  }),
  
  toUpdateDTO: (user: Partial<User>): UpdateUserDTO => ({
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status?.toUpperCase(),
    phone: user.phone,
    jobTitle: user.jobTitle,
    groupIds: user.groupIds,
  }),
};
