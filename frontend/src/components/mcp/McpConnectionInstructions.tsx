"use client";

import { useMemo, useState } from "react";

import { HarnessMark } from "@/components/mcp/HarnessMark";
import { HARNESSES } from "@/components/mcp/lib/harnesses";
import { CopyBlock } from "@/components/ui/copy-block";
import { TabList, tabId } from "@/components/ui/tabs";

import type { HarnessId } from "@/components/mcp/lib/harnesses";

type McpConnectionInstructionsProps = {
  serverName: string;
  endpoint: string;
  secret: string;
};

/**
 * The connection details for a freshly issued key.
 *
 * The secret is shown here and nowhere else — it is not recoverable after this
 * dialog closes, which is why the warning is stated rather than implied.
 */
export function McpConnectionInstructions({
  serverName,
  endpoint,
  secret,
}: McpConnectionInstructionsProps) {
  const [harnessId, setHarnessId] = useState<HarnessId>("claude-code");
  const harness = HARNESSES.find((item) => item.id === harnessId) ?? HARNESSES[0];

  const tabs = useMemo(
    () =>
      HARNESSES.map((item) => ({
        id: item.id,
        label: item.label,
        icon: <HarnessMark harness={item.id} />,
      })),
    [],
  );

  return (
    <div className="space-y-4">
      <CopyBlock label="API key" value={secret} inline />
      <p className="text-sm text-body leading-relaxed">
        This key is shown once. Store it in the agent configuration now; if it is lost, revoke it
        and issue another.
      </p>
      <CopyBlock label="Endpoint" value={endpoint} inline />

      <div>
        <TabList tabs={tabs} active={harnessId} onSelect={setHarnessId} label="MCP client" wrap />
        <div role="tabpanel" aria-labelledby={tabId(harness.id)}>
          <CopyBlock
            className="mt-3"
            label={harness.label}
            value={harness.snippet({ serverName, endpoint, secret })}
          />
          <p className="mt-2 text-xs text-muted leading-relaxed">{harness.hint}</p>
        </div>
      </div>
    </div>
  );
}
