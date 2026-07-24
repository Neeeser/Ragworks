"use client";

import { useState } from "react";

import { claudeCodeCommand, mcpServersJson } from "@/components/mcp/lib/connection";
import { CopyBlock } from "@/components/ui/copy-block";
import { cn } from "@/lib/utils";

type McpConnectionInstructionsProps = {
  serverName: string;
  endpoint: string;
  secret: string;
};

const FORMATS = [
  { id: "claude", label: "Claude Code" },
  { id: "json", label: "JSON config" },
] as const;

type FormatId = (typeof FORMATS)[number]["id"];

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
  const [format, setFormat] = useState<FormatId>("claude");

  const snippet =
    format === "claude"
      ? claudeCodeCommand(serverName, endpoint, secret)
      : mcpServersJson(serverName, endpoint, secret);

  return (
    <div className="space-y-4">
      <CopyBlock label="API key" value={secret} inline />
      <p className="text-sm text-body leading-relaxed">
        This key is shown once. Store it in the agent configuration now; if it is lost, revoke it
        and issue another.
      </p>
      <CopyBlock label="Endpoint" value={endpoint} inline />

      <div>
        <div
          className="flex gap-1 rounded-full border border-hairline p-1"
          role="tablist"
          aria-label="Configuration format"
        >
          {FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={format === item.id}
              onClick={() => setFormat(item.id)}
              className={cn(
                "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                format === item.id
                  ? "bg-accent-violet/15 text-primary"
                  : "text-muted hover:text-primary",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <CopyBlock className="mt-3" label="Configuration" value={snippet} />
      </div>
    </div>
  );
}
