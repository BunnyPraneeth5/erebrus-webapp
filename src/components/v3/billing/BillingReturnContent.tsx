"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fetchOrgBilling, GatewayApiError } from "@/lib/gateway/client";
import { orgPlanLabel } from "@/lib/org-plans";
import {
  FREE_PLAN_ID,
  billingErrorMessage,
} from "@/lib/billing";
import { AccentButton, Card, Eyebrow } from "@/components/v3/ui";

const POLL_MS = 2500;
const POLL_TIMEOUT_MS = 60_000;

type Phase = "verifying" | "active" | "payment-issue" | "pending" | "error";

/**
 * Landing page after the Dodo checkout redirect. The query params prove
 * nothing — only `GET /orgs/:id/billing` decides what happened.
 */
export function BillingReturnContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orgId = searchParams.get("org_id");
  const attemptId = searchParams.get("attempt_id");
  const [phase, setPhase] = useState<Phase>("verifying");
  const [detail, setDetail] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      setPhase("error");
      setDetail("This billing link is missing its workspace reference.");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const tick = async () => {
      try {
        const status = await fetchOrgBilling(orgId);
        if (cancelled) return;
        setPlanName(orgPlanLabel(status.plan_id));

        if (
          status.provider_status === "active" &&
          status.plan_id !== FREE_PLAN_ID
        ) {
          setPhase("active");
          timer = setTimeout(
            () => router.replace(`/workspace/${orgId}?tab=billing`),
            1500
          );
          return;
        }
        if (
          status.provider_status === "past_due" ||
          status.provider_status === "on_hold"
        ) {
          setPhase("payment-issue");
          return;
        }
        const attempt = status.checkout;
        if (
          attempt &&
          attempt.attempt_id === attemptId &&
          (attempt.status === "failed" || attempt.status === "expired")
        ) {
          setPhase("error");
          setDetail("The checkout session expired before payment completed.");
          return;
        }
      } catch (e) {
        if (cancelled) return;
        // 4xx from the gateway is terminal for this page; transient failures keep polling.
        if (
          e instanceof GatewayApiError &&
          e.status >= 400 &&
          e.status < 500
        ) {
          setPhase("error");
          setDetail(billingErrorMessage(e));
          return;
        }
      }

      if (Date.now() < deadline) {
        timer = setTimeout(tick, POLL_MS);
      } else {
        setPhase("pending");
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orgId, attemptId, router]);

  const workspaceLink = orgId ? `/workspace/${orgId}?tab=billing` : "/workspace";

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Card className="p-8">
        {phase === "verifying" && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--accent)]" />
            <h2 className="mt-4 text-xl font-semibold tracking-tight">
              Verifying payment…
            </h2>
            <p className="mt-2 text-sm text-[var(--text-2)]">
              Confirming your checkout with the gateway — this can take a few
              seconds.
            </p>
          </>
        )}

        {phase === "active" && (
          <>
            <Eyebrow className="mb-2">Active</Eyebrow>
            <h2 className="text-xl font-semibold tracking-tight">
              {planName ?? "Your plan"} is active
            </h2>
            <p className="mt-2 text-sm text-[var(--text-2)]">
              Redirecting to workspace billing…
            </p>
            <Link href={workspaceLink} className="mt-5 inline-block">
              <AccentButton className="!px-4 !py-2.5">Open billing</AccentButton>
            </Link>
          </>
        )}

        {phase === "payment-issue" && (
          <>
            <h2 className="text-xl font-semibold tracking-tight">
              There&apos;s a problem with the payment
            </h2>
            <p className="mt-2 text-sm text-[var(--text-2)]">
              The subscription is not active. Check billing status in workspace
              settings or try checkout again.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Link href={workspaceLink}>
                <AccentButton className="!px-4 !py-2.5">
                  Workspace billing
                </AccentButton>
              </Link>
              <Link href="/pricing">
                <AccentButton variant="ghost" className="!px-4 !py-2.5">
                  Back to pricing
                </AccentButton>
              </Link>
            </div>
          </>
        )}

        {phase === "pending" && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--accent)]" />
            <h2 className="mt-4 text-xl font-semibold tracking-tight">
              Still confirming your payment
            </h2>
            <p className="mt-2 text-sm text-[var(--text-2)]">
              We&apos;re still confirming your payment. Check billing in
              workspace settings.
            </p>
            <Link href={workspaceLink} className="mt-5 inline-block">
              <AccentButton className="!px-4 !py-2.5">
                Workspace billing
              </AccentButton>
            </Link>
          </>
        )}

        {phase === "error" && (
          <>
            <h2 className="text-xl font-semibold tracking-tight">
              We couldn&apos;t confirm this checkout
            </h2>
            <p className="mt-2 text-sm text-[var(--danger)]">{detail}</p>
            <div className="mt-5 flex justify-center gap-3">
              <Link href={workspaceLink}>
                <AccentButton className="!px-4 !py-2.5">
                  Workspace billing
                </AccentButton>
              </Link>
              <Link href="/pricing">
                <AccentButton variant="ghost" className="!px-4 !py-2.5">
                  Back to pricing
                </AccentButton>
              </Link>
            </div>
          </>
        )}

        {attemptId && (
          <p className="mt-6 font-mono text-[10px] text-[var(--text-3)]">
            Reference: {attemptId}
          </p>
        )}
      </Card>
    </div>
  );
}
