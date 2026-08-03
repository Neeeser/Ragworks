import { Suspense } from "react";

import { PromptStudio } from "@/components/prompts/PromptStudio";

export default function PromptsPage() {
  return (
    <Suspense>
      {/* The page owns the address bar; the pipeline-editor overlay does not. */}
      <PromptStudio trackUrl />
    </Suspense>
  );
}
