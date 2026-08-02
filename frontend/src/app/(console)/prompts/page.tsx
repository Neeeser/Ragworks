import { Suspense } from "react";

import { PromptStudio } from "@/components/prompts/PromptStudio";

export default function PromptsPage() {
  return (
    <Suspense>
      <PromptStudio />
    </Suspense>
  );
}
