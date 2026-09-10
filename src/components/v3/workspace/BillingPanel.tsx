"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchOrgBilling,
  requestOrgBillingCancel,
  GatewayApiError,
} from "@/lib/gateway/client";
import type { GatewayBillingStatus, GatewayOrg } from "@/lib/gateway/types";
import { isOrgOwner } from "@/lib/gateway/org-permissions";
import { orgPlanLabel } from "@/lib/org-plans";
import {
  billingErrorMessage,
  formatMinor,
  providerStatusLabel,
} from "@/lib/billing";
import {
  ActionButton,
  Card,
  MonoLabel,
  StatusDot,
} from "@/components/v3/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function fmtDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "PPP");
}

function statusColor(status: string | undefined): string {
  switch (status) {
    case "active":
      return "var(--success)";
    case "past_due":
    case "on_hold":
      return "var(--danger)";
    case "cancelled":
    case "expired":
      return "var(--text-3)";
    default:
      return "var(--text-2)";
  }
}

export function BillingPanel({ org }: { org: GatewayOrg }) {
  const [status, setStatus] = useState<GatewayBillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const isOwner = isOrgOwner(org);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchOrgBilling(org.id)
      .then(setStatus)
      .catch((e) => {
        // Orgs with no billing record may 404 — that is "no subscription".
        if (e instanceof GatewayApiError && e.status === 404) {
          setStatus(null);
          return;
        }
        setError(billingErrorMessage(e));
      })
      .finally(() => setLoading(false));
  }, [org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await requestOrgBillingCancel(org.id);
      toast.success("Cancellation scheduled at the next billing date");
      setConfirmOpen(false);
      load();
    } catch (e) {
      toast.error(billingErrorMessage(e));
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-[var(--danger)]/30 bg-[var(--danger)]/5 p-5 text-sm text-[var(--danger)]">
        {error}
      </Card>
    );
  }

  const planId = status?.plan_id ?? org.plan ?? org.kind;
  const nextBilling = fmtDate(status?.next_billing_date);
  const paidAccessUntil = fmtDate(status?.paid_access_until);
  const pastDueEnds = fmtDate(status?.past_due_ends_at);
  const checkoutInProgress =
    status?.checkout &&
    ["creating", "unknown", "ready"].includes(status.checkout.status);
  const canCancel =
    isOwner &&
    status?.provider_status === "active" &&
    !status.cancel_at_period_end;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <MonoLabel>Current plan</MonoLabel>
            <div className="mt-1.5 text-xl font-semibold">
              {orgPlanLabel(planId)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot color={statusColor(status?.provider_status)} />
            <span className="font-mono text-xs uppercase tracking-wide text-[var(--text-2)]">
              {providerStatusLabel(status?.provider_status)}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-white/[0.06] pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <MonoLabel>Billing interval</MonoLabel>
            <div className="mt-1 text-sm capitalize">
              {status?.billing_interval ?? "—"}
            </div>
          </div>
          <div>
            <MonoLabel>Amount</MonoLabel>
            <div className="mt-1 text-sm">
              {status?.recurring_amount_minor != null
                ? `${formatMinor(
                    status.recurring_amount_minor,
                    status.currency ?? "USD"
                  )}${status.billing_interval === "yearly" ? "/yr" : "/mo"}`
                : "—"}
            </div>
          </div>
          <div>
            <MonoLabel>Next billing date</MonoLabel>
            <div className="mt-1 text-sm">{nextBilling ?? "—"}</div>
          </div>
          <div>
            <MonoLabel>Access until</MonoLabel>
            <div className="mt-1 text-sm">{paidAccessUntil ?? "—"}</div>
          </div>
        </div>
      </Card>

      {status?.cancel_at_period_end && (
        <Card className="border-[var(--accent)]/25 bg-[var(--accent)]/5 p-4 text-sm text-[var(--text-2)]">
          Cancels on{" "}
          <span className="font-semibold text-[var(--text)]">
            {nextBilling ?? paidAccessUntil ?? "the next billing date"}
          </span>
          {paidAccessUntil ? ` — access remains until ${paidAccessUntil}.` : "."}
        </Card>
      )}

      {(status?.provider_status === "past_due" ||
        status?.provider_status === "on_hold") && (
        <Card className="border-[var(--danger)]/30 bg-[var(--danger)]/5 p-4 text-sm text-[var(--danger)]">
          {status.provider_status === "past_due"
            ? `A payment is past due${
                pastDueEnds ? ` — resolve it by ${pastDueEnds}` : ""
              } to keep your subscription active.`
            : "This subscription is on hold due to a payment issue."}
        </Card>
      )}

      {checkoutInProgress && (
        <Card className="flex items-center gap-3 p-4 text-sm text-[var(--text-2)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
          <span className="flex-1">Checkout in progress…</span>
          {status?.checkout?.checkout_url && (
            <a
              href={status.checkout.checkout_url}
              className="font-semibold text-[var(--accent-hi)]"
            >
              Resume checkout
            </a>
          )}
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--text-2)]">
            {isOwner
              ? "Plan changes and invoices are handled through checkout."
              : "Only the workspace owner can change or cancel the plan."}
          </p>
          <div className="flex gap-2">
            {isOwner && (
              <Link href="/pricing">
                <ActionButton type="button" variant="neutral">
                  View plans
                </ActionButton>
              </Link>
            )}
            {canCancel && (
              <ActionButton
                type="button"
                variant="danger"
                onClick={() => setConfirmOpen(true)}
              >
                Cancel at next billing date
              </ActionButton>
            )}
          </div>
        </div>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="border-white/10 bg-[var(--elevated)] text-[var(--text)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--text-2)]">
              Cancellation takes effect on{" "}
              {nextBilling ?? "the next billing date"}. Your workspace keeps
              paid access
              {paidAccessUntil ? ` until ${paidAccessUntil}` : " until then"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/[0.05]">
              Keep plan
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleCancel();
              }}
              disabled={cancelling}
              className="bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90"
            >
              {cancelling ? "Cancelling…" : "Cancel at next billing date"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
