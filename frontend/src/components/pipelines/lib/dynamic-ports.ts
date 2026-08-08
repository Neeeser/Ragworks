/**
 * Config-derived output ports, mirroring `app/pipelines/node_ports.py`.
 *
 * A node whose fan-out the user defines — the router's named branches —
 * carries a `dynamic_output_ports` declaration on its spec instead of a fixed
 * output list. Everything on the canvas that asks "which handles does this
 * node have" reads the result of `resolveOutputPorts`, so the ports the
 * editor draws, the connections it allows, and the ports the server validates
 * against are one answer rather than three.
 *
 * Derived ports come first and the spec's own declared ports last, matching
 * the server: a config-derived list is the node's primary fan-out and a fixed
 * fallback port reads as the case left over after it.
 *
 * A derived port's key is built from a stable entry *id*, never its name, so
 * renaming a branch keeps every edge already wired to it.
 */

import type { NodePort, NodeSpec } from "@/lib/types";

/** Separator between a dynamic port's prefix and the config entry id. */
export const DYNAMIC_PORT_SEPARATOR = ":";

/** The output-port key one config entry contributes. */
export const dynamicPortKey = (prefix: string, entryId: string) =>
  `${prefix}${DYNAMIC_PORT_SEPARATOR}${entryId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The output ports this config contributes, in config order.
 *
 * Reads the raw config rather than a parsed model because it runs while the
 * user is still typing: a half-written branch must still show its handle, and
 * an entry with no id contributes nothing rather than an unaddressable port.
 */
export const derivedOutputPorts = (
  spec: NodeSpec["dynamic_output_ports"],
  config: Record<string, unknown> | undefined,
): NodePort[] => {
  if (!spec) return [];
  const entries = config?.[spec.config_field];
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const ports: NodePort[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const entryId = entry[spec.id_field];
    if (typeof entryId !== "string" || !entryId || seen.has(entryId)) continue;
    seen.add(entryId);
    const label = entry[spec.label_field];
    ports.push({
      ...spec.template,
      key: dynamicPortKey(spec.key_prefix, entryId),
      label: typeof label === "string" && label.trim() ? label : entryId,
    });
  }
  return ports;
};

/** The output ports a node has, given the spec it is and the config it carries. */
export const resolveOutputPorts = (
  spec: NodeSpec | undefined,
  config: Record<string, unknown> | undefined,
): NodePort[] => {
  if (!spec) return [];
  return [...derivedOutputPorts(spec.dynamic_output_ports, config), ...spec.output_ports];
};
