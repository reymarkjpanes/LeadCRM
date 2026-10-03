# Single CRM workspace

LeadCRM now uses one operational dataset: the former Live data (stored as PRODUCTION before migration). There is no selector, preference, request header, or environment-switch endpoint.

The backend retains tenant isolation, RBAC, session validation, and workspace readiness. Request and background-job context contains only tenantId. Database tenant immutability, child-parent guards, and composite tenant foreign keys remain enforced.

See [implementation and verification report](environment-removal-report.md) for exact schema changes, data preservation, test results, and deployment requirements.

Historical applied migrations still describe Sandbox and Live because they must remain unchanged. The legacy TenantStatus.SANDBOX subscription/account status and deployment email recipient allowlist are separate concerns and remain intact. NODE_ENV and deployment configuration are unchanged.
