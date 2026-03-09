import { Show, For } from "solid-js";
import { A, useParams, useNavigate } from "@solidjs/router";
import { useProject } from "~/lib/project-context";

export default function ProjectCollections() {
  const params = useParams();
  const navigate = useNavigate();
  const { collections, isCreator } = useProject();

  const nftCollections = () => (collections() || []).filter(w => w.collection_type === "nft_collection");

  const statusLabel = (status: string) => {
    switch (status) {
      case "deployed": return "Deployed";
      case "approved": return "Approved";
      case "pending_approval": return "Pending";
      default: return "Draft";
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "deployed": return "var(--emerald)";
      case "approved": return "var(--emerald)";
      case "pending_approval": return "var(--violet)";
      default: return "var(--gold)";
    }
  };

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
          Collections NFT ({nftCollections().length})
        </h3>
        <Show when={isCreator()}>
          <button
            class="btn-secondary text-xs"
            onClick={() => navigate(`/projects/${params.id}/collections/new?type=nft_collection`)}
          >
            + Create a collection
          </button>
        </Show>
      </div>

      <Show when={nftCollections().length > 0} fallback={
        <div class="card text-center py-8">
          <p class="text-sm" style={{ color: "var(--text-muted)" }}>
            No NFT collections.
          </p>
        </div>
      }>
        <div class="space-y-3">
          <For each={nftCollections()}>
            {(w) => (
              <A
                href={`/projects/${params.id}/collections/${w.id}`}
                class="card flex items-center justify-between transition-all hover:opacity-80"
              >
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(139,92,246,0.15)" }}>
                    <svg class="w-5 h-5" style={{ color: "var(--violet)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                    </svg>
                  </div>
                  <div>
                    <span class="text-sm font-semibold" style={{ color: "var(--cream)" }}>{w.name}</span>
                    <div class="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      Royalties: {w.royalty_bps / 100}%
                    </div>
                  </div>
                </div>
                <span
                  class="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{
                    color: statusColor(w.status),
                    background: `${statusColor(w.status)}15`,
                    border: `1px solid ${statusColor(w.status)}30`,
                  }}
                >
                  {statusLabel(w.status)}
                </span>
              </A>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
