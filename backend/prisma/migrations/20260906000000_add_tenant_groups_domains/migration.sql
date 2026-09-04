-- Migration: add_tenant_groups_domains
-- Adds TenantGroup, TenantGroupMember, TenantDomain, TenantDomainSettings models
-- These replace the localStorage-only Groups/Domains in team-management.tsx

-- ─────────────────────────────────────────────────────────────────────────────
-- TenantGroup
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "TenantGroup" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TenantGroup_tenantId_idx" ON "TenantGroup"("tenantId");

ALTER TABLE "TenantGroup"
    ADD CONSTRAINT "TenantGroup_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TenantGroupMember (junction: group ↔ user)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "TenantGroupMember" (
    "id"       TEXT NOT NULL,
    "groupId"  TEXT NOT NULL,
    "userId"   TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "TenantGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantGroupMember_groupId_userId_key" ON "TenantGroupMember"("groupId", "userId");
CREATE INDEX "TenantGroupMember_tenantId_idx"  ON "TenantGroupMember"("tenantId");
CREATE INDEX "TenantGroupMember_groupId_idx"   ON "TenantGroupMember"("groupId");
CREATE INDEX "TenantGroupMember_userId_idx"    ON "TenantGroupMember"("userId");

ALTER TABLE "TenantGroupMember"
    ADD CONSTRAINT "TenantGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "TenantGroup"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantGroupMember"
    ADD CONSTRAINT "TenantGroupMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantGroupMember"
    ADD CONSTRAINT "TenantGroupMember_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TenantDomain
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "TenantDomain" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "domain"     TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantDomain_tenantId_domain_key" ON "TenantDomain"("tenantId", "domain");
CREATE INDEX "TenantDomain_tenantId_idx" ON "TenantDomain"("tenantId");

ALTER TABLE "TenantDomain"
    ADD CONSTRAINT "TenantDomain_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- TenantDomainSettings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "TenantDomainSettings" (
    "id"                     TEXT NOT NULL,
    "tenantId"               TEXT NOT NULL,
    "restrictToEmailDomains" BOOLEAN NOT NULL DEFAULT false,
    "joinPolicy"             TEXT NOT NULL DEFAULT 'after_approval',
    "defaultRole"            TEXT NOT NULL DEFAULT 'Sales Rep',
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantDomainSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantDomainSettings_tenantId_key" ON "TenantDomainSettings"("tenantId");

ALTER TABLE "TenantDomainSettings"
    ADD CONSTRAINT "TenantDomainSettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
