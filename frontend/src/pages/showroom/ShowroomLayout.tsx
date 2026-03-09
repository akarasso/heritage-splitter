import { createResource, createSignal, Show } from "solid-js";
import type { ParentProps } from "solid-js";
import { useParams, A, useLocation } from "@solidjs/router";
import { api } from "~/lib/api-client";
import { useAuth } from "~/hooks/createAuth";
import { ShowroomContext } from "~/lib/showroom-context";
import type { ShowroomParticipantDetail } from "~/lib/api-client";

export default function ShowroomLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const [showroom, { refetch }] = createResource(() => params.id, (id) => api.getShowroom(id));
  const [deploying, setDeploying] = createSignal(false);

  const isOwner = () => showroom()?.creator_id === user()?.id;

  const isMember = () => {
    const sr = showroom();
    const u = user();
    if (!sr || !u) return false;
    if (sr.creator_id === u.id) return true;
    return sr.participants.some(
      (p: ShowroomParticipantDetail) => p.user_id === u.id && p.status === "accepted"
    );
  };

  const basePath = () => `/showroom/${params.id}`;

  const tabs = () => {
    const base = [
      { label: "Overview", path: "" },
    ];
    if (isOwner()) {
      base.push({ label: "Listings", path: "/listings" });
    }
    base.push({ label: "Documents", path: "/documents" });
    if (isOwner() && showroom()?.contract_address) {
      base.push({ label: "Integration", path: "/integration" });
    }
    return base;
  };

  const isActive = (tabPath: string) => {
    const current = location.pathname;
    const full = basePath() + tabPath;
    if (tabPath === "") return current === full || current === full + "/";
    return current.startsWith(full);
  };

  async function handleDeploy() {
    const sr = showroom();
    if (!sr) return;
    setDeploying(true);
    try { await api.deployShowroom(sr.id); refetch(); } catch (err) { if (import.meta.env.DEV) console.error("Deploy failed:", err); } finally { setDeploying(false); }
  }


  return (
    <div class="max-w-5xl mx-auto px-6 py-12">
      <Show
        when={showroom()}
        fallback={
          <div class="flex items-center gap-3 py-12">
            <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
            <span class="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</span>
          </div>
        }
      >
        {(sr) => (
          <>
            {/* Header */}
            <div class="flex items-start justify-between mb-6">
              <div>
                <A href="/showroom" class="text-xs mb-3 inline-block" style={{ color: "var(--text-muted)" }}>
                  &larr; Back to Showrooms
                </A>
                <h1 class="font-display text-3xl font-bold" style={{ color: "var(--cream)" }}>
                  {sr().name}
                </h1>
                <Show when={sr().description}>
                  <p class="text-sm mt-2" style={{ color: "var(--text-muted)" }}>{sr().description}</p>
                </Show>
                <div class="flex items-center gap-3 mt-3">
                  <span
                    class="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{
                      background: sr().status === "active" ? "rgba(52,211,153,0.12)" : "rgba(212,168,83,0.12)",
                      color: sr().status === "active" ? "#34d399" : "var(--gold)",
                    }}
                  >
                    {sr().status}
                  </span>
                  <Show when={sr().contract_address}>
                    <span class="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                      {sr().contract_address}
                    </span>
                  </Show>
                </div>
              </div>
              {/* Deploy button — right of title, owner only, draft only */}
              <Show when={isOwner() && sr().status === "draft"}>
                <button class="btn-gold text-sm shrink-0 mt-6" onClick={handleDeploy} disabled={deploying()}>
                  {deploying() ? "Deploying..." : "Deploy Showroom"}
                </button>
              </Show>
            </div>

            {/* Tab navigation */}
            <nav class="flex gap-1 mb-8 p-1 rounded-xl" style={{ background: "var(--surface-light)" }}>
              {tabs().map((tab) => (
                <A
                  href={basePath() + tab.path}
                  class="px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    color: isActive(tab.path) ? "var(--cream)" : "var(--text-muted)",
                    background: isActive(tab.path) ? "var(--noir-light)" : "transparent",
                  }}
                >
                  {tab.label}
                </A>
              ))}
            </nav>

            {/* Sub-page content */}
            <ShowroomContext.Provider value={{ showroom, refetch, user, isOwner, isMember }}>
              {props.children}
            </ShowroomContext.Provider>
          </>
        )}
      </Show>
    </div>
  );
}
