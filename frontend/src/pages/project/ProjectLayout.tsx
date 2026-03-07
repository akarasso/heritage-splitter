import { Show, createResource, createSignal } from "solid-js";
import type { ParentProps } from "solid-js";
import { useParams, A, useLocation } from "@solidjs/router";
import { api } from "~/lib/api-client";
import { useAuth } from "~/hooks/createAuth";
import { ProjectContext } from "~/lib/project-context";
import Breadcrumb from "~/components/ui/Breadcrumb";
import { formatDate, resizeImage, sanitizeImageUrl } from "~/lib/utils";
import { showConfirm, showAlert } from "~/lib/modal-store";

export default function ProjectLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const [project, { refetch }] = createResource(
    () => params.id,
    (id) => api.getProject(id)
  );
  const [works, { refetch: refetchWorks }] = createResource(
    () => params.id,
    (id) => api.listWorks(id)
  );
  const [editingLogo, setEditingLogo] = createSignal(false);
  const [uploadingLogo, setUploadingLogo] = createSignal(false);
  const [closingProject, setClosingProject] = createSignal(false);

  function handleCloseProject() {
    showConfirm({
      title: "Close project",
      message: "You can reopen it later.",
      confirmLabel: "Close",
      onConfirm: async () => {
        setClosingProject(true);
        try {
          await api.closeProject(params.id);
          refetch();
        } catch (e) {
          showAlert({ title: "Error", message: (e as Error).message });
        } finally {
          setClosingProject(false);
        }
      },
    });
  }

  async function handleReopenProject() {
    setClosingProject(true);
    try {
      await api.reopenProject(params.id);
      refetch();
    } catch (e) {
      showAlert({ title: "Error", message: (e as Error).message });
    } finally {
      setClosingProject(false);
    }
  }

  const isCreator = () => project()?.creator_id === user()?.id;

  const isMember = () => {
    const p = project();
    const u = user();
    if (!p || !u) return false;
    if (p.creator_id === u.id) return true;
    return p.participants.some(pt => pt.status === 'accepted' && (pt.user_id === u.id || pt.wallet_address === u.wallet_address));
  };

  const basePath = () => `/projects/${params.id}`;

  const hasNftCollections = () => (works() || []).some(w => w.work_type === "nft_collection");

  // Detect when inside a specific work (not the listing pages)
  const isInsideWork = () => {
    const path = location.pathname;
    const base = basePath() + "/works/";
    if (!path.startsWith(base)) return false;
    const rest = path.slice(base.length);
    // "nft" and "new" are listing pages, not a specific work
    return rest !== "nft" && rest !== "new" && !rest.startsWith("nft/") && !rest.startsWith("new/");
  };

  // Find current work when inside a work
  const currentWork = () => {
    if (!isInsideWork()) return null;
    const workId = params.workId;
    if (!workId) return null;
    return (works() || []).find(w => w.id === workId) || null;
  };

  const currentWorkType = () => currentWork()?.work_type || null;

  const tabs = () => {
    const base = [
      { label: "Overview", path: "", memberOnly: false, creatorOnly: false },
      { label: "Discussion", path: "/discussion", memberOnly: true, creatorOnly: false },
      { label: "Documents", path: "/documents", memberOnly: true, creatorOnly: false },
      { label: "Activity", path: "/activity", memberOnly: true, creatorOnly: false },
    ];

    if (hasNftCollections()) {
      base.push({ label: "Collections NFT", path: "/works/nft", memberOnly: false, creatorOnly: false });
    }

    return base.filter(t => {
      if (t.creatorOnly && !isCreator()) return false;
      if (t.memberOnly && !isMember()) return false;
      return true;
    });
  };

  const isActive = (tabPath: string) => {
    const current = location.pathname;
    const full = basePath() + tabPath;
    if (tabPath === "") {
      return current === full || current === full + "/";
    }
    // When inside a specific work, highlight the parent collection tab
    if (isInsideWork()) {
      const wt = currentWorkType();
      if (tabPath === "/works/nft" && wt === "nft_collection") return true;
      return false;
    }
    return current.startsWith(full);
  };

  async function handleLogoUpload(e: Event) {
    if (uploadingLogo()) return;
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const dataUrl = await resizeImage(file, 512, 0.8);
      await api.updateProject(params.id, { logo_url: dataUrl } as Partial<import("~/lib/api-client").Project>);
      refetch();
      setEditingLogo(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showAlert({ title: "Error", message: msg });
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <div class="max-w-6xl mx-auto px-6 lg:px-8 py-12">
      <Show
        when={project()}
        fallback={
          <div class="flex items-center gap-3 py-12">
            <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
            <span class="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</span>
          </div>
        }
      >
        {(p) => (
          <>
            {/* Breadcrumb */}
            <Breadcrumb items={
              isInsideWork() && currentWork()
                ? [
                    { label: "Projects", href: "/dashboard" },
                    { label: p().name, href: basePath() },
                    { label: currentWork()!.name },
                  ]
                : [
                    { label: "Projects", href: "/dashboard" },
                    { label: p().name },
                  ]
            } />
              <div class="flex items-start justify-between gap-4 mb-6 animate-fade-in-up">
                <div class="flex items-start gap-5 min-w-0 flex-1">
                  {/* Project logo */}
                  <div class="relative group shrink-0">
                    {p().logo_url ? (
                      <img src={sanitizeImageUrl(p().logo_url)} alt={`${p().name} logo`} class="w-16 h-16 rounded-xl object-cover" style={{ border: "1px solid var(--border)" }} />
                    ) : (
                      <div
                        class="w-16 h-16 rounded-xl flex items-center justify-center font-display text-2xl font-bold"
                        style={{ background: "var(--surface-light)", color: "var(--gold)", border: "1px solid var(--border)" }}
                      >
                        {p().name[0]?.toUpperCase() || "P"}
                      </div>
                    )}
                    <Show when={isCreator()}>
                      <button
                        class="absolute inset-0 flex items-center justify-center rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: "rgba(0,0,0,0.6)" }}
                        onClick={() => setEditingLogo(true)}
                      >
                        <svg class="w-5 h-5" style={{ color: "var(--cream)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                        </svg>
                      </button>
                    </Show>
                  </div>

                  <div>
                    <div class="flex items-center gap-4 mb-3 min-w-0">
                      <h1 class="font-display text-4xl md:text-5xl font-bold truncate" style={{ color: "var(--cream)" }}>
                        {p().name}
                      </h1>
                    </div>
                    <p class="text-sm leading-relaxed max-w-2xl mb-3" style={{ color: "var(--cream-muted)" }}>
                      {p().description}
                    </p>
                    <div class="flex items-center gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
                      <span>Created on {formatDate(p().created_at)}</span>
                      <Show when={p().completed_at}>
                        <span style={{ color: "var(--border-light)" }}>|</span>
                        <span>Deployed on {formatDate(p().completed_at!)}</span>
                      </Show>
                      <Show when={p().status === "closed"}>
                        <span style={{ color: "var(--border-light)" }}>|</span>
                        <span style={{ color: "var(--text-muted)" }}>Closed</span>
                      </Show>
                    </div>
                  </div>
                </div>

                {/* Close / Reopen button */}
                <Show when={isCreator()}>
                  <Show when={p().status !== "closed"} fallback={
                    <button
                      class="btn-gold shrink-0 whitespace-nowrap"
                      onClick={handleReopenProject}
                      disabled={closingProject()}
                    >
                      {closingProject() ? "..." : "Reopen"}
                    </button>
                  }>
                    <button
                      class="btn-secondary shrink-0 whitespace-nowrap"
                      onClick={handleCloseProject}
                      disabled={closingProject()}
                    >
                      {closingProject() ? "..." : "Close project"}
                    </button>
                  </Show>
                </Show>
              </div>

              {/* Logo upload modal */}
              <Show when={editingLogo()}>
                <div class="card mb-6">
                  <div class="flex items-center justify-between mb-4">
                    <span class="label">Project logo</span>
                    <button class="btn-secondary text-xs" style={{ padding: "4px 12px" }} onClick={() => setEditingLogo(false)}>Close</button>
                  </div>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload}
                    class="text-sm" style={{ color: "var(--cream-muted)" }} />
                  <p class="text-xs mt-2" style={{ color: "var(--text-muted)" }}>PNG, JPG or WebP</p>
                </div>
              </Show>

              {/* Deployed contracts */}
              <Show when={p().contract_nft_address}>
                <div class="card-glow mb-6">
                  <div class="flex items-center gap-2 mb-4">
                    <div class="w-2 h-2 rounded-full" style={{ background: "var(--emerald)" }} />
                    <h3 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--emerald)" }}>
                      Deployed contracts
                    </h3>
                  </div>
                  <div class="space-y-3">
                    <div class="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--noir-light)" }}>
                      <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>NFT</span>
                      <code class="text-sm font-mono" style={{ color: "var(--emerald)" }}>{p().contract_nft_address}</code>
                    </div>
                    <div class="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--noir-light)" }}>
                      <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Splitter</span>
                      <code class="text-sm font-mono" style={{ color: "var(--emerald)" }}>{p().contract_splitter_address}</code>
                    </div>
                  </div>
                </div>
              </Show>

              {/* Tab navigation — hidden when inside a specific work */}
              <Show when={!isInsideWork()}>
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
              </Show>

            {/* Sub-page content */}
            <ProjectContext.Provider value={{ project, refetch, user, isCreator, isMember, works, refetchWorks }}>
              {props.children}
            </ProjectContext.Provider>
          </>
        )}
      </Show>
    </div>
  );
}
