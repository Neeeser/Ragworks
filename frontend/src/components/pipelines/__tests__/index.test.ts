import { describe, expect, it } from "vitest";

import * as pipelines from "@/components/pipelines";

describe("pipelines index", () => {
  it("exports pipeline components and utilities", () => {
    expect(pipelines.PipelineBuilder).toBeDefined();
    expect(pipelines.PipelineCanvas).toBeDefined();
    expect(pipelines.PipelineCatalog).toBeDefined();
    expect(pipelines.PipelineHeader).toBeDefined();
    expect(pipelines.PipelineInspector).toBeDefined();
    expect(pipelines.PipelineNode).toBeDefined();
    expect(pipelines.pipelineNodeTypes).toBeDefined();
    expect(pipelines.PipelineNodeLibrary).toBeDefined();
    expect(pipelines.PipelineNotice).toBeDefined();
    expect(pipelines.PipelineRevisions).toBeDefined();
    expect(pipelines.PipelineSavePanel).toBeDefined();
    expect(pipelines.PipelineSidebar).toBeDefined();
    expect(pipelines.buildDefaultDefinition).toBeDefined();
  });
});
