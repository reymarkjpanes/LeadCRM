# LeadCRM workspace access

LeadCRM has one tenant-scoped CRM workspace. Frontend routes live in `frontend/app/(tenant)` and domain UI lives in `frontend/src/features/tenant`. Shared components remain in `frontend/src/shared`.

Client Admin manages the current workspace and its team. Staff access uses the workspace role and permission assignments. Backend authentication, tenant context, and permission middleware enforce the same tenant boundary.

See [authentication](authentication.md), [architecture](ARCHITECTURE.md), [roles](user-roles.md), and the [feature retirement report](retired-features-cleanup.md) for current behavior.
