import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-session", () => ({ getCurrentAuthToken: () => null, invalidateSession: vi.fn() }));

import { billingErrorMessage, billingReturnPhase, safeCheckoutUrl } from "./billing";
import { GatewayApiError } from "./gateway/client";
import type { GatewayBillingStatus } from "./gateway/types";

const status = (overrides: Partial<GatewayBillingStatus> = {}): GatewayBillingStatus => ({
  org_id: "org", plan_id: "personal.basic", billing_managed: false,
  provider_status: "none", cancel_at_period_end: false, ...overrides,
});

describe("billing confirmation", () => {
  it("requires an active paid plan, not just a completed checkout", () => {
    expect(billingReturnPhase(status({ checkout: { attempt_id: "a", org_id: "org", status: "completed", created_at: "" } }), "a")).toBe("verifying");
    expect(billingReturnPhase(status({ provider_status: "active" }))).toBe("verifying");
    expect(billingReturnPhase(status({ provider_status: "active", plan_id: "personal.pro" }))).toBe("active");
  });

  it.each(["failed", "expired"] as const)("distinguishes a matching %s checkout", (state) => {
    const value = status({ checkout: { attempt_id: "a", org_id: "org", status: state, created_at: "" } });
    expect(billingReturnPhase(value, "a")).toBe(state);
    expect(billingReturnPhase(value, "different-attempt")).toBe("verifying");
  });

  it.each(["past_due", "on_hold", "failed", "paused"])("recognizes %s subscriptions", (provider_status) => {
    expect(billingReturnPhase(status({ provider_status }))).toBe("payment-issue");
  });
});

describe("checkout links", () => {
  it.each([undefined, "", "javascript:alert(1)", "http://checkout.example.com", "https://user:password@checkout.example.com", "/billing"])("rejects unsafe or unusable links: %s", (value) => {
    expect(safeCheckoutUrl(value)).toBeNull();
  });

  it("preserves a valid HTTPS provider URL", () => {
    expect(safeCheckoutUrl("https://checkout.example.com/session/abc")).toBe("https://checkout.example.com/session/abc");
  });
});

describe("billing recovery messages", () => {
  it("explains expired sessions and owner permissions", () => {
    expect(billingErrorMessage(new GatewayApiError("Unauthorized", 401))).toContain("sign in");
    expect(billingErrorMessage(new GatewayApiError("Forbidden", 403))).toContain("owner");
  });

  it("does not encourage a second purchase after a connection failure", () => {
    expect(billingErrorMessage(new TypeError("Failed to fetch"))).toContain("billing status");
  });
});
