import { Show, For, createResource } from "solid-js";
import { A } from "@solidjs/router";
import { api } from "~/lib/api-client";
import type { Showroom } from "~/lib/api-client";
import { useAuth } from "~/hooks/createAuth";

function statusBadge(status: string) {
  const colors: Record<string, { bg: string; fg: string }> = {
    draft: { bg: "rgba(212,168,83,0.12)", fg: "var(--gold)" },
    active: { bg: "rgba(52,211,153,0.12)", fg: "#34d399" },
  };
  const c = colors[status] || colors.draft;
  return (
    <span
      class="text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.fg }}
    >
      {status}
    </span>
  );
}

export default function ShowroomList() {
  const { user } = useAuth();
  const [showrooms] = createResource(() => api.listShowrooms());
  const isProducer = () => user()?.role === "producer";

  return (
    <div class="max-w-5xl mx-auto px-6 py-12">
      <div class="flex items-end justify-between mb-10 animate-fade-in-up">
        <div>
          <p class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
            Showroom
          </p>
          <h1 class="font-display text-3xl font-bold" style={{ color: "var(--cream)" }}>
            My Showrooms
          </h1>
        </div>
        <Show when={isProducer()}>
          <A href="/showroom/new" class="btn-gold text-sm">+ New Showroom</A>
        </Show>
      </div>

      <div class="divider mb-10" />

      <Show
        when={!showrooms.loading}
        fallback={
          <div class="flex items-center gap-3 py-12">
            <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
            <span class="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</span>
          </div>
        }
      >
        <Show
          when={(showrooms() || []).length > 0}
          fallback={
            <div class="text-center py-20">
              <div class="w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <span class="font-display text-3xl" style={{ color: "var(--border-light)" }}>0</span>
              </div>
              <h2 class="font-display text-2xl font-bold mb-2" style={{ color: "var(--cream)" }}>No showrooms yet</h2>
              <p class="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
                {isProducer() ? "Create a showroom to curate and sell NFTs from multiple artists." : "You haven't been added to any showroom yet."}
              </p>
              <Show when={isProducer()}>
                <A href="/showroom/new" class="btn-gold">Create a Showroom</A>
              </Show>
            </div>
          }
        >
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6 stagger">
            <For each={showrooms()}>
              {(sr: Showroom) => (
                <A href={`/showroom/${sr.id}`} class="card group" style={{ padding: "20px", cursor: "pointer" }}>
                  <div class="flex items-start justify-between mb-3">
                    <h3 class="font-display text-lg font-semibold group-hover:text-gold transition-colors" style={{ color: "var(--cream)" }}>
                      {sr.name}
                    </h3>
                    {statusBadge(sr.status)}
                  </div>
                  <Show when={sr.description}>
                    <p class="text-xs mb-3 line-clamp-2" style={{ color: "var(--text-muted)" }}>{sr.description}</p>
                  </Show>
                  <p class="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    Created {new Date(sr.created_at).toLocaleDateString()}
                  </p>
                </A>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
