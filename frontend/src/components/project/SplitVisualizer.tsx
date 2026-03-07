import { For, createResource } from "solid-js";
import type { AllocationDetail, PublicUser } from "~/lib/api-client";
import { api } from "~/lib/api-client";
import { bpsToPercent, ROLE_LABELS } from "~/lib/utils";

// Per-person color palette (larger, distinct colors)
const PERSON_COLORS = [
  "var(--accent)",   // red
  "var(--emerald)",  // green
  "var(--violet)",   // purple
  "#06B6D4",         // cyan
  "#EC4899",         // pink
  "#F59E0B",         // amber
  "#84CC16",         // lime
  "#8B5CF6",         // violet-500
  "#F97316",         // orange
  "#14B8A6",         // teal
  "#E11D48",         // rose-600
  "#2563EB",         // blue-600
  "#A855F7",         // purple-500
  "#0EA5E9",         // sky-500
  "#65A30D",         // lime-600
  "#DC2626",         // red-600
];

// Allocation-level colors (for hatched unassigned segments)
const ALLOC_COLORS = [
  "var(--accent)", "var(--gold)", "var(--emerald)", "var(--violet)",
  "#EC4899", "#06B6D4", "#F59E0B", "#84CC16",
];

const CREATOR_COLOR = "#d4a853";

interface BarSegment {
  key: string;
  bps: number;
  color: string;
  hatched: boolean;
}

interface LegendEntry {
  key: string;
  name: string;
  bps: number;
  color: string;
  hatched: boolean;
}

export default function SplitVisualizer(props: {
  allocations: AllocationDetail[];
  creatorSharesBps: number;
  creatorName?: string;
}) {
  // Resolve display names
  const [usersMap] = createResource(async () => {
    try {
      const users = await api.listUsers();
      const map: Record<string, PublicUser> = {};
      for (const u of users) map[u.id] = u;
      return map;
    } catch { return {}; }
  });

  const getName = (userId: string | null) => {
    const map = usersMap();
    if (map && userId && map[userId]) return map[userId].display_name;
    return "Participant";
  };

  // Build segments: one per individual person + unassigned hatched
  // Each person gets a unique color from PERSON_COLORS
  const segments = (): BarSegment[] => {
    const result: BarSegment[] = [];
    let personIdx = 0;
    props.allocations.forEach((alloc, i) => {
      const allocColor = ALLOC_COLORS[i % ALLOC_COLORS.length];
      const active = alloc.participants.filter(p => p.status !== "rejected" && p.status !== "requested");

      // Individual participant segments — each gets a unique color
      for (const p of active) {
        const bps = p.shares_bps > 0 ? p.shares_bps : (alloc.distribution_mode === "equal" && active.length > 0 ? Math.floor(alloc.total_bps / active.length) : 0);
        if (bps > 0) {
          result.push({ key: `p-${p.id}`, bps, color: PERSON_COLORS[personIdx % PERSON_COLORS.length], hatched: false });
        }
        personIdx++;
      }

      // Unassigned portion (hatched) — uses allocation color
      const assignedBps = active.reduce((sum, p) => {
        if (p.shares_bps > 0) return sum + p.shares_bps;
        if (alloc.distribution_mode === "equal" && active.length > 0) return sum + Math.floor(alloc.total_bps / active.length);
        return sum;
      }, 0);
      const unassignedBps = alloc.total_bps - assignedBps;
      if (unassignedBps > 0) {
        result.push({ key: `u-${alloc.id}`, bps: unassignedBps, color: allocColor, hatched: true });
      }
    });

    // Creator segment
    if (props.creatorSharesBps > 0) {
      result.push({ key: "creator", bps: props.creatorSharesBps, color: CREATOR_COLOR, hatched: false });
    }

    return result;
  };

  // Build legend entries: one per person + unassigned per alloc + creator
  const legendEntries = (): LegendEntry[] => {
    const result: LegendEntry[] = [];
    let personIdx = 0;
    props.allocations.forEach((alloc, i) => {
      const allocColor = ALLOC_COLORS[i % ALLOC_COLORS.length];
      const active = alloc.participants.filter(p => p.status !== "rejected" && p.status !== "requested");

      for (const p of active) {
        const bps = p.shares_bps > 0 ? p.shares_bps : (alloc.distribution_mode === "equal" && active.length > 0 ? Math.floor(alloc.total_bps / active.length) : 0);
        result.push({
          key: `p-${p.id}`,
          name: getName(p.user_id),
          bps,
          color: PERSON_COLORS[personIdx % PERSON_COLORS.length],
          hatched: false,
        });
        personIdx++;
      }

      const assignedBps = active.reduce((sum, p) => {
        if (p.shares_bps > 0) return sum + p.shares_bps;
        if (alloc.distribution_mode === "equal" && active.length > 0) return sum + Math.floor(alloc.total_bps / active.length);
        return sum;
      }, 0);
      const unassignedBps = alloc.total_bps - assignedBps;
      if (unassignedBps > 0) {
        result.push({
          key: `u-${alloc.id}`,
          name: `${alloc.label || ROLE_LABELS[alloc.role] || alloc.role} — Unassigned`,
          bps: unassignedBps,
          color: allocColor,
          hatched: true,
        });
      }
    });

    if (props.creatorSharesBps > 0) {
      result.push({
        key: "creator",
        name: `${props.creatorName || "Creator"} (you)`,
        bps: props.creatorSharesBps,
        color: CREATOR_COLOR,
        hatched: false,
      });
    }

    return result;
  };

  // Generate a unique pattern ID per hatched segment color
  const patternId = (color: string) => `hatch-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  // Extract unique colors used in hatched segments for SVG defs
  const hatchedColors = (): string[] => {
    const colors = new Set<string>();
    for (const seg of segments()) {
      if (seg.hatched) colors.add(seg.color);
    }
    return [...colors];
  };

  return (
    <div class="card">
      <h3 class="text-xs font-medium tracking-widest uppercase mb-6" style={{ color: "var(--text-muted)" }}>
        Royalty distribution
      </h3>

      {/* SVG defs for hatch patterns */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <For each={hatchedColors()}>
            {(color) => (
              <pattern
                id={patternId(color)}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill={`${color}15`} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={color} stroke-width="2" opacity="0.4" />
              </pattern>
            )}
          </For>
        </defs>
      </svg>

      {/* Bar chart */}
      <div class="flex h-10 rounded-xl overflow-hidden mb-8" style={{ background: "var(--noir-light)" }}>
        <For each={segments()}>
          {(seg) => (
            <div
              class="flex items-center justify-center text-xs font-bold transition-all"
              style={{
                width: `${seg.bps / 100}%`,
                "background-color": seg.hatched ? undefined : seg.color,
                background: seg.hatched ? `url(#${patternId(seg.color)})` : undefined,
                color: seg.color === "var(--gold)" || seg.color === CREATOR_COLOR ? "var(--noir)" : "white",
              }}
            >
              {seg.bps >= 500 ? bpsToPercent(seg.bps) : ""}
            </div>
          )}
        </For>
      </div>

      {/* Legend - individual persons */}
      <div class="space-y-2.5">
        <For each={legendEntries()}>
          {(entry) => (
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div
                  class="w-3 h-3 rounded-sm shrink-0"
                  style={{
                    "background-color": entry.hatched ? undefined : entry.color,
                    background: entry.hatched
                      ? `repeating-linear-gradient(45deg, ${entry.color}20, ${entry.color}20 2px, ${entry.color}50 2px, ${entry.color}50 4px)`
                      : undefined,
                    border: entry.hatched ? `1px solid ${entry.color}60` : undefined,
                  }}
                />
                <span
                  class="text-sm"
                  style={{
                    color: entry.key === "creator" ? "var(--gold)" : "var(--cream)",
                    "font-style": entry.hatched ? "italic" : "normal",
                  }}
                >
                  {entry.name}
                </span>
              </div>
              <span
                class="text-sm font-bold font-mono"
                style={{ color: entry.key === "creator" ? "var(--gold)" : "var(--cream)" }}
              >
                {bpsToPercent(entry.bps)}
              </span>
            </div>
          )}
        </For>
      </div>

      {/* Total */}
      <div class="divider mt-5 mb-4" />
      <div class="flex justify-between items-center">
        <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Total</span>
        <span
          class="text-sm font-bold font-mono"
          style={{ color: "var(--emerald)" }}
        >
          100%
          {props.creatorSharesBps > 0 && ` (${bpsToPercent(props.creatorSharesBps)} creator)`}
        </span>
      </div>
    </div>
  );
}
