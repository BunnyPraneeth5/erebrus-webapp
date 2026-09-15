import { describe, expect, it, vi } from "vitest";

vi.mock("@/context/appkit", () => ({ getCurrentAuthToken: () => null }));

import { claimQueuedUploads, isUploadActive, type UploadItem } from "./use-drop-uploads";

const queued = (id: string): UploadItem => ({
  id, file: new File(["test"], `${id}.txt`), filename: `${id}.txt`, size: 4,
  scope: "public", orgId: null, nodeId: "node", visibility: "public",
  status: "queued", sentBytes: 0, totalBytes: 4,
});

describe("upload queue claims", () => {
  it("claims each item synchronously so another pump cannot start it twice", () => {
    const original = [queued("a"), queued("b"), queued("c")];
    const first = claimQueuedUploads(original, 2);
    const second = claimQueuedUploads(first.items, 1);
    expect(first.toStart.map((item) => item.id)).toEqual(["a", "b"]);
    expect(second.toStart.map((item) => item.id)).toEqual(["c"]);
    expect(original.every((item) => item.status === "queued")).toBe(true);
  });

  it("respects capacity and never restarts cancelled or finished items", () => {
    const items = [queued("a"), { ...queued("b"), status: "canceled" as const }, { ...queued("c"), status: "done" as const }];
    expect(claimQueuedUploads(items, 0).toStart).toEqual([]);
    expect(claimQueuedUploads(items, 3).toStart.map((item) => item.id)).toEqual(["a"]);
  });

  it.each(["queued", "preparing", "reserving", "uploading", "finalizing"] as const)("treats %s as active", (status) => {
    expect(isUploadActive(status)).toBe(true);
  });

  it.each(["done", "error", "canceled"] as const)("treats %s as terminal", (status) => {
    expect(isUploadActive(status)).toBe(false);
  });
});
