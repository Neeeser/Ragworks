"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { TelemetrySection } from "@/components/chat-studio/TelemetrySection";

import type { RunSettingsSectionKey } from "@/lib/types";

export interface TelemetrySectionConfig {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  sectionId?: string;
  overrideActive?: boolean;
  content: ReactNode;
}

interface SortableTelemetryItemProps {
  id: RunSettingsSectionKey;
  config: TelemetrySectionConfig;
}

const SortableTelemetryItem = ({ id, config }: SortableTelemetryItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`transition-opacity ${isDragging ? "opacity-40" : ""}`}
    >
      <TelemetrySection
        title={config.title}
        description={config.description}
        icon={config.icon}
        isOpen={config.isOpen}
        onToggle={config.onToggle}
        sectionId={config.sectionId}
        overrideActive={config.overrideActive}
        headerAction={
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`Reorder ${config.title}`}
            title="Drag to reorder"
            {...attributes}
            {...listeners}
            className={`flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-slate-400 transition ${
              isDragging ? "bg-white/10 text-white" : "hover:bg-white/10 hover:text-white"
            } cursor-grab active:cursor-grabbing touch-none`}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        }
        isDragging={isDragging}
      >
        {config.content}
      </TelemetrySection>
    </div>
  );
};

interface SortableSectionListProps {
  sectionOrder: RunSettingsSectionKey[];
  onSectionOrderChange: (order: RunSettingsSectionKey[]) => void;
  sectionConfig: Record<RunSettingsSectionKey, TelemetrySectionConfig>;
}

/** Owns the drag-and-drop machinery (sensors, active-drag state, drag overlay) for
 * reordering the Run settings sections. The panel supplies the per-section config and
 * keeps the composition of which sections exist. */
export const SortableSectionList = ({
  sectionOrder,
  onSectionOrderChange,
  sectionConfig,
}: SortableSectionListProps) => {
  const [activeId, setActiveId] = useState<RunSettingsSectionKey | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as RunSettingsSectionKey);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      if (!event.over || event.active.id === event.over.id) {
        return;
      }
      const activeKey = event.active.id as RunSettingsSectionKey;
      const overKey = event.over.id as RunSettingsSectionKey;
      const oldIndex = sectionOrder.indexOf(activeKey);
      const newIndex = sectionOrder.indexOf(overKey);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }
      onSectionOrderChange(arrayMove(sectionOrder, oldIndex, newIndex));
    },
    [onSectionOrderChange, sectionOrder],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const activeConfig = activeId ? sectionConfig[activeId] : null;

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="relative mt-4 min-h-0 flex-1 overflow-y-auto">
        <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
          <div className="space-y-4 pb-6">
            {sectionOrder.map((key) => (
              <SortableTelemetryItem key={key} id={key} config={sectionConfig[key]} />
            ))}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
          {activeConfig ? (
            <div className="origin-top-left scale-[1.02] shadow-[0_20px_45px_rgba(0,0,0,0.45)]">
              <TelemetrySection
                title={activeConfig.title}
                description={activeConfig.description}
                icon={activeConfig.icon}
                isOpen={activeConfig.isOpen}
                onToggle={activeConfig.onToggle}
                sectionId={activeConfig.sectionId}
                overrideActive={activeConfig.overrideActive}
                headerAction={
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-slate-200">
                    <GripVertical className="h-3.5 w-3.5" />
                  </div>
                }
                isDragging
              >
                {activeConfig.content}
              </TelemetrySection>
            </div>
          ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
};
