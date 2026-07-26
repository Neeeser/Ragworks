import { describe, expect, it } from "vitest";

import { resumeStep } from "@/components/setup/lib/setup-resume";
import { makeSetupStatus } from "@/test/fixtures";

describe("resumeStep", () => {
  it("resumes past a providers step whose capabilities are all covered", () => {
    const status = makeSetupStatus({
      has_embedding_provider: true,
      has_chat_provider: true,
      has_vector_store: true,
    });

    expect(resumeStep(status)).toBe("model");
  });

  it("stops at providers when only some capabilities are covered", () => {
    const status = makeSetupStatus({ has_embedding_provider: true, has_chat_provider: false });

    expect(resumeStep(status)).toBe("providers");
  });

  it("returns to the earliest incomplete step even when a later one is satisfied", () => {
    // A registered index exists, but the chat provider was removed since —
    // the user still has a decision on the providers step, so the index
    // being ready must not carry them past it.
    const status = makeSetupStatus({
      has_embedding_provider: true,
      has_chat_provider: false,
      has_index: true,
    });

    expect(resumeStep(status)).toBe("providers");
  });

  it("keeps welcome as the entry point for a workspace with no progress", () => {
    expect(resumeStep(makeSetupStatus())).toBe("welcome");
  });

  it("does not treat built-in pgvector alone as progress worth resuming into", () => {
    // `has_vector_store` is true on every fresh deployment; counting it would
    // send a first-run user straight past the welcome step.
    const status = makeSetupStatus({ has_vector_store: true });

    expect(resumeStep(status)).toBe("welcome");
  });

  it("leaves a completed workspace on welcome so the dashboard redirect still fires", () => {
    const status = makeSetupStatus({
      has_embedding_provider: true,
      has_chat_provider: true,
      has_index: true,
      has_collection: true,
      setup_complete: true,
    });

    expect(resumeStep(status)).toBe("welcome");
  });

  it("resumes nothing while readiness is unknown", () => {
    expect(resumeStep(null)).toBe("welcome");
  });
});
