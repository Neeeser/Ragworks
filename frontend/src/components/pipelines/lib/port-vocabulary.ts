/**
 * What every surface calls a port.
 *
 * A port has two names. Its *type* is the canonical one — File items, Text
 * items, Embedded items, Image items, Scored items, Items, Structured values,
 * Result — derived from the facets it requires, accepts, or adds, and identical
 * wherever that type appears. Its *role* is the node-local noun the node
 * declares (`Query`, `Chunks`, `Indexed`), which is worth showing only when it
 * says something the type does not: the same type reaching a user under three
 * node-local spellings is what makes a graph unreadable.
 *
 * Port rows, port tooltips, the canvas legend, the node catalog, and the
 * pre-measurement height estimate all read from here, so they cannot drift.
 */

import { portToken } from "./facet-inference";
import { getPortTypeLabel } from "./pipeline-theme";

import type { FacetPort } from "./facet-inference";

export type PortSide = "input" | "output";

/** A port declaration as this module needs to read it. */
export type VocabularyPort = FacetPort & {
  label: string;
  required?: boolean;
  accepts_many?: boolean;
};

/**
 * Collapse a name to compare it with another: lowercase, words only, and each
 * word singularized, so `Images` and `Image items` are recognized as the same
 * word rather than differing by one character.
 */
const collapse = (value: string): string =>
  value
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .join("");

/**
 * Nouns that name a stream without describing it. Substring comparison catches
 * every other redundant role (`Items` inside `Text items`), but `Results` on a
 * Scored items port shares no word with its type while carrying no more
 * information than "a stream" — and it is exactly the noun three different
 * nodes reach for.
 */
const GENERIC_ROLES: ReadonlySet<string> = new Set([
  "result",
  "item",
  "value",
  "data",
  "input",
  "output",
  "record",
]);

/** The canonical type name for a port — the same words wherever it appears. */
export const portTypeName = (port: VocabularyPort, side: PortSide): string =>
  getPortTypeLabel(portToken(port, side));

/**
 * The node-local role noun, or `null` when it only restates the type.
 *
 * Redundant either way round: `Items` sits inside `Text items`, and
 * `Query Embedding` contains neither direction of `Embedded items`, so it
 * survives as the thing the type genuinely cannot say.
 */
export const portRoleName = (port: VocabularyPort, side: PortSide): string | null => {
  const role = port.label?.trim();
  if (!role) return null;
  const collapsedRole = collapse(role);
  if (!collapsedRole || GENERIC_ROLES.has(collapsedRole)) return null;
  const collapsedType = collapse(portTypeName(port, side));
  if (collapsedType.includes(collapsedRole) || collapsedRole.includes(collapsedType)) return null;
  return role;
};

/** True when this input takes any number of edges (the fan-in ports). */
export const portAcceptsMany = (port: VocabularyPort, side: PortSide): boolean =>
  side === "input" && Boolean(port.accepts_many);

/** True when this input must be wired for the pipeline to be valid. */
export const portIsRequired = (port: VocabularyPort, side: PortSide): boolean =>
  side === "input" && port.required !== false;

/**
 * The port's full contract in one string, for its tooltip.
 *
 * The tooltip is where the facet requirement is spelled out, because that is
 * the mechanism a refused connection reports against — a port that "requires
 * text on every item" explains why a Scored items stream satisfies it and a
 * File items stream does not.
 */
export const portTooltip = (port: VocabularyPort, side: PortSide): string => {
  const parts = [portTypeName(port, side)];
  const role = portRoleName(port, side);
  if (role) parts.push(role);
  if (side === "input") {
    parts.push(portAcceptsMany(port, side) ? "accepts many connections" : "accepts one connection");
    parts.push(portIsRequired(port, side) ? "required" : "optional");
    const requires = port.requires ?? [];
    if (requires.length > 0) {
      parts.push(`needs ${[...requires].sort().join(" and ")} on every item`);
    }
  }
  return parts.join(" · ");
};
