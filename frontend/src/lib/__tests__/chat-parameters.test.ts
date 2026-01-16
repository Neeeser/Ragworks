import { describe, expect, it } from "vitest";

import { PARAMETER_DEFINITIONS } from "@/lib/chat-parameters";

describe("chat-parameters", () => {
  it("exposes parameter definitions", () => {
    expect(PARAMETER_DEFINITIONS.length).toBeGreaterThan(0);
    expect(PARAMETER_DEFINITIONS[0]?.key).toBe("temperature");
  });
});
