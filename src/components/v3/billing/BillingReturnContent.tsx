"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fetchOrgBilling, GatewayApiError } from "@/lib/gateway/client";
import { orgPlanLabel } from "@/lib/org-plans";
import { billingErrorMessage, billingReturnPhase, safeCheckoutUrl } from "@/lib/billing";
import { AccentButton, ActionButton, Card, Eyebrow } from "@/components/v3/ui";

const POLL_MS = 2500;
const POLL_TIMEOUT_MS = 60_000;

type Phase = "verifying" | "active" | "payment-issue" | "pending" | "error" | "failed" | "expired";

/**
 * Landing page after the Dodo checkout redirect. The query params prove
 * nothing — only `GET /orgs/:id/billing` decides what happened.
 */
export function BillingReturnContent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get("org_id");
  const attemptId = searchParams.get("attempt_id");
  const validOrgId = !!orgId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId);
  const [phase, setPhase] = useState<Phase>("verifying");
  const [detail, setDetail] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setDetail(null);
    setPlanName(null);
    setCheckoutUrl(null);
    if (!orgId || !validOrgId) {
      setPhase("error");
      setDetail("This billing link is missing a valid workspace reference.");
      return;
    }
    setPhase("verifying");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() >= deadline) {
        setPhase("pending");
        return;
      }
      if (document.visibilityState === "hidden") {
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      let delay = POLL_MS;
      try {
        const status = await fetchOrgBilling(orgId, controller.signal);
        if (cancelled) return;
        setDetail(null);
        setPlanName(orgPlanLabel(status.plan_id));
        const next = billingReturnPhase(status, attemptId);
        setPhase(next);
        const attempt = status.checkout;
        setCheckoutUrl(attempt?.status === "ready" && (!attemptId || attempt.attempt_id === attemptId)
          ? safeCheckoutUrl(attempt.checkout_url) : null);
        if (next !== "verifying") return;
      } catch (e) {
        if (cancelled) return;
        // 4xx from the gateway is terminal for this page; transient failures keep polling.
        if (e instanceof GatewayApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          setPhase("error");
          setDetail(billingErrorMessage(e));
          return;
        }
        setDetail(billingErrorMessage(e));
        delay = 10_000;
      }
      timer = setTimeout(tick, delay);
    };

    const timeout = setTimeout(() => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      setPhase((current) => current === "verifying" ? "pending" : current);
    }, POLL_TIMEOUT_MS);
    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
      if (timer) clearTimeout(timer);
    };
  }, [orgId, attemptId, validOrgId, retry]);

  const workspaceLink = validOrgId ? `/workspace/${orgId}?tab=billing` : "/workspace";
  const titles: Record<Phase, string> = {
    verifying: "Confirming your payment…",
    active: `${planName ?? "Your plan"} is active`,
    "payment-issue": "Your subscription needs attention",
    pending: "Payment confirmation is taking longer",
    error: "We couldn't confirm this checkout",
    failed: "Checkout was unsuccessful",
    expired: "This checkout has expired",
  };
  const descriptions: Record<Phase, string> = {
    verifying: "We are checking the gateway for your subscription status. Please do not start another purchase while confirmation is pending.",
    active: "The gateway has confirmed your active plan. You can now review access and billing in your workspace.",
    "payment-issue": "Review your workspace billing before attempting another purchase. Your subscription may need a payment update or other action.",
    pending: "Automatic checking has paused. This does not mean payment failed. Check again or open workspace billing before making another purchase.",
    error: detail ?? "Open workspace billing to review the current state before making another purchase.",
    failed: "The gateway reports that this checkout failed. Review workspace billing before starting a new checkout.",
    expired: "The gateway reports that this checkout expired. Review workspace billing before starting a new checkout.",
  };

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10 text-center sm:py-16">
      <Card className="p-5 sm:p-8">
        <div role="status" aria-live="polite" aria-atomic="true">
          {phase === "verifying" && <Loader2 aria-hidden="true" className="mx-auto mb-4 h-8 w-8 animate-spin text-[var(--accent)]" />}
          {phase === "active" && <Eyebrow className="mb-2">Active</Eyebrow>}
          <h1 className="text-xl font-semibold tracking-tight">{titles[phase]}</h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-2)]">{descriptions[phase]}</p>
          {detail && phase !== "error" && <p className="mt-3 text-sm text-[var(--danger)]">{detail}</p>}
        </div>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
          {validOrgId && (phase === "pending" || phase === "error") && (
            <ActionButton variant="accent" onClick={() => { setPhase("verifying"); setRetry((value) => value + 1); }}>Check again</ActionButton>
          )}
          <Link href={workspaceLink} className="inline-block">
            <AccentButton className="w-full !px-4 !py-2.5">Open workspace billing</AccentButton>
          </Link>
          {checkoutUrl && (phase === "verifying" || phase === "pending") && (
            <a href={checkoutUrl} className="inline-flex min-h-11 items-center justify-center font-semibold text-[var(--accent-hi)] underline">Resume existing checkout</a>
          )}
        </div>
        {attemptId && <p className="mt-6 break-all font-mono text-[10px] text-[var(--text-3)]">Reference: {attemptId}</p>}
      </Card>
    </div>
  );
}
