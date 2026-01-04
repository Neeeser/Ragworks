"use client";

import { getNodeFamilyLabel, getNodeFamilyStyles, type NodeFamily } from "./pipeline-theme";

import type { NodeSpec } from "@/lib/types";

type PipelineNodeLibraryProps = {
  catalog: Array<{ family: NodeFamily; specs: NodeSpec[] }>;
  onAddNode: (spec: NodeSpec) => void;
};

export function PipelineNodeLibrary({ catalog, onAddNode }: PipelineNodeLibraryProps) {
  return (
    <div className="mt-6 border-t border-white/5 pt-4">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Node library</p>
      <div className="mt-3 space-y-4">
        {catalog.map(({ family, specs }) => {
          const styles = getNodeFamilyStyles(family);
          return (
            <div key={family}>
              <p className={`text-xs uppercase tracking-[0.3em] ${styles.badge}`}>
                {getNodeFamilyLabel(family)}
              </p>
              <div className="mt-2 space-y-2">
                {specs.map((spec) => (
                  <button
                    key={spec.type}
                    type="button"
                    onClick={() => onAddNode(spec)}
                    className={`w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-slate-200 ${styles.border} hover:border-white/60`}
                  >
                    <p className="font-semibold">{spec.label}</p>
                    <p className="text-[10px] text-slate-500">{spec.type}</p>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
