"use client";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { TaskOption, TaskOptionKind } from "@leadcrm/shared";
import { Button } from "@/shared/components/ui/button";
import { TaskRelatedRecordCreator } from "./task-related-record-creator";
import { ContactFormInner } from "@/features/tenant/crm/contacts/ui/contact-form";
const LeadForm = dynamic(() =>
  import("@/features/tenant/crm/leads/ui/lead-form").then(
    (module) => module.AddLeadForm,
  ),
);
const AccountForm = dynamic(() =>
  import("@/features/tenant/crm/accounts/ui/account-form").then(
    (module) => module.AccountFormInner,
  ),
);
const DealForm = dynamic(() =>
  import("@/features/tenant/crm/deals/ui/deal-form").then(
    (module) => module.DealForm,
  ),
);

/** Uses CRM forms and public routes; creation never clears the parent Task draft. */
export function TaskRecordCreator({
  kind,
  leadIds = [],
  onCreated,
  onCancel,
  onBusy,
}: {
  kind: Exclude<TaskOptionKind, "user">;
  leadIds?: string[];
  onCreated: (option: TaskOption) => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const submit = async (data: object) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const path = {
        lead: "leads",
        contact: "contacts",
        account: "accounts",
        deal: "deals",
      }[kind];
      const response = await apiClient.post<{
        data: {
          id: string;
          firstName?: string;
          lastName?: string;
          name?: string;
          title?: string;
        };
      }>("/crm/" + path, data);
      const row = response.data;
      onCreated({
        id: row.id,
        label:
          row.name ||
          row.title ||
          [row.firstName, row.lastName].filter(Boolean).join(" "),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create record.");
    } finally {
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  if (leadIds.length && (kind === "contact" || kind === "account")) {
    return (
      <TaskRelatedRecordCreator
        kind={kind}
        leadIds={leadIds}
        onCreated={onCreated}
        onCancel={onCancel}
        onBusy={onBusy}
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pt-4 shrink-0">
        <p className="text-xs text-muted-foreground">
          Your task draft is preserved. The new record will be selected after it
          is saved.
        </p>
        {kind === "deal" && leadIds.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            This deal will be linked to the {leadIds.length} selected
            {leadIds.length === 1 ? " lead" : " leads"}. You can add other leads
            below.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>
      <fieldset disabled={busy} className="min-h-0 flex-1 flex flex-col">
        {kind === "lead" && (
          <LeadForm onSave={(data) => void submit(data)} onCancel={onCancel} />
        )}
        {kind === "contact" && (
          <ContactFormInner
            onSave={(data) => {
              const payload = {
                ...data,
                company: (data as any).companyName || (data as any).company,
                source: (data as any).leadSource || (data as any).source,
                productInterests: (data as any).productInterest || (data as any).productInterests,
              };
              void submit(payload);
            }}
            onCancel={onCancel}
          />
        )}
        {kind === "account" && (
          <AccountForm
            onSave={(data) =>
              void submit({
                ...data,
              })
            }
            onCancel={onCancel}
          />
        )}
        {kind === "deal" && (
          <DealForm
            mode="create"
            isLoading={busy}
            onCancel={onCancel}
            onSubmit={async (data) => {
              const { organizationId, ...payload } = data;
              await submit({
                ...payload,
                leadIds: [...new Set([...leadIds, ...(payload.leadIds ?? [])])],
                accountId: organizationId || undefined,
              });
            }}
          />
        )}
      </fieldset>
      {busy && (
        <p role="status" className="px-6 py-2 text-sm text-muted-foreground shrink-0">
          Creating record…
        </p>
      )}
    </div>
  );
}
