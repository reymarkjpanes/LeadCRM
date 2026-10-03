"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { TaskOption } from "@leadcrm/shared";
import { apiClient } from "@/lib/api/client";
import { useHasPermission } from "@/shared/hooks/use-permissions";
import { Button } from "@/shared/components/ui/button";
import { TaskSelector, taskInputClass } from "./task-selector";

const AccountForm = dynamic(() =>
  import("@/features/tenant/crm/accounts/ui/account-form").then(
    (module) => module.AccountFormInner,
  ),
);

type Lead = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  status: string;
  isArchived?: boolean;
  contactId?: string | null;
  accountId?: string | null;
  account?: { id: string; name: string } | null;
};

/** Keep Lead lifecycle changes explicit; a Task association alone cannot create them. */
export function TaskRelatedRecordCreator({
  kind,
  leadIds,
  onCreated,
  onCancel,
  onBusy,
}: {
  kind: "contact" | "account";
  leadIds: string[];
  onCreated: (option: TaskOption) => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const canEditLeads = useHasPermission("leads.edit");
  const canCreateContacts = useHasPermission("contacts.create");
  const canCreateAccounts = useHasPermission("accounts.create");
  const canViewAccounts = useHasPermission("accounts.view");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadId, setLeadId] = useState(leadIds.length === 1 ? leadIds[0] : "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [accountId, setAccountId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [newAccount, setNewAccount] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [accountDraft, setAccountDraft] = useState<object | null>(null);
  const [createdAccount, setCreatedAccount] = useState<TaskOption | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const lead = leads.find((row) => row.id === leadId);
  const leadKey = JSON.stringify(leadIds);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    Promise.all(
      leadIds.map((id) =>
        apiClient.get<{ data: Lead }>(`/crm/leads/${encodeURIComponent(id)}`),
      ),
    )
      .then((responses) => {
        if (current) {
          const rows = responses.map((response) => response.data);
          setLeads(rows);
          setAccountId(rows.find((row) => row.id === leadId)?.accountId ?? "");
        }
      })
      .catch((e: unknown) => {
        if (current)
          setError(
            e instanceof Error ? e.message : "Unable to load selected leads.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [leadKey, retry]);

  const selectLead = (id: string) => {
    setLeadId(id);
    setAccountId(leads.find((row) => row.id === id)?.accountId ?? "");
    setAccountName("");
    setNewAccount(false);
    setConfirmed(false);
    setAccountDraft(null);
  };

  const permitted =
    canEditLeads &&
    (kind === "contact" ? canCreateContacts : canCreateAccounts);
  const convertible =
    lead && !lead.isArchived && lead.status !== "Converted" && !lead.contactId;
  const create = async () => {
    if (pending.current || !permitted || !lead || lead.isArchived || !confirmed)
      return;
    if (
      kind === "contact" &&
      (!convertible ||
        (newAccount
          ? !canCreateAccounts || !accountName.trim()
          : !canViewAccounts || !accountId))
    )
      return;
    if (kind === "account" && !accountDraft) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      let option: TaskOption;
      if (kind === "contact") {
        const result = await apiClient.post<{
          data: {
            contact: { id: string; firstName: string; lastName: string };
          };
        }>(`/crm/leads/${encodeURIComponent(lead.id)}/convert`, {
          createContact: true,
          createDeal: false,
          ...(newAccount ? { accountName: accountName.trim() } : { accountId }),
        });
        const contact = result.data.contact;
        option = {
          id: contact.id,
          label: `${contact.firstName} ${contact.lastName}`,
        };
      } else {
        // If linking fails, retry the same Account instead of creating a duplicate.
        let account = createdAccount;
        if (!account) {
          const result = await apiClient.post<{
            data: { id: string; name: string };
          }>("/crm/accounts", accountDraft);
          account = { id: result.data.id, label: result.data.name };
          setCreatedAccount(account);
        }
        await apiClient.put(`/crm/leads/${encodeURIComponent(lead.id)}`, {
          accountId: account.id,
        });
        option = account;
      }
      onCreated(option);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to create and link record.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
      <p className="text-sm text-muted-foreground">
        Your task draft is preserved. Choose a selected Lead to link the new{" "}
        {kind} to. The record and Lead change are saved immediately, even if you
        later cancel the Task.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading selected leads…</p>
      ) : !leads.length ? (
        <Button
          variant="outline"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry loading leads
        </Button>
      ) : (
        <fieldset disabled={busy || !permitted} className="space-y-5">
          <label className="block space-y-2 text-sm font-medium">
            <span>Link to Lead</span>
            <select
              className={taskInputClass}
              value={leadId}
              disabled={!!createdAccount || !!accountDraft}
              onChange={(event) => selectLead(event.target.value)}
            >
              <option value="">Choose one of the selected leads</option>
              {leads.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.firstName} {row.lastName}
                  {row.email ? ` · ${row.email}` : ""}
                </option>
              ))}
            </select>
          </label>
          {lead?.isArchived && (
            <p role="alert">This Lead is archived. Choose an active Lead.</p>
          )}
          {lead &&
            !lead.isArchived &&
            kind === "contact" &&
            (convertible ? (
              <>
                <p className="text-sm">
                  The Contact will use {lead.firstName} {lead.lastName}’s Lead
                  details. Conversion changes this Lead’s status to Converted
                  and requires an Account.
                </p>
                {canViewAccounts && !newAccount && (
                  <TaskSelector
                    kind="account"
                    label="Account for converted Lead"
                    value={accountId}
                    selectedLabel={lead.account?.name}
                    onChange={(value) => {
                      setAccountId(value);
                      setConfirmed(false);
                    }}
                  />
                )}
                {canCreateAccounts && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={newAccount}
                      onChange={(event) => {
                        setNewAccount(event.target.checked);
                        setConfirmed(false);
                      }}
                    />
                    Create a new Account during conversion
                  </label>
                )}
                {newAccount && (
                  <label className="block space-y-2 text-sm">
                    <span>New Account name</span>
                    <input
                      className={taskInputClass}
                      value={accountName}
                      maxLength={255}
                      onChange={(event) => {
                        setAccountName(event.target.value);
                        setConfirmed(false);
                      }}
                    />
                  </label>
                )}
                {!canViewAccounts && !newAccount && (
                  <p className="text-sm">
                    Account view permission is required to select an existing
                    Account.
                  </p>
                )}
                {lead.account && (
                  <p className="text-sm text-muted-foreground">
                    Current Account: {lead.account.name}. Choosing another
                    Account will replace this link.
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  I confirm converting {lead.firstName} {lead.lastName} and
                  linking the Account chosen above.
                </label>
                <Button
                  type="button"
                  disabled={
                    !confirmed ||
                    (newAccount
                      ? !accountName.trim()
                      : !canViewAccounts || !accountId)
                  }
                  onClick={() => void create()}
                >
                  Create contact and convert Lead
                </Button>
              </>
            ) : (
              <p role="status" className="text-sm">
                This Lead already has a Contact or has been converted. Choose
                another Lead, or return to select its existing Contact.
              </p>
            ))}
          {lead && !lead.isArchived && kind === "account" && (
            <>
              <div hidden={!!accountDraft}>
                <AccountForm
                  key={lead.id}
                  onCancel={onCancel}
                  onSave={(data) => {
                    setAccountDraft({
                      ...data,
                    });
                    setConfirmed(false);
                  }}
                />
              </div>
              {accountDraft && (
                <div className="space-y-4 rounded-xl border border-border p-4">
                  <p className="text-sm">
                    {createdAccount
                      ? `Account “${createdAccount.label}” has been created. Retry linking it to`
                      : `Create Account “${"name" in accountDraft ? String(accountDraft.name) : ""}” and link it to`}{" "}
                    {lead.firstName} {lead.lastName}.
                    {lead.account
                      ? ` This replaces the current Account link to “${lead.account.name}”.`
                      : ""}
                  </p>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    I confirm updating this Lead’s Account link.
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {!createdAccount && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setAccountDraft(null);
                          setConfirmed(false);
                        }}
                      >
                        Edit Account details
                      </Button>
                    )}
                    <Button disabled={!confirmed} onClick={() => void create()}>
                      {createdAccount
                        ? "Retry linking Account"
                        : "Confirm create and link Account"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </fieldset>
      )}
      {!permitted && (
        <p role="alert" className="text-sm">
          Creating this related record requires Lead edit permission and {kind}{" "}
          create permission.
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm">
          Saving record and Lead relationship…
        </p>
      )}
      {createdAccount && (
        <p className="text-sm text-muted-foreground">
          If you cancel, the created Account remains available in Accounts.
        </p>
      )}
      <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
        Back to Task
      </Button>
    </div>
  );
}
