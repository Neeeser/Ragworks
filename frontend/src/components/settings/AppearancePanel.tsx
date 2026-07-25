"use client";

import { CustomSelect } from "@/components/ui/custom-select";
import { Field } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { palettesForMode } from "@/lib/palettes";
import { useTheme } from "@/providers/theme-provider";

import type { PaletteDefinition, PaletteMode } from "@/lib/palettes";
import type { ThemePreference } from "@/providers/theme-provider";

const MODE_OPTIONS: Array<{ id: ThemePreference; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** The palette's own canvas and card colours as the option's leading visual. */
function PaletteSwatch({ palette }: { palette: PaletteDefinition }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 overflow-hidden rounded-[3px] border border-hairline"
    >
      <span className="h-3.5 w-3.5" style={{ backgroundColor: palette.swatch.canvas }} />
      <span className="h-3.5 w-3.5" style={{ backgroundColor: palette.swatch.panel }} />
    </span>
  );
}

function paletteOptions(mode: PaletteMode) {
  return palettesForMode(mode).map((palette) => ({
    value: palette.id,
    label: palette.label,
    icon: <PaletteSwatch palette={palette} />,
  }));
}

/**
 * Theme mode and the palette applied in each mode. Preferences are stored in
 * this browser (localStorage), matching how the theme itself has always been
 * stored — they follow the device, not the account.
 */
export function AppearancePanel() {
  const { theme, resolvedTheme, palettes, setTheme, setPalette } = useTheme();

  return (
    <Panel>
      <PanelHeader
        id="appearance-heading"
        title="Appearance"
        end={<InstrumentLabel>Stored in this browser</InstrumentLabel>}
      />
      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <span className="block text-instrument font-medium text-muted">Mode</span>
          <SegmentedControl
            aria-label="Theme mode"
            options={MODE_OPTIONS}
            value={theme}
            onChange={setTheme}
          />
        </div>
        <Field
          label="Dark palette"
          labelEnd={
            resolvedTheme === "dark" ? <InstrumentLabel>In use</InstrumentLabel> : undefined
          }
        >
          <CustomSelect
            value={palettes.dark}
            options={paletteOptions("dark")}
            placeholder="Palette"
            onValueChange={(palette) => setPalette("dark", palette)}
          />
        </Field>
        <Field
          label="Light palette"
          labelEnd={
            resolvedTheme === "light" ? <InstrumentLabel>In use</InstrumentLabel> : undefined
          }
        >
          <CustomSelect
            value={palettes.light}
            options={paletteOptions("light")}
            placeholder="Palette"
            onValueChange={(palette) => setPalette("light", palette)}
          />
        </Field>
      </div>
    </Panel>
  );
}
