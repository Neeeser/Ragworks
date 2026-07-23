/**
 * Pin the frontend side of the shared observability contract. The same
 * `tests/assets/observability_contract.json` is asserted by pytest on the
 * backend, so the request-ID header name cannot drift between the two
 * packages without failing a gate.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REQUEST_ID_HEADER } from "@/lib/observability";

const CONTRACT_PATH = path.resolve(process.cwd(), "../tests/assets/observability_contract.json");
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8")) as {
  request_id_header: string;
};

describe("observability contract", () => {
  it("uses the shared request-ID header name", () => {
    expect(REQUEST_ID_HEADER.toLowerCase()).toBe(contract.request_id_header.toLowerCase());
  });
});
