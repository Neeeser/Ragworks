"use client";

import { Button } from "../ui/button";
import { InstrumentLabel } from "../ui/instrument-label";

import { IndexBackendIcon } from "./icons/IndexBackendIcon";
import { backendSupportLabel, restrictedBackends } from "./lib/backend-support";
import { portToken } from "./lib/facet-inference";
import { resolveNodeDescription } from "./lib/node-content";
import { getPortTypeClasses, getPortTypeLabel } from "./lib/pipeline-theme";
import { presetizedSpec } from "./lib/presets";

import { cn } from "@/lib/utils";

import type { IndexBackend, NodePort, NodeSpec } from "@/lib/types";

type NodeCatalogDetailProps = {
  spec: NodeSpec;
  knownBackends: IndexBackend[];
  unavailable: boolean;
  unavailableMessage?: string | null;
  onAdd: (spec: NodeSpec) => void;
};

/** One port line: stage-colored square dot, label, and its facet contract. */
function PortLine({ port, side }: { port: NodePort; side: "input" | "output" }) {
  const token = portToken(port, side);
  const facets = side === "input" ? port.requires : port.adds;
  const notes = [
    facets && facets.length > 0
      ? `${side === "input" ? "requires" : "adds"} ${facets.join(", ")}`
      : null,
    side === "output" && port.preserves ? "preserves facets" : null,
    port.accepts_many ? "accepts many" : null,
  ].filter(Boolean);
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 self-center rounded-[2px]", getPortTypeClasses(token).dot)}
      />
      <span className="text-instrument text-body">{port.label || getPortTypeLabel(token)}</span>
      {notes.length > 0 ? (
        <span className="ml-auto font-mono text-instrument text-meta">{notes.join(" · ")}</span>
      ) : null}
    </div>
  );
}

/**
 * Everything about the focused catalog entry: full description, the node's
 * type id, its port contract, presets with one-click add, backend support,
 * and the add action. The type id lives here (and the preview drawer) — the
 * list rows dropped it for density.
 */
export function NodeCatalogDetail({
  spec,
  knownBackends,
  unavailable,
  unavailableMessage,
  onAdd,
}: NodeCatalogDetailProps) {
  const restricted = restrictedBackends(spec, knownBackends);
  const presets = spec.presets ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <div>
        <h3 className="text-head font-semibold tracking-[-0.01em] text-primary">{spec.label}</h3>
        {/* A node type id is a literal — mono, verbatim. */}
        <p className="mt-0.5 font-mono text-instrument text-meta">{spec.type}</p>
      </div>
      <p className="text-ui leading-relaxed text-body">{resolveNodeDescription(spec)}</p>
      {spec.input_ports.length > 0 ? (
        <div>
          <InstrumentLabel>Inputs</InstrumentLabel>
          <div className="mt-1">
            {spec.input_ports.map((port) => (
              <PortLine key={port.key} port={port} side="input" />
            ))}
          </div>
        </div>
      ) : null}
      {spec.output_ports.length > 0 ? (
        <div>
          <InstrumentLabel>Outputs</InstrumentLabel>
          <div className="mt-1">
            {spec.output_ports.map((port) => (
              <PortLine key={port.key} port={port} side="output" />
            ))}
          </div>
        </div>
      ) : null}
      {restricted ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            {restricted.map((backend) => (
              <IndexBackendIcon key={backend} backend={backend} className="h-3.5 w-3.5" />
            ))}
          </span>
          <span className="text-instrument text-muted">
            Only available on {backendSupportLabel(restricted)}
          </span>
        </div>
      ) : null}
      {presets.length > 0 ? (
        <div>
          <InstrumentLabel>Presets</InstrumentLabel>
          <div className="mt-1 space-y-1">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className="flex items-center gap-2 rounded-control border border-hairline bg-surface px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-instrument font-medium text-primary">
                    {preset.label}
                  </p>
                  <p className="truncate text-instrument text-muted">{preset.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={unavailable}
                  onClick={() => onAdd(presetizedSpec(spec, preset))}
                >
                  Add
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-auto pt-2">
        {unavailable && unavailableMessage ? (
          <p className="mb-2 text-instrument text-muted">{unavailableMessage}</p>
        ) : null}
        <Button className="w-full" disabled={unavailable} onClick={() => onAdd(spec)}>
          Add to canvas
        </Button>
      </div>
    </div>
  );
}
