import { createSignal } from "solid-js";
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { api } from "~/lib/api-client";
import { useProject } from "~/lib/project-context";

export default function CollectionNew() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refetchCollections } = useProject();

  const collectionType = () => "nft_collection";

  const [name, setName] = createSignal("");
  const [royaltyBps, setRoyaltyBps] = createSignal(10);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal("");

  async function handleCreate() {
    if (!name().trim()) return;
    setCreating(true);
    setError("");
    try {
      const collection = await api.createCollection(params.id, {
        name: name().trim(),
        collection_type: collectionType(),
        royalty_bps: Math.round(royaltyBps() * 100),
      });
      refetchCollections();
      navigate(`/projects/${params.id}/collections/${collection.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div class="space-y-6">
      <div class="card space-y-5">
        <h2 class="font-display text-xl font-bold" style={{ color: "var(--cream)" }}>
          New NFT collection
        </h2>

        <div>
          <label class="label">Name *</label>
          <input
            class="input w-full"
            placeholder="E.g.: Paris Lights Collection..."
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            autofocus
          />
        </div>

        <div>
          <label class="label">Royalties (%)</label>
          <input
            class="input"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={royaltyBps()}
            onInput={(e) => {
              const v = parseFloat(e.currentTarget.value) || 0;
              setRoyaltyBps(Math.min(100, Math.max(0, v)));
            }}
            style={{ width: "120px" }}
          />
          <p class="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Percentage taken on each secondary resale.
          </p>
        </div>

        {error() && (
          <p class="text-xs" style={{ color: "var(--accent)" }}>{error()}</p>
        )}

        <div class="flex gap-3">
          <button
            class="btn-gold flex-1"
            onClick={handleCreate}
            disabled={creating() || !name().trim()}
          >
            {creating() ? "Creating..." : "Create"}
          </button>
          <button
            class="btn-secondary"
            onClick={() => navigate(`/projects/${params.id}`)}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
