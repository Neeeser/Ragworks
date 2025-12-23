"use client";

import type { NodeSpec } from "@/lib/types";

type PipelineNodeLibraryProps = {
  catalog: Record<string, NodeSpec[]>;
  onAddNode: (spec: NodeSpec) => void;
};

export function PipelineNodeLibrary({ catalog, onAddNode }: PipelineNodeLibraryProps) {
  return (
    <div className="mt-6 border-t border-white/5 pt-4">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Node library</p>
      <div className="mt-3 space-y-4">
        {Object.entries(catalog).map(([category, specs]) => (
          <div key={category}>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{category}</p>
            <div className="mt-2 space-y-2">
              {specs.map((spec) => (
                <button
                  key={spec.type}
                  type="button"
                  onClick={() => onAddNode(spec)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-slate-200 hover:border-violet-400"
                >
                  <p className="font-semibold">{spec.label}</p>
                  <p className="text-[10px] text-slate-500">{spec.type}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
