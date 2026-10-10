# LeadCRM roles

Client Admin is the predefined tenant administrator. A valid @camxian.com email is required. The flow is sign in, required password change, required LeadCRM onboarding, then dashboard. Subscription payments never assign administrator permissions.

Client Admin creates custom roles with per-module permissions and explicitly selects one when creating users. No generic User role is automatically assigned. Existing User definitions are retained as editable custom roles. User.role is the primary identity for routing; UserRole links users to RoleDefinition and RolePermission for permissions. Primary assignments and role renames synchronize these representations transactionally.

Retired Guest identities cannot authenticate. Their archived records are retained only for audit and administrator-directed reassignment. See [migration](plans/final-role-model.md) and [authentication](authentication.md).
