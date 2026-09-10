import { GatewayApiError } from "@/lib/gateway/client";
import type {
  GatewayBillingPlan,
  GatewayBillingPrice,
} from "@/lib/gateway/types";

/** Gateway interval vocabulary: the pricing UI uses "annual", the API "yearly". */
export type BillingInterval = "monthly" | "yearly";

export const FREE_PLAN_ID = "personal.basic";
export const ENTERPRISE_PLAN_ID = "business.enterprise";

/** Formats a full-interval charge from integer minor units (e.g. 23988 → "$239.88"). */
export function formatMinor(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amountMinor / 100);
}

/** Monthly equivalent (in major units) of a yearly `amount_minor`. */
export function monthlyEquivalent(amountMinor: number): number {
  return amountMinor / 100 / 12;
}

/** Picks the gateway price for a plan + interval, if the catalog offers one. */
export function priceForInterval(
  plan: GatewayBillingPlan | undefined,
  interval: BillingInterval
): GatewayBillingPrice | undefined {
  return plan?.billing_prices.find((p) => p.billing_interval === interval);
}

/**
 * Initial release scope: Basic (free) → paid checkout only. Paid-to-paid
 * upgrades, interval changes and Enterprise (contact sales) are not supported.
 */
export function canCheckout(currentPlan: string, targetPlan: string): boolean {
  return (
    currentPlan === FREE_PLAN_ID &&
    targetPlan !== FREE_PLAN_ID &&
    targetPlan !== ENTERPRISE_PLAN_ID
  );
}

/** Gateway error bodies carry `{ error, code? }` — surface the code when present. */
export function billingErrorCode(err: unknown): string | null {
  if (!(err instanceof GatewayApiError)) return null;
  const body = err.body;
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return null;
}

const BILLING_ERROR_MESSAGES: Record<string, string> = {
  BILLING_DISABLED: "Billing is not enabled on this deployment.",
  BILLING_EMAIL_REQUIRED:
    "Add and verify an email address on your profile before upgrading.",
  INVALID_BILLING_REQUEST: "The billing request was invalid.",
  INVALID_BILLING_PLAN: "That plan cannot be purchased through checkout.",
  BILLING_CONFLICT:
    "There is already an active subscription or checkout for this workspace.",
  BILLING_PRODUCT_UNAVAILABLE:
    "This plan is not available for purchase right now.",
  BILLING_CHECKOUT_UNCONFIRMED:
    "Checkout could not be confirmed. Check billing status before retrying.",
  BILLING_CANCEL_UNCONFIRMED:
    "Cancellation could not be confirmed. Check billing status before retrying.",
};

/** Friendly message for a gateway billing error; falls back to the raw message. */
export function billingErrorMessage(err: unknown): string {
  const code = billingErrorCode(err);
  if (code && BILLING_ERROR_MESSAGES[code]) return BILLING_ERROR_MESSAGES[code];
  if (err instanceof GatewayApiError && err.status === 409) {
    return BILLING_ERROR_MESSAGES.BILLING_CONFLICT;
  }
  return err instanceof Error ? err.message : "Billing request failed";
}

/** Short human label for `GatewayBillingStatus.provider_status`. */
export function providerStatusLabel(status: string | undefined): string {
  const labels: Record<string, string> = {
    none: "No subscription",
    active: "Active",
    past_due: "Past due",
    on_hold: "On hold",
    cancelled: "Cancelled",
    expired: "Expired",
  };
  return labels[status ?? "none"] ?? status ?? "No subscription";
}
