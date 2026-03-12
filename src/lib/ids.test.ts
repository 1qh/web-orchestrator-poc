import { describe, expect, test } from "bun:test";

import { createId } from "@/lib/ids";

describe("createId", () => {
  test("prefixes generated id", () => {
    const id = createId("msg");
    expect(id.startsWith("msg_")).toBe(true);
    expect(id.length).toBeGreaterThan(8);
  });
});
