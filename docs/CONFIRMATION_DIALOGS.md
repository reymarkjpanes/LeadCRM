# Confirmation dialogs

Use `frontend/src/shared/components/crm/confirm-action-dialog.tsx` for action confirmations. The existing `use-confirm-dialog.ts` hook is available when a module needs imperative configuration. Both use `ConfirmActionDialogProps` and `ConfirmActionOptions` from the component; there is no separate configuration or global state system.

```tsx
<ConfirmActionDialog
  open={open}
  onOpenChange={setOpen}
  title="Archive Role?"
  description="Reassign its users first. Archived roles can be restored from Archived Data."
  variant="destructive"
  confirmLabel="Archive Role"
  onConfirm={async () => {
    await archiveRole(role.id);
    toast.success('Role archived.');
  }}
/>
```

## Appearance and configuration

| Variant | Color | Typical actions |
| --- | --- | --- |
| `destructive` | Red | Archive, delete, remove |
| `success` | Green | Restore, activate, approve |
| `warning` | Orange | Deactivate, pause, discard |
| `default` | Blue | Confirm, continue, reset |

The shared layout caps width at 420px, uses a 16px heading, 14px body, 36px icon circle/buttons, and 12px corners. Content scrolls internally while the footer remains visible. Use `icon` for a Lucide icon override, `warning` for additional context, `items` for a compact list, and `children` for details or required inputs. Do not pass per-module color classes.

## Action contract

- Await the actual API operation. Resolving `onConfirm` closes the dialog. Show success only after that operation succeeds.
- Throw an actionable `Error` on failure. The dialog displays its message, stays open, and allows retry. A callback that catches an error must rethrow it; swallowing it counts as success.
- Return `false` for a controlled transition, such as moving from ownership reassignment to deactivation confirmation. Keep existing validation and business rules in the module callback.
- Use `isLoading` for external pending work and `confirmDisabled` for permissions or unmet business requirements. Native required child fields are validated before confirmation. The component also locks submission synchronously and blocks dismissal while pending.
- Cancel, Close, Escape, and backdrop dismissal only call `onOpenChange(false)`. They never execute the action. The component traps focus, makes the background inert, restores focus when possible, and gives each instance unique accessibility IDs.
- For partial bulk failure, remove successful IDs from selection and retain only failed IDs for retry. Do not repeat operations that already succeeded.
- Account archiving deactivates access and is restorable. Do not describe it as permanent deletion. Deal archiving likewise preserves the record. Form deletion and other permanent operations retain their existing explicit warnings.

## Audited scope

| Area | Standard confirmations |
| --- | --- |
| Administration and Settings | Role archives, user archives and status changes, ownership reassignment, group deletion/member removal, product archive |
| CRM | Lead/contact/account archives, shared record and deal menus, pipeline stage removal |
| Tasks | Editor archive and selected-task archive |
| Workflows | Archive, trigger change, activation, unsaved exit |
| Marketing | Campaign archive and form deletion |
| Notifications and Archived Data | Notification deletion and record restoration |
| Shared UI | Column reset/discard, file deletion, custom field deletion |

The redundant `ui/alert-dialog.tsx` implementation was removed after its column-drawer consumers migrated. No native browser confirmations remain in application source. Current source contains no separate System Admin confirmation surface to migrate.

Regular forms, record/detail drawers, lead conversion, Closed Won/Lost forms, task-related record creation, and workflow configuration/test panels retain their existing specialized flows. See [ARCHITECTURE.md](ARCHITECTURE.md) for module boundaries.

## Verification

Behavioral tests cover cancellation, focus trapping/restoration, unique IDs, required inputs, external loading, double submission, stale async completions, failure/retry, controlled transitions, all variants, partial bulk failure, and releasing scrolling when a parent drawer closes. Module regressions cover roles, users, groups, pipelines, tasks, workflows, marketing, notifications, archived data, and column preferences. Browser checks cover all variants, light/dark themes, a 374px mobile viewport, long-content scrolling, loading focus, and API failure/retry.

Verification on October 9, 2026: after integrating the latest campaign and inbox updates, the full frontend suite passed all 1,174 tests across 135 files with two workers. Lint/type checks and production builds passed across all three workspaces. Stale router/service mocks, validation expectations, the assignable-agent fixture, and the renamed dashboard-hook maintenance reference were corrected during verification. The Next config test now supplies and restores its own required `API_URL` fixture.

Run `npm --prefix frontend run lint`, `npm --prefix frontend test -- --maxWorkers=2`, and `npm --prefix frontend run build`. Production builds require a valid HTTPS `API_URL`; UI verification can use `NEXT_PUBLIC_USE_MOCK_DATA=true` as described in the existing repository guidance.
