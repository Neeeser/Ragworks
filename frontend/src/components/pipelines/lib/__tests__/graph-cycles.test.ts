import { describe, expect, it } from "vitest";

import { findGraphCycles } from "../graph-cycles";

const edge = (id: string, source: string, target: string) => ({ id, source, target });

describe("findGraphCycles", () => {
  it("reports nothing for the ordinary shape, a chain", () => {
    const result = findGraphCycles([edge("e1", "parse", "chunk"), edge("e2", "chunk", "embed")]);

    expect(result.edgeIds.size).toBe(0);
    expect(result.paths).toEqual([]);
  });

  it("reports nothing for a diamond, where two branches rejoin", () => {
    const result = findGraphCycles([
      edge("e1", "in", "a"),
      edge("e2", "in", "b"),
      edge("e3", "a", "merge"),
      edge("e4", "b", "merge"),
    ]);

    expect(result.edgeIds.size).toBe(0);
  });

  it("marks every edge in the loop, not only the one that closed it", () => {
    const result = findGraphCycles([
      edge("e1", "a", "b"),
      edge("e2", "b", "c"),
      edge("closes", "c", "a"),
    ]);

    // Any of the three is a valid place to cut; highlighting only "closes"
    // would point at an arbitrary choice.
    expect([...result.edgeIds].sort()).toEqual(["closes", "e1", "e2"]);
  });

  it("leaves edges that merely lead into a loop unmarked", () => {
    const result = findGraphCycles([
      edge("feed", "source", "a"),
      edge("e1", "a", "b"),
      edge("e2", "b", "a"),
      edge("drain", "b", "sink"),
    ]);

    expect([...result.edgeIds].sort()).toEqual(["e1", "e2"]);
  });

  it("names the loop as a node path so a message can spell it out", () => {
    const result = findGraphCycles([
      edge("e1", "a", "b"),
      edge("e2", "b", "c"),
      edge("e3", "c", "a"),
    ]);

    expect(result.paths).toHaveLength(1);
    const [path] = result.paths;
    expect(path[0]).toBe(path[path.length - 1]);
    expect(new Set(path)).toEqual(new Set(["a", "b", "c"]));
  });

  it("catches a node wired back into itself", () => {
    const result = findGraphCycles([edge("self", "a", "a")]);

    expect([...result.edgeIds]).toEqual(["self"]);
    expect(result.paths).toEqual([["a", "a"]]);
  });

  it("reports two independent loops separately", () => {
    const result = findGraphCycles([
      edge("a1", "a", "b"),
      edge("a2", "b", "a"),
      edge("b1", "x", "y"),
      edge("b2", "y", "x"),
    ]);

    expect([...result.edgeIds].sort()).toEqual(["a1", "a2", "b1", "b2"]);
    expect(result.paths).toHaveLength(2);
  });

  it("survives a chain long enough to overflow a recursive walk", () => {
    const edges = Array.from({ length: 20_000 }, (_, index) =>
      edge(`e${index}`, `n${index}`, `n${index + 1}`),
    );

    expect(() => findGraphCycles(edges)).not.toThrow();
    expect(findGraphCycles(edges).edgeIds.size).toBe(0);
  });
});
