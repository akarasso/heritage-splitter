import { Show, For, createSignal, createEffect, createResource } from "solid-js";
import { createPublicClient, http } from "viem";
import { avalancheFuji } from "viem/chains";
import { useWork } from "~/lib/work-context";
import { api } from "~/lib/api-client";
import type { DraftNft, Nft, PublicUser } from "~/lib/api-client";
import { showAlert, showConfirm } from "~/lib/modal-store";
import { sanitizeImageUrl } from "~/lib/utils";

type NftOrDraft = Nft | DraftNft;

function isMintedNft(nft: NftOrDraft): nft is Nft {
  return "token_id" in nft;
}

function safeParseAttrs(raw: string): { key: string; value: string }[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("[WorkNfts] Failed to parse attributes:", e instanceof Error ? e.message : "parse error");
    return [];
  }
}

function getArtistFromAttrs(raw: string): string {
  const attrs = safeParseAttrs(raw);
  return attrs.find(a => a.key === "Artist")?.value || "";
}

const MAX_ATTR_KEY_LENGTH = 50;
const MAX_ATTR_VALUE_LENGTH = 200;

const NFT_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const RESERVED_ATTRIBUTES = ["title", "name", "description", "image", "artist", "price", "token_id", "metadata_uri"];

export default function WorkNfts() {
  const { work, refetch, isCreator } = useWork();
  const [editing, setEditing] = createSignal<DraftNft | null>(null);
  const [showForm, setShowForm] = createSignal(false);
  const [minting, setMinting] = createSignal(false);
  const [mintingId, setMintingId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [detailNft, setDetailNft] = createSignal<Nft | DraftNft | null>(null);

  // Resolve user display names for artist selection
  const [usersMap] = createResource(async () => {
    try {
      const users = await api.listUsers();
      const map: Record<string, PublicUser> = {};
      for (const u of users) map[u.id] = u;
      return map;
    } catch { return {}; }
  });

  // Get artist participants from work allocations
  const artistParticipants = () => {
    const w = work();
    if (!w) return [];
    const map = usersMap() || {};
    const artists: { userId: string; name: string }[] = [];
    for (const alloc of w.allocations) {
      if (alloc.role !== "artist") continue;
      for (const p of alloc.participants) {
        if (p.status === "rejected" || p.status === "kicked") continue;
        const user = p.user_id ? map[p.user_id] : null;
        const name = user?.display_name || p.wallet_address.slice(0, 10) + "...";
        artists.push({ userId: p.user_id || p.wallet_address, name });
      }
    }
    return artists;
  };

  // Form state
  const [formTitle, setFormTitle] = createSignal("");
  const [formDescription, setFormDescription] = createSignal("");
  const [formSelectedArtists, setFormSelectedArtists] = createSignal<string[]>([]);
  const [formPrice, setFormPrice] = createSignal("");
  const [formImageUrl, setFormImageUrl] = createSignal("");
  const [formMetadataUri, setFormMetadataUri] = createSignal("");
  const [formAttributes, setFormAttributes] = createSignal<{ key: string; value: string }[]>([]);
  const [attrError, setAttrError] = createSignal("");

  function resetForm() {
    setFormTitle("");
    setFormDescription("");
    setFormSelectedArtists([]);
    setFormPrice("");
    setFormImageUrl("");
    setFormMetadataUri("");
    setFormAttributes([]);
    setAttrError("");
    setEditing(null);
    setShowForm(false);
  }

  function openNewForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(draft: DraftNft) {
    setFormTitle(draft.title);
    setFormDescription(draft.description);
    setFormPrice(draft.price);
    setFormImageUrl(draft.image_url);
    setFormMetadataUri(draft.metadata_uri);
    // Parse artist names from attributes to pre-select them
    const attrs = safeParseAttrs(draft.attributes);
    const artistAttr = attrs.find(a => a.key === "Artist");
    if (artistAttr) {
      const names = artistAttr.value.split(", ").map(n => n.trim());
      const available = artistParticipants();
      setFormSelectedArtists(available.filter(a => names.includes(a.name)).map(a => a.userId));
    } else {
      setFormSelectedArtists([]);
    }
    setFormAttributes(attrs.filter(a => a.key !== "Artist"));
    setEditing(draft);
    setShowForm(true);
  }

  function handleImageUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showAlert({ title: "Image too large", message: "Maximum file size is 10 MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFormImageUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  function addAttribute() {
    setFormAttributes([...formAttributes(), { key: "", value: "" }]);
  }

  function updateAttribute(index: number, field: "key" | "value", val: string) {
    const maxLen = field === "key" ? MAX_ATTR_KEY_LENGTH : MAX_ATTR_VALUE_LENGTH;
    const stripped = val.replace(/<[^>]*>/g, "");
    const sanitized = stripped.slice(0, maxLen);
    if (stripped.length > maxLen) {
      setAttrError(`${field === "key" ? "Key" : "Value"} truncated to ${maxLen} characters`);
    }
    if (field === "key" && RESERVED_ATTRIBUTES.includes(sanitized.toLowerCase().trim())) {
      setAttrError(`"${sanitized}" is a reserved system attribute`);
      return;
    }
    setAttrError("");
    const attrs = [...formAttributes()];
    attrs[index] = { ...attrs[index], [field]: sanitized };
    setFormAttributes(attrs);
  }

  function removeAttribute(index: number) {
    setFormAttributes(formAttributes().filter((_, i) => i !== index));
  }

  async function handleSaveDraft() {
    const w = work();
    if (!w || !formTitle().trim()) return;

    setSaving(true);
    setError("");
    try {
      // Build attributes: user-defined + auto Artist from selection
      const userAttrs = formAttributes().filter(a => a.key.trim());
      const selected = formSelectedArtists();
      const available = artistParticipants();
      const artistNames = selected
        .map(id => available.find(a => a.userId === id)?.name)
        .filter(Boolean)
        .join(", ");
      const allAttrs = artistNames
        ? [{ key: "Artist", value: artistNames }, ...userAttrs]
        : userAttrs;
      const attrs = JSON.stringify(allAttrs);
      const editDraft = editing();

      if (editDraft) {
        await api.updateDraftNft(editDraft.id, {
          title: formTitle().trim(),
          description: formDescription().trim(),
          price: formPrice().trim(),
          image_url: formImageUrl(),
          metadata_uri: formMetadataUri().trim(),
          attributes: attrs,
        });
      } else {
        await api.createDraftNft(w.id, {
          title: formTitle().trim(),
          description: formDescription().trim(),
          price: formPrice().trim(),
          image_url: formImageUrl(),
          metadata_uri: formMetadataUri().trim(),
          attributes: attrs,
        });
      }
      resetForm();
      refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteDraft(id: string) {
    showConfirm({
      title: "Delete draft",
      message: "Delete this NFT from the draft?",
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: async () => {
        try {
          await api.deleteDraftNft(id);
          refetch();
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  }

  async function handleMintSingle(draft: DraftNft) {
    const w = work();
    if (!w) return;
    setMintingId(draft.id);
    setError("");
    try {
      await api.mintWorkNft(w.id, {
        title: draft.title,
        metadata_uri: draft.metadata_uri || `ipfs://${draft.title.replace(/\s+/g, "-").toLowerCase()}`,
      });
      refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMintingId(null);
    }
  }

  async function handleMintAll() {
    const w = work();
    if (!w) return;
    const drafts = w.draft_nfts || [];
    if (drafts.length === 0) return;
    setMinting(true);
    setError("");
    try {
      for (const draft of drafts) {
        await api.mintWorkNft(w.id, {
          title: draft.title,
          metadata_uri: draft.metadata_uri || `ipfs://${draft.title.replace(/\s+/g, "-").toLowerCase()}`,
        });
      }
      refetch();
    } catch (e) {
      setError((e as Error).message);
      refetch();
    } finally {
      setMinting(false);
    }
  }

  const isDraft = () => work()?.status === "draft";
  const isDeployed = () => work()?.status === "deployed";
  const isMintReady = () => work()?.status === "mint_ready";
  const isPendingApproval = () => work()?.status === "pending_approval";
  const isPendingMintApproval = () => work()?.status === "pending_mint_approval";
  const isApproved = () => work()?.status === "approved";
  const isReadyToDeploy = () => work()?.status === "ready_to_deploy";
  const canEdit = () => isDraft() || isPendingApproval() || isApproved() || isDeployed();
  const canAddNft = () => isDraft() || isPendingApproval() || isApproved() || isDeployed();
  const mintedNfts = () => work()?.nfts || [];
  const drafts = () => work()?.draft_nfts || [];

  // On-chain ownership check: tokenId → buyer address (absent = still in vault = for sale)
  const [soldMap, setSoldMap] = createSignal<Record<number, string>>({});

  async function checkOwnership() {
    const w = work();
    if (!w?.contract_nft_address || !w?.contract_vault_address) return;
    const nfts = w.nfts || [];
    if (nfts.length === 0) return;

    try {
      const publicClient = createPublicClient({ chain: avalancheFuji, transport: http() });
      const nftAddress = w.contract_nft_address as `0x${string}`;
      if (!w.contract_vault_address) return;
      const vaultAddr = w.contract_vault_address.toLowerCase();
      const map: Record<number, string> = {};

      const results = await Promise.allSettled(
        nfts.map(async (nft) => {
          const owner = await publicClient.readContract({
            address: nftAddress,
            abi: NFT_ABI,
            functionName: "ownerOf",
            args: [BigInt(nft.token_id)],
          });
          return { tokenId: nft.token_id, owner: owner as string };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value.owner.toLowerCase() !== vaultAddr) {
          map[r.value.tokenId] = r.value.owner;
        }
      }
      setSoldMap(map);
    } catch (e) {
      console.error("Ownership check failed:", e instanceof Error ? e.message : "Unknown error");
    }
  }

  // Re-check when work data changes (nfts list or contract addresses)
  createEffect(() => {
    if (work()?.contract_nft_address && (work()?.nfts?.length || 0) > 0) {
      checkOwnership();
    }
  });

  const isSold = (tokenId: number) => tokenId in soldMap();
  const soldCount = () => mintedNfts().filter(n => isSold(n.token_id)).length;
  const availableCount = () => mintedNfts().length - soldCount();

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
            NFTs
          </h3>
          <div class="flex items-center gap-3 mt-1">
            <Show when={drafts().length > 0}>
              <span class="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(212,168,83,0.1)", color: "var(--text-muted)", border: "1px solid rgba(212,168,83,0.2)" }}>
                {drafts().length} not minted
              </span>
            </Show>
            <Show when={mintedNfts().length > 0}>
              <span class="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(52,211,153,0.1)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.2)" }}>
                {availableCount()} for sale
              </span>
            </Show>
            <Show when={soldCount() > 0}>
              <span class="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(255,59,63,0.1)", color: "var(--accent)", border: "1px solid rgba(255,59,63,0.2)" }}>
                {soldCount()} sold
              </span>
            </Show>
          </div>
        </div>
        <Show when={isCreator()}>
          <div class="flex items-center gap-2">
            <Show when={isMintReady() && drafts().length > 0}>
              <button class="btn-gold text-xs" onClick={handleMintAll} disabled={minting()}>
                {minting() ? "Minting..." : `Mint all (${drafts().length})`}
              </button>
            </Show>
            <Show when={canAddNft()}>
              <button class="btn-secondary text-xs" onClick={openNewForm}>
                + Add an NFT
              </button>
            </Show>
          </div>
        </Show>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div class="p-3 rounded-lg text-xs" style={{ background: "rgba(255,59,63,0.08)", color: "var(--accent)", border: "1px solid rgba(255,59,63,0.2)" }}>
          {error()}
        </div>
      </Show>

      {/* Info banner for pending states */}
      <Show when={isPendingApproval() || isApproved()}>
        <div class="flex items-center gap-3 p-3 rounded-lg text-xs"
          style={{ background: "rgba(139,92,246,0.08)", color: "var(--violet)", border: "1px solid rgba(139,92,246,0.2)" }}>
          <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          Any modification will cancel approvals and revert to draft.
        </div>
      </Show>
      <Show when={isReadyToDeploy()}>
        <div class="flex items-center gap-3 p-3 rounded-lg text-xs"
          style={{ background: "rgba(52,211,153,0.08)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.2)" }}>
          <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          Approval validated. NFTs and shares are locked until deployment.
        </div>
      </Show>
      <Show when={isPendingMintApproval()}>
        <div class="flex items-center gap-3 p-3 rounded-lg text-xs"
          style={{ background: "rgba(139,92,246,0.08)", color: "var(--violet)", border: "1px solid rgba(139,92,246,0.2)" }}>
          <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          NFTs can no longer be modified during mint approval.
        </div>
      </Show>

      {/* Empty state — no drafts, no minted, not showing form */}
      <Show when={drafts().length === 0 && mintedNfts().length === 0 && !showForm()}>
        <div class="card text-center py-12">
          <div class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(212,168,83,0.1)", border: "1px solid rgba(212,168,83,0.2)" }}>
            <svg class="w-8 h-8" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          </div>
          <p class="text-sm font-medium mb-1" style={{ color: "var(--cream)" }}>
            Prepare your NFTs
          </p>
          <p class="text-xs" style={{ color: "var(--text-muted)" }}>
            Add your NFTs. They'll be minted once your collaborators approve.
          </p>
          <Show when={isCreator() && canAddNft()}>
            <button class="btn-gold mt-4" onClick={openNewForm}>
              + Add your first NFT
            </button>
          </Show>
        </div>
      </Show>

      {/* Create/Edit form */}
      <Show when={showForm()}>
        <div class="card space-y-5">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-semibold" style={{ color: "var(--cream)" }}>
              {editing() ? "Edit NFT" : "New NFT"}
            </h4>
            <button class="btn-secondary text-xs" onClick={resetForm}>Cancel</button>
          </div>

          {/* Image upload */}
          <div>
            <label class="label">Image</label>
            <div class="flex items-start gap-4">
              <Show when={formImageUrl()} fallback={
                <label class="w-32 h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors hover:border-[var(--gold)]"
                  style={{ "border-color": "var(--border)", background: "var(--noir-light)" }}>
                  <svg class="w-8 h-8 mb-1" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span class="text-[10px]" style={{ color: "var(--text-muted)" }}>Upload</span>
                  <input type="file" accept="image/*" class="hidden" onChange={handleImageUpload} />
                </label>
              }>
                <div class="relative">
                  <img src={formImageUrl()} alt="NFT preview" class="w-32 h-32 rounded-xl object-cover" />
                  <button class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs"
                    style={{ background: "var(--accent)", color: "white" }}
                    onClick={() => setFormImageUrl("")} aria-label="Remove image">&times;</button>
                </div>
              </Show>
              <div class="flex-1 space-y-3">
                <div>
                  <label class="label">Title *</label>
                  <input class="input w-full" placeholder="NFT name" value={formTitle()}
                    onInput={(e) => setFormTitle(e.currentTarget.value)} autofocus />
                </div>
                <Show when={artistParticipants().length > 0}>
                  <div>
                    <label class="label">Artist(s)</label>
                    <div class="flex flex-wrap gap-2 mt-1">
                      <For each={artistParticipants()}>
                        {(artist) => {
                          const selected = () => formSelectedArtists().includes(artist.userId);
                          return (
                            <button
                              type="button"
                              class="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                              style={{
                                background: selected() ? "rgba(212,168,83,0.2)" : "var(--surface-light)",
                                color: selected() ? "var(--gold)" : "var(--text-muted)",
                                border: `1px solid ${selected() ? "rgba(212,168,83,0.4)" : "var(--border)"}`,
                              }}
                              onClick={() => {
                                if (selected()) {
                                  setFormSelectedArtists(formSelectedArtists().filter(id => id !== artist.userId));
                                } else {
                                  setFormSelectedArtists([...formSelectedArtists(), artist.userId]);
                                }
                              }}
                            >
                              {artist.name}
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label class="label">Description</label>
            <textarea class="input w-full min-h-[80px] resize-none" placeholder="NFT description..."
              value={formDescription()} onInput={(e) => setFormDescription(e.currentTarget.value)} />
          </div>

          {/* Price */}
          <div>
            <label class="label">Price (AVAX)</label>
            <input class="input w-full" type="number" min="0" step="0.01" placeholder="0.00"
              value={formPrice()} onInput={(e) => setFormPrice(e.currentTarget.value)} />
          </div>

          {/* Custom attributes */}
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="label mb-0">Attributes</label>
              <button class="text-xs px-2 py-1 rounded-lg transition-colors"
                style={{ color: "var(--gold)", background: "rgba(212,168,83,0.08)" }}
                onClick={addAttribute}>+ Attribute</button>
            </div>
            <Show when={attrError()}>
              <p class="text-xs" style={{ color: "var(--accent)" }}>{attrError()}</p>
            </Show>
            <Show when={formAttributes().length > 0}>
              <div class="space-y-2">
                <For each={formAttributes()}>
                  {(attr, i) => (
                    <div class="flex items-center gap-2">
                      <input class="input flex-1" placeholder="Property (e.g. medium, style...)" value={attr.key}
                        onInput={(e) => updateAttribute(i(), "key", e.currentTarget.value)} />
                      <input class="input flex-1" placeholder="Value" value={attr.value}
                        onInput={(e) => updateAttribute(i(), "value", e.currentTarget.value)} />
                      <button class="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0"
                        style={{ color: "var(--accent)", background: "rgba(255,59,63,0.08)" }}
                        onClick={() => removeAttribute(i())} aria-label="Remove attribute">&times;</button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Save */}
          <button class="btn-gold w-full" onClick={handleSaveDraft}
            disabled={!formTitle().trim() || saving()}>
            {saving() ? "Saving..." : editing() ? "Save" : "Add"}
          </button>
        </div>
      </Show>

      {/* Draft NFT cards — grid */}
      <Show when={drafts().length > 0}>
        <div>
          <h4 class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
            Not minted
          </h4>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <For each={drafts()}>
              {(draft) => {
                const attrs = safeParseAttrs(draft.attributes);
                return (
                  <div class="rounded-xl overflow-hidden transition-all hover:scale-[1.02] cursor-pointer"
                    style={{ background: "var(--noir-light)", border: "1px solid var(--border)" }}
                    onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) setDetailNft(draft); }}>
                    {/* Image */}
                    <div class="aspect-square relative" style={{ background: "var(--surface-light)" }}>
                      <Show when={draft.image_url} fallback={
                        <div class="w-full h-full flex items-center justify-center">
                          <svg class="w-12 h-12" style={{ color: "var(--text-muted)", opacity: 0.3 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                          </svg>
                        </div>
                      }>
                        <img src={sanitizeImageUrl(draft.image_url)} alt={draft.title} loading="lazy" class="w-full h-full object-cover" />
                      </Show>
                      {/* Status badge */}
                      <div class="absolute top-2 left-2">
                        <span class="text-[10px] px-2 py-0.5 rounded-full font-medium backdrop-blur-sm"
                          style={{ background: "rgba(0,0,0,0.5)", color: "var(--text-muted)" }}>
                          Not minted
                        </span>
                      </div>
                      {/* Actions overlay */}
                      <Show when={isCreator() && canEdit()}>
                        <div class="absolute top-2 right-2 flex gap-1">
                          <button class="w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm transition-colors"
                            style={{ background: "rgba(0,0,0,0.5)", color: "var(--cream)" }}
                            onClick={() => openEditForm(draft)} title="Edit" aria-label="Edit draft">
                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                            </svg>
                          </button>
                          <button class="w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm transition-colors"
                            style={{ background: "rgba(0,0,0,0.5)", color: "var(--accent)" }}
                            onClick={() => handleDeleteDraft(draft.id)} title="Delete" aria-label="Delete draft">
                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </Show>
                    </div>
                    {/* Info */}
                    <div class="p-3">
                      <h5 class="text-sm font-semibold truncate" style={{ color: "var(--cream)" }}>{draft.title}</h5>
                      <Show when={getArtistFromAttrs(draft.attributes)}>
                        <p class="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>{getArtistFromAttrs(draft.attributes)}</p>
                      </Show>
                      <Show when={draft.price}>
                        <div class="flex items-center gap-1 mt-2">
                          <span class="text-sm font-bold font-mono" style={{ color: "var(--gold)" }}>{draft.price}</span>
                          <span class="text-xs" style={{ color: "var(--text-muted)" }}>AVAX</span>
                        </div>
                      </Show>
                      <Show when={attrs.length > 0}>
                        <div class="flex flex-wrap gap-1 mt-2">
                          <For each={attrs.slice(0, 3)}>
                            {(attr) => (
                              <span class="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ background: "var(--surface-light)", color: "var(--text-muted)" }}>
                                {attr.key}: {attr.value}
                              </span>
                            )}
                          </For>
                          <Show when={attrs.length > 3}>
                            <span class="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: "var(--surface-light)", color: "var(--text-muted)" }}>
                              +{attrs.length - 3}
                            </span>
                          </Show>
                        </div>
                      </Show>
                      {/* Mint button when mint_ready */}
                      <Show when={isMintReady() && isCreator()}>
                        <button class="btn-gold w-full text-xs mt-3"
                          onClick={() => handleMintSingle(draft)}
                          disabled={mintingId() === draft.id}>
                          {mintingId() === draft.id ? "Minting..." : "Mint"}
                        </button>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* Minted NFT cards — grid */}
      <Show when={mintedNfts().length > 0}>
        <div>
          <h4 class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--emerald)" }}>
            Minted
          </h4>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <For each={mintedNfts()}>
              {(nft) => {
                const attrs = safeParseAttrs(nft.attributes);
                const sold = () => isSold(nft.token_id);
                return (
                  <div class="rounded-xl overflow-hidden cursor-pointer transition-all"
                    classList={{ "hover:scale-[1.02]": !sold(), "opacity-75": sold() }}
                    style={{ background: "var(--noir-light)", border: "1px solid var(--border)" }}
                    onClick={() => setDetailNft(nft)}>
                    <div class="aspect-square relative" style={{ background: "var(--surface-light)" }}>
                      <Show when={nft.image_url} fallback={
                        <div class="w-full h-full flex items-center justify-center">
                          <span class="text-3xl font-bold font-mono" style={{ color: "var(--gold)", opacity: 0.3 }}>
                            #{nft.token_id}
                          </span>
                        </div>
                      }>
                        <img src={sanitizeImageUrl(nft.image_url)} alt={nft.title}
                          loading="lazy" class="w-full h-full object-cover"
                          classList={{ "grayscale-[30%]": sold() }} />
                      </Show>
                      <div class="absolute top-2 left-2 flex items-center gap-1.5">
                        <span class="text-[10px] px-2 py-0.5 rounded-full font-medium font-mono backdrop-blur-sm"
                          style={{ background: "rgba(0,0,0,0.55)", color: "var(--cream-muted)" }}>
                          #{nft.token_id}
                        </span>
                      </div>
                      <div class="absolute top-2 right-2">
                        <Show when={sold()} fallback={
                          <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold backdrop-blur-sm"
                            style={{ background: "rgba(52,211,153,0.85)", color: "white" }}>
                            For sale
                          </span>
                        }>
                          <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold backdrop-blur-sm"
                            style={{ background: "rgba(255,59,63,0.85)", color: "white" }}>
                            Sold
                          </span>
                        </Show>
                      </div>
                    </div>
                    <div class="p-3">
                      <h5 class="text-sm font-semibold truncate" style={{ color: "var(--cream)" }}>{nft.title}</h5>
                      <Show when={getArtistFromAttrs(nft.attributes)}>
                        <p class="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>{getArtistFromAttrs(nft.attributes)}</p>
                      </Show>
                      <Show when={nft.price}>
                        <div class="flex items-center gap-1 mt-2">
                          <span class="text-sm font-bold font-mono"
                            style={{ color: sold() ? "var(--text-muted)" : "var(--gold)" }}
                            classList={{ "line-through": sold() }}>
                            {nft.price}
                          </span>
                          <span class="text-xs" style={{ color: "var(--text-muted)" }}>AVAX</span>
                        </div>
                      </Show>
                      <Show when={sold() && soldMap()[nft.token_id]}>
                        <p class="text-[10px] mt-1 font-mono truncate" style={{ color: "var(--text-muted)" }}
                          title={soldMap()[nft.token_id]}>
                          Buyer: {soldMap()[nft.token_id]?.slice(0, 6)}...{soldMap()[nft.token_id]?.slice(-4)}
                        </p>
                      </Show>
                      <Show when={attrs.length > 0}>
                        <div class="flex flex-wrap gap-1 mt-2">
                          <For each={attrs.slice(0, 3)}>
                            {(attr) => (
                              <span class="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ background: "var(--surface-light)", color: "var(--text-muted)" }}>
                                {attr.key}: {attr.value}
                              </span>
                            )}
                          </For>
                          <Show when={attrs.length > 3}>
                            <span class="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: "var(--surface-light)", color: "var(--text-muted)" }}>
                              +{attrs.length - 3}
                            </span>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* NFT Detail modal */}
      <Show when={detailNft()}>
        {(nft) => {
          const minted = () => isMintedNft(nft());
          const attrs = () => safeParseAttrs(nft().attributes);
          const tokenId = () => minted() ? (nft() as Nft).token_id : undefined;
          return (
            <div class="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.7)" }}
              onClick={(e) => { if (e.target === e.currentTarget) setDetailNft(null); }}
              onKeyDown={(e) => { if (e.key === "Escape") setDetailNft(null); }}>
              <div role="dialog" aria-modal="true" aria-label={nft().title}
                class="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
                style={{ background: "var(--noir-light)", border: "1px solid var(--border)", "max-height": "90vh", "overflow-y": "auto" }}>
                {/* Image */}
                <Show when={nft().image_url}>
                  <div class="w-full aspect-square relative" style={{ background: "var(--surface-light)" }}>
                    <img src={sanitizeImageUrl(nft().image_url)} alt={nft().title} class="w-full h-full object-cover" />
                  </div>
                </Show>
                {/* Content */}
                <div class="p-6 space-y-4">
                  <div class="flex items-start justify-between">
                    <div>
                      <h3 class="text-lg font-bold" style={{ color: "var(--cream)" }}>{nft().title}</h3>
                      <Show when={getArtistFromAttrs(nft().attributes)}>
                        <p class="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>{getArtistFromAttrs(nft().attributes)}</p>
                      </Show>
                    </div>
                    <button class="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ color: "var(--text-muted)", background: "var(--surface-light)" }}
                      onClick={() => setDetailNft(null)} aria-label="Close">&times;</button>
                  </div>

                  <Show when={minted() && tokenId() !== undefined}>
                    <div class="flex items-center gap-2">
                      <span class="text-xs px-2 py-0.5 rounded-full font-medium font-mono"
                        style={{ background: "rgba(52,211,153,0.15)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.3)" }}>
                        Token #{tokenId()}
                      </span>
                      <Show when={isSold(tokenId()!)} fallback={
                        <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: "rgba(52,211,153,0.15)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.3)" }}>
                          For sale
                        </span>
                      }>
                        <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: "rgba(255,59,63,0.15)", color: "var(--accent)", border: "1px solid rgba(255,59,63,0.3)" }}>
                          Sold
                        </span>
                      </Show>
                    </div>
                    <Show when={isSold(tokenId()!)}>
                      <div>
                        <label class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>Buyer</label>
                        <code class="text-xs block mt-1 break-all" style={{ color: "var(--cream)" }}>
                          {soldMap()[tokenId()!]}
                        </code>
                      </div>
                    </Show>
                  </Show>

                  <Show when={nft().description}>
                    <div>
                      <label class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>Description</label>
                      <p class="text-sm mt-1" style={{ color: "var(--cream)" }}>{nft().description}</p>
                    </div>
                  </Show>

                  <Show when={nft().price}>
                    <div>
                      <label class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>Price</label>
                      <p class="text-lg font-bold font-mono mt-1" style={{ color: "var(--gold)" }}>{nft().price} AVAX</p>
                    </div>
                  </Show>

                  <Show when={nft().metadata_uri}>
                    <div>
                      <label class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>Metadata URI</label>
                      <code class="text-xs block mt-1 break-all" style={{ color: "var(--cream)" }}>{nft().metadata_uri}</code>
                    </div>
                  </Show>

                  <Show when={attrs().length > 0}>
                    <div>
                      <label class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>Attributes</label>
                      <div class="grid grid-cols-2 gap-2 mt-2">
                        <For each={attrs()}>
                          {(attr) => (
                            <div class="p-2 rounded-lg" style={{ background: "var(--surface-light)" }}>
                              <div class="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{attr.key}</div>
                              <div class="text-sm font-medium" style={{ color: "var(--cream)" }}>{attr.value}</div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
