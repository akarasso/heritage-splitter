import { Show, For, createResource, createSignal } from "solid-js";
import { A } from "@solidjs/router";
import { api } from "~/lib/api-client";
import { useAuth } from "~/hooks/createAuth";
import ProjectCard from "~/components/project/ProjectCard";

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [projects] = createResource(() => api.listMyProjects());
  const [statusFilter, setStatusFilter] = createSignal("");

  const filtered = () => {
    const all = projects() || [];
    const f = statusFilter();
    if (!f) return all;
    if (f === "active") return all.filter(p => !["closed"].includes(p.status));
    if (f === "inactive") return all.filter(p => ["closed"].includes(p.status));
    return all;
  };

  return (
    <div class="max-w-7xl mx-auto px-6 lg:px-8 py-12">
      {/* Header */}
      <div class="flex items-end justify-between mb-12 animate-fade-in-up">
        <div>
          <p class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
            Dashboard
          </p>
          <h1 class="font-display text-4xl md:text-5xl font-bold" style={{ color: "var(--cream)" }}>
            Hello, <span class="italic" style={{ color: "var(--gold)" }}>{user()?.display_name || "Artist"}</span>
          </h1>
          <Show when={user()?.role}>
            <span class="inline-block mt-2 text-xs px-3 py-1 rounded-full font-medium"
              style={{
                background: user()?.role === "artist" ? "rgba(212,168,83,0.12)" : "rgba(139,92,246,0.12)",
                color: user()?.role === "artist" ? "var(--gold)" : "var(--violet)",
                border: `1px solid ${user()?.role === "artist" ? "rgba(212,168,83,0.3)" : "rgba(139,92,246,0.3)"}`,
              }}>
              {user()?.role === "artist" ? "Artist" : "Producer"}
            </span>
          </Show>
        </div>
        <A href="/projects/new" class="btn-gold text-sm">
          + New project
        </A>
      </div>

      {/* Status filters */}
      <div class="flex items-center gap-2 mb-8">
        <For each={STATUS_FILTERS}>
          {(sf) => (
            <button
              class={`chip ${statusFilter() === sf.key ? "chip-active" : ""}`}
              onClick={() => setStatusFilter(statusFilter() === sf.key ? "" : sf.key)}
            >
              {sf.label}
            </button>
          )}
        </For>
      </div>

      <div class="divider mb-12" />

      {/* Projects */}
      <Show
        when={!projects.loading}
        fallback={
          <div class="flex items-center gap-3 py-12">
            <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
            <span class="text-sm" style={{ color: "var(--text-muted)" }}>Loading projects...</span>
          </div>
        }
      >
        <Show
          when={filtered().length}
          fallback={
            <div class="text-center py-20">
              <div class="w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <span class="font-display text-3xl" style={{ color: "var(--border-light)" }}>0</span>
              </div>
              <h2 class="font-display text-2xl font-bold mb-2" style={{ color: "var(--cream)" }}>
                {statusFilter() ? "No projects in this category" : "No projects"}
              </h2>
              <p class="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
                {statusFilter() ? "Change the filter or create a new project." : "Start by creating your first artistic project."}
              </p>
              <Show when={!statusFilter()}>
                <A href="/projects/new" class="btn-gold">
                  Create a project
                </A>
              </Show>
            </div>
          }
        >
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6 stagger">
            <For each={filtered()}>
              {(project) => <ProjectCard project={project} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
