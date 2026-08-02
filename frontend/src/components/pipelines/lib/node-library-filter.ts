import type { NodeFamily } from "./pipeline-theme";
import type { NodeSpec } from "@/lib/types";

/** One family section of the node catalog, as built by `buildNodeCatalog`. */
export type NodeCatalogGroup = { family: NodeFamily; specs: NodeSpec[] };

const includes = (haystack: string | undefined, needle: string) =>
  Boolean(haystack && haystack.toLowerCase().includes(needle));

/** Whether the spec itself (not its presets) matches the query. */
const specSelfMatches = (spec: NodeSpec, query: string) =>
  includes(spec.label, query) || includes(spec.type, query);

/**
 * Narrow the catalog for the library panel.
 *
 * A non-empty search deliberately ignores the family filter — the rail narrows
 * browsing, but typing is a question about the whole catalog, and answering it
 * from inside one category silently hides the node the user is looking for.
 * A shell whose presets match survives with only the matching presets; a shell
 * that matches itself keeps its full preset list.
 */
export const filterNodeCatalog = (
  catalog: NodeCatalogGroup[],
  family: NodeFamily | null,
  search: string,
): NodeCatalogGroup[] => {
  const query = search.trim().toLowerCase();
  if (!query) {
    return family ? catalog.filter((group) => group.family === family) : catalog;
  }
  return catalog
    .map((group) => ({
      family: group.family,
      specs: group.specs
        .map((spec) => {
          if (specSelfMatches(spec, query)) return spec;
          const presets = (spec.presets ?? []).filter((preset) =>
            includes(preset.label, query),
          );
          return presets.length > 0 ? { ...spec, presets } : null;
        })
        .filter((spec): spec is NodeSpec => spec !== null),
    }))
    .filter((group) => group.specs.length > 0);
};

/** Total node count of a group (presets not counted — they are configs, not nodes). */
export const groupNodeCount = (group: NodeCatalogGroup) => group.specs.length;

/** The description's first sentence, for one-line catalog rows. */
export const firstSentence = (description: string): string => {
  const match = description.match(/^[^.!?]*[.!?]/);
  return match ? match[0].trim() : description;
};
