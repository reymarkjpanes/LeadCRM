// Human-reviewed ownership/retention decisions used by the exhaustive inventory renderer.
// category, purpose, issue, action, risk
export const decisions = {
  Tenant:['A','Workspace identity and defaults','ownerUserId captures founding identity; five historical orphaned dummy references were removed by authorized cleanup','Keep tenant scoping and retained workspace identity; founding provenance is separate from current permissions','HIGH'],
  User:['D','Staff identity, credentials and primary routing role','role is a primary identity; UserRole grants permissions; not an interchangeable duplicate','Keep compatibility role; strengthen tenant keys; never infer primary role from arbitrary junction ordering','HIGH'],
  RoleDefinition:['D','Named tenant roles','Single-column child FKs do not enforce tenant equality','Keep; add tenant reference key for assignments and permissions','HIGH'],
  RolePermission:['D','One module permission vector per role','tenantId can disagree with role; redundant roleId index','Use composite role FK; retain action flags and module identity','HIGH'],
  UserRole:['B','Permission-bearing user role assignments','Tenant equality is enforced only in services','Use tenant-consistent composite FKs; retain API compound unique selector','HIGH'],
  Session:['D','Hashed revocable authentication sessions','Duplicate tokenHash index; user/tenant equality not constrained','Keep security state; composite user FK; remove exact redundant index','HIGH'],
  TenantGroup:['F','Named staff groups','Tenant-aware member relation missing','Keep; add tenant reference key','MEDIUM'],
  TenantGroupMember:['B','Group membership','Existing group/user uniqueness is correct; missing tenant FK enforcement','Keep pair uniqueness; composite member FKs','HIGH'],
  Account:['A','Customer organization','Names are not unique identities; historical text/products have compatibility meaning','Keep distinct from people; retain account-owned attributes','HIGH'],
  Lead:['A','Prospective person and retained conversion source','companyName may be unlinked intake text; contactId is conversion trace; products compatibility','Keep original row, conversion actor/time and account link; no email uniqueness without business rule','HIGH'],
  Contact:['A','Known customer person and lifecycle','owner and assignee have distinct provenance; company is free-text fallback; lifecycle differs from human status','Keep lifecycle and status; retain conversion trace and account relationship','HIGH'],
  Pipeline:['F','Tenant sales pipeline','Stage tenant depends on pipeline; currency is configurable pipeline default','Keep; enforce parent scope for stages','HIGH'],
  Stage:['F','Ordered pipeline stage and entry rules','Tenant/pipeline relationship and Deal pipeline-stage pair need database enforcement','Composite pipeline FK and Deal stage reference key; keep requiredFields configuration','HIGH'],
  Deal:['A','Opportunity with immutable commercial snapshot','Duplicate scalar people relationships retired after canonical release verification','Use ordered LeadDeal/ContactDeal as sole participant storage; derive singular API fields; atomic edits; keep value snapshot','HIGH'],
  LeadDeal:['B','Many-to-many opportunity lead participation','Missing tenant equality between both endpoints','Composite endpoint FKs; keep addedBy, role and addedAt provenance','HIGH'],
  ContactDeal:['B','Many-to-many opportunity contact participation','Missing tenant equality between both endpoints','Composite endpoint FKs; keep addedBy, role and addedAt provenance','HIGH'],
  DealStageHistory:['C','Immutable stage transition history','Hard-delete cascade removes history; archive does not','Keep; retain hard-delete behavior pending a separate retention policy; never fold into Deal','HIGH'],
  DealAction:['I','Legacy structured manual-deal action log','No runtime, route, worker, integration or frontend table consumer; current actions use Activity and DealStageHistory','Drop empty table and enum through guarded migration 84; existing deployed build has no consumer','MEDIUM'],
  Task:['A','Assigned scheduled work','Four scalar relationships duplicated ordered junctions; live-only organizationId unused','Use TaskLead/TaskContact/TaskDeal/TaskAccount exclusively; derive singular API fields; retire five obsolete columns','HIGH'],
  Activity:['C','CRM-visible timeline','Multiple contextual FKs are supported despite stale exactly-one comment; hard-delete cascades','Keep distinct from audit; correct comment; retain event metadata and archive history','HIGH'],
  Notification:['C','Recipient-specific inbox event and read state','Nullable eventKey allows non-idempotent ad hoc notices; recipient tenant should be enforced','Keep unique tenant/user/eventKey; composite recipient FK; do not replace with audit','HIGH'],
  ClosingFieldDefinition:['F','Tenant-defined closing field configuration','JSON definition is flexible schema; updatedAt SQL default missing in Prisma','Keep composite tenant/id identity and JSON; align Prisma with existing updatedAt default','MEDIUM'],
  TargetAudience:['F','Reusable dynamic audience query','Conditions correctly stored as independent ordered child rules','Keep normalized parent/child design','MEDIUM'],
  TargetAudienceCondition:['B','Ordered audience predicate','Nested parent reads/creates are active even with no direct delegate calls','Keep relational rows; values interpreted by validated operators','MEDIUM'],
  Campaign:['A','Outbound campaign definition and cached totals','Mutable totals derive from recipient state; concurrent updates serialized in send/webhook flow','Keep cache; preserve Report API and send reservations; scheduler starts at boot and pauses email sends; SMS dry-run path needs separate review','HIGH'],
  MarketingForm:['F','Draft and published form definition','Draft/published JSON are intentionally different versions','Keep definition and immutable published config snapshots','HIGH'],
  FormSubmission:['C','Individual idempotent published form submission','tenantId not tied to form by composite FK','Composite form FK; keep payload, publishedConfig, email/phone capture snapshots','HIGH'],
  CampaignMetrics:['H','Append-only campaign reporting snapshots','Shares counter names with Campaign but snapshotAt gives different meaning','Keep snapshots; never merge into current totals','HIGH'],
  CampaignContact:['C','Recipient identity, send state and captured personalization','Email/personalization preserve send-time facts; nullable lead/contact supports deletion','Keep separate from provider log; recipient/provider identity retained','HIGH'],
  Template:['F','Reusable email/SMS authoring template','Campaign inline content can deliberately override template','Keep; no campaign-body deduplication','MEDIUM'],
  Workflow:['F','Trigger/action configuration and current lifecycle','status and isActive are synchronized compatibility state','Keep JSON DSL and lifecycle guard; no enum tightening without accepted historical values','HIGH'],
  WorkflowTriggerRecord:['C','Idempotent observed workflow event','Workflow/tenant scope not enforced by FK','Composite workflow FK; keep event payload snapshot','HIGH'],
  WorkflowExecutionRun:['C','Execution attempt and summary','workflowId can disagree with trigger.workflowId','Composite trigger FK including workflowId and tenantId; keep indexed workflow projection','HIGH'],
  WorkflowExecutionStep:['C','Individual action execution result','Scope can disagree with run; repeated stepIndex semantics must be retained','Composite execution FK; retain independent output and errors','HIGH'],
  AuditLog:['C','Security and administration change history','Six historical actor tenant mismatches before cleanup; entity references are polymorphic history','Keep immutable changesets; do not rewrite historical tenant/actor identity or cascade away logs','HIGH'],
  EmailDeliveryLog:['E','Outbound provider submission and current delivery state','Duplicate gmailMessageId index; provider state also projected to recipients','Keep separate from inbox; remove exact redundant index','HIGH'],
  PasswordResetToken:['D','Active password recovery capability','Optional userId lacks FK; email is captured identity guard; token is currently plaintext','Keep active flow; token hashing and nullable-user compatibility need dedicated expand/switch rollout','HIGH'],
  EmailVerificationToken:['D','Retired signup verification capabilities','Public route retired; unused service unreachable; seven original dummy rows deleted with authorized cleanup','Drop empty table in migration 84 and remove unreachable service/test; password reset and OAuth remain separate active flows','HIGH'],
  EmailAccount:['E','Encrypted Gmail credentials and synchronization lease','System sender intentionally uses system/system without User/Tenant rows','Keep system sender exception; do not blindly add tenant/user FKs; separate system credentials in future expand phase','HIGH'],
  MailboxOAuthState:['D','Short-lived session-bound OAuth challenge','Hash/session/user references validated by OAuth flow, no DB FK','Keep isolated secrets and expiry index; do not combine with sessions or inbox','HIGH'],
  MailboxMessage:['E','Gmail ingestion and CRM engagement state','Account scope needs enforcement; nullable CRM context retained through conversion/history','Composite account FK; keep captured per-message context; normalize current thread association into its own table','HIGH'],
  MailboxThreadAssociation:['B','Current Deal association of a provider thread within one mailbox','Preference JSON previously stored a mutable relational Deal ID without FK','Replace mailbox-thread preference rows with account/thread primary key and tenant-safe account/Deal FKs','HIGH'],
  SMSQueue:['I','Legacy Android gateway delivery queue','No runtime/worker/webhook access; SMS uses external provider service','Drop empty table in guarded migration 84; provider adapter and campaign flow retained','MEDIUM'],
  EmailEvent:['C','Idempotent outbound provider event history','Shares event facts with delivery projection intentionally','Keep event identity key and history; separate from mailbox messages','HIGH'],
  AutomationRule:['I','Old automation definition mechanism','No current route/worker/frontend consumer; Workflow owns supported automation','Drop empty table in guarded migration 84; preserve Workflow and all execution history','MEDIUM'],
  UserPreference:['F','Per-user module display preferences','Flexible JSON is appropriate; tenant/user FK gap remains','Keep config; document keys with relational content separately','MEDIUM'],
  TenantPreference:['F','Workspace preferences and operational state','mailbox-thread JSON duplicated a queryable relationship; other values are configuration/cursors','Move mailbox mapping into MailboxThreadAssociation; remove compatibility rows after equivalence check; keep other preferences','MEDIUM'],
  CrmImportJob:['C','Shared module import job and accounting','Counters are transactionally finalized from row outcomes; upload reference may expire','Keep shared import architecture and idempotency identity','HIGH'],
  CrmImportRowResult:['C','Historical per-input-row outcome','recordId intentionally survives source record deletion; JSON holds input snapshot','Keep unique job/rowNumber and immutable input/result','HIGH'],
  CrmImportUpload:['G','Expiring raw import upload envelope','Owns source hash, expiry and chunk count before job creation','Keep shared staging; retain cleanup index','HIGH'],
  CrmImportChunk:['G','Ordered upload content slice','Parent owns module/scope/expiry; correct normalized dependency','Keep unique upload/chunkIndex and cascade source cleanup','MEDIUM'],
  CampaignEmailQuota:['H','Account-wide provider daily send reservation','Reservation is authoritative concurrency control, not report count','Keep daily key and atomic increments; do not derive from successful sends','HIGH'],
  TaskLead:['B','Ordered task-lead association','Already composite tenant-safe FKs and pair PK','Keep canonical multi-record associations','HIGH'],
  TaskContact:['B','Ordered task-contact association','Already composite tenant-safe FKs and pair PK','Keep canonical multi-record associations','HIGH'],
  TaskDeal:['B','Ordered task-deal association','Already composite tenant-safe FKs and pair PK','Keep canonical multi-record associations','HIGH'],
  TaskAccount:['B','Ordered task-account association','Already composite tenant-safe FKs and pair PK','Keep canonical multi-record associations','HIGH'],
  RecordFile:['A','Stored object metadata attached to CRM record','Composite record scope exists; uploadedBy scope and storage cleanup require separate lifecycle checks','Keep storage ownership and exactly-one-record SQL constraint; never merge with audit','HIGH'],
  ProductInterest:['A','Product catalog current defaults','Previously normalized; deal value is intentionally historical','Keep existing product behavior; outside this normalization change','HIGH'],
  LeadProductInterest:['B','Ordered lead product selections','Nested writes through productRelationData are active','Keep existing normalized junction','HIGH'],
  ContactProductInterest:['B','Contact product interest and ownership flags','Flags describe same pair, not duplicate products','Keep existing normalized junction','HIGH'],
  AccountProductInterest:['B','Account product interest and ownership flags','Flags describe same pair, not duplicate products','Keep existing normalized junction','HIGH'],
};

export function jsonDecision(model,field) {
  if(model==='TenantPreference') return ['KEEP JSON','Configuration and cursors remain JSON. mailbox-thread mapping is NORMALIZED into MailboxThreadAssociation in migrations 85/86.'];
  if(['DealAction','Activity','AuditLog','WorkflowTriggerRecord','WorkflowExecutionStep','CrmImportRowResult','FormSubmission','CampaignContact'].includes(model)) return ['KEEP','Historical event, execution result, input or send-time snapshot; independent records already have rows.'];
  if(model==='Deal') return ['KEEP',field==='closingSnapshot'?'Immutable closing evidence snapshot.':'Values for tenant-defined closing fields; definitions are relational, values are dynamic.'];
  if(model==='MarketingForm') return ['KEEP',field==='publishedConfig'?'Published definition snapshot differs intentionally from editable draft.':'Typed flexible builder configuration; individual submissions use FormSubmission.'];
  if(['Workflow','AutomationRule'].includes(model)) return ['KEEP','Validated condition/action DSL; referenced CRM IDs are validated by runtime. Definition versioning/relational targets require separate design.'];
  return ['KEEP','Flexible preference or field definition; no independent record identity demonstrated.'];
}
export function arrayDecision(model,field) {
  if(/product/i.test(field)) return ['HIDDEN RELATIONSHIP — NORMALIZED','Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly.'];
  if(field==='requiredFields') return ['KEEP','Ordered names of validation fields, not database entity IDs.'];
  if(field==='scopes') return ['KEEP','Provider-defined OAuth permission tokens.'];
  if(field==='recipients') return ['KEEP','Captured email addresses for one provider message, not CRM person IDs.'];
  if(field==='labels') return ['KEEP','Provider-defined message labels.'];
  return ['KEEP','Simple tag values; no independently managed tag entity or FK identity.'];
}

export const dropped = new Set(['DealAction','AutomationRule','SMSQueue','EmailVerificationToken']);
export const normalized = new Set(['User','RoleDefinition','RolePermission','UserRole','Session','TenantGroup','TenantGroupMember','Pipeline','Stage','Deal','LeadDeal','ContactDeal','Task','Notification','ClosingFieldDefinition','FormSubmission','Workflow','WorkflowTriggerRecord','WorkflowExecutionRun','WorkflowExecutionStep','EmailAccount','MailboxMessage','EmailDeliveryLog','TenantPreference','CampaignContact']);
export const finalAction = name => dropped.has(name) ? 'DROP' : name === 'MailboxThreadAssociation' ? 'REPLACE' : normalized.has(name) ? 'NORMALIZE' : 'KEEP';
