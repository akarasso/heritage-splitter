import { Show, For, createSignal, createResource, createMemo, onCleanup } from "solid-js";
import { api } from "~/lib/api-client";
import type { ShowroomParticipantDetail, PublicUser, Collection } from "~/lib/api-client";
import { sanitizeImageUrl } from "~/lib/utils";
import { showToast } from "~/components/ui/Toast";
import { useShowroom } from "~/lib/showroom-context";
import { showAlert, showConfirm } from "~/lib/modal-store";

export default function ShowroomOverview() {
  const { showroom, refetch, user, isOwner, isMember } = useShowroom();

  const [inviting, setInviting] = createSignal(false);
  const [proposing, setProposing] = createSignal(false);
  const [publishing, setPublishing] = createSignal(false);
  const [unpublishing, setUnpublishing] = createSignal(false);
  const [copiedUrl, setCopiedUrl] = createSignal(false);

  // Artist search state (owner only)
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<PublicUser[]>([]);
  const [selectedArtist, setSelectedArtist] = createSignal<PublicUser | null>(null);
  const [showDropdown, setShowDropdown] = createSignal(false);
  const [searching, setSearching] = createSignal(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => { if (debounceTimer) clearTimeout(debounceTimer); });

  // Proposable collections (artist only)
  const [proposableCollections, { refetch: refetchProposable }] = createResource(
    () => !isOwner() && showroom()?.id,
    (id) => api.listProposableCollections(id as string)
  );

  // Shared collections — grouped by collection_id with proposer info
  const sharedCollections = createMemo(() => {
    const listings = showroom()?.listings || [];
    const map = new Map<string, { collection_id: string; collection_name: string; nft_count: number; proposed_by_name: string }>();
    for (const l of listings) {
      if (!l.collection_id) continue;
      const existing = map.get(l.collection_id);
      if (existing) { existing.nft_count++; }
      else {
        map.set(l.collection_id, {
          collection_id: l.collection_id,
          collection_name: l.collection_name || "Unnamed",
          nft_count: 1,
          proposed_by_name: l.proposed_by_name || "Unknown",
        });
      }
    }
    return Array.from(map.values());
  });

  function handleSearchInput(value: string) {
    setSearchQuery(value);
    setSelectedArtist(null);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (value.trim().length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    debounceTimer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchUsers(value.trim(), "artist");
        const participantIds = new Set(showroom()?.participants.map((p: ShowroomParticipantDetail) => p.user_id) || []);
        setSearchResults(results.filter(u => !participantIds.has(u.id) && u.id !== user()?.id));
        setShowDropdown(true);
      } catch { setSearchResults([]); } finally { setSearching(false); }
    }, 300);
  }

  function selectArtist(artist: PublicUser) {
    setSelectedArtist(artist);
    setSearchQuery(artist.display_name || artist.id);
    setShowDropdown(false);
    setSearchResults([]);
  }

  async function handleInvite(e: Event) {
    e.preventDefault();
    const artist = selectedArtist();
    const sr = showroom();
    if (!artist || !sr) return;
    setInviting(true);
    try {
      await api.inviteToShowroom(sr.id, artist.id);
      setSearchQuery(""); setSelectedArtist(null);
      refetch();
    } catch (err) { if (import.meta.env.DEV) console.error("Invite failed:", err); } finally { setInviting(false); }
  }

  async function handleRemoveParticipant(userId: string) {
    const s = showroom();
    if (!s) return;
    try { await api.removeShowroomParticipant(s.id, userId); refetch(); } catch (err) { if (import.meta.env.DEV) console.error("Remove failed:", err); }
  }

  async function handleProposeCollection(collectionId: string) {
    const sr = showroom();
    if (!sr) return;
    setProposing(true);
    try {
      await api.proposeCollection(sr.id, collectionId);
      refetch();
      refetchProposable();
    } catch (err) { if (import.meta.env.DEV) console.error("Propose failed:", err); showToast((err as Error).message); } finally { setProposing(false); }
  }

  function getShowroomSaleUrl(slug: string): string {
    const proto = window.location.protocol;
    const host = window.location.host;
    return `${proto}//${host}/showroom/sale/${slug}`;
  }

  async function copyUrl() {
    const url = getShowroomSaleUrl(sr()!.public_slug!);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      await api.publishShowroom(sr()!.id);
      refetch();
    } catch (e) {
      showAlert({ title: "Error", message: (e as Error).message });
    } finally {
      setPublishing(false);
    }
  }

  function handleUnpublish() {
    showConfirm({
      title: "Remove public link",
      message: "The sale page will no longer be accessible. You can create a new one later.",
      confirmLabel: "Remove",
      variant: "danger",
      onConfirm: async () => {
        setUnpublishing(true);
        try {
          await api.unpublishShowroom(sr()!.id);
          refetch();
        } catch (e) {
          showAlert({ title: "Error", message: (e as Error).message });
        } finally {
          setUnpublishing(false);
        }
      },
    });
  }

  async function handleUnshareCollection(collectionId: string) {
    const sr = showroom();
    if (!sr) return;
    try {
      await api.unshareCollection(sr.id, collectionId);
      refetch();
      refetchProposable();
    } catch (err) { if (import.meta.env.DEV) console.error("Unshare failed:", err); }
  }

  const sr = () => showroom();

  return (
    <div class="animate-fade-in-up">
      <div class="flex flex-col gap-6">
        {/* ── Participants + Invite (owner only) ── */}
        <Show when={isOwner()}>
          <div class="card relative z-10" style={{ padding: "0" }}>
            <div style={{ padding: "14px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
              <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Participants</span>
              <span class="text-xs" style={{ color: "var(--text-muted)" }}>{sr()?.participants.length || 0}</span>
            </div>
            <div style={{ padding: "12px 20px" }}>
              <Show
                when={(sr()?.participants.length || 0) > 0}
                fallback={<p class="text-xs py-2 text-center" style={{ color: "var(--text-muted)" }}>No participants yet</p>}
              >
                <div class="flex flex-wrap gap-2">
                  <For each={sr()?.participants || []}>
                    {(p: ShowroomParticipantDetail) => (
                      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "var(--surface-light)" }}>
                        <div class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: "var(--surface)", color: "var(--gold)" }}>
                          {p.display_name?.[0]?.toUpperCase() || "?"}
                        </div>
                        <span class="text-xs" style={{ color: "var(--cream-muted)" }}>{p.display_name}</span>
                        <button class="text-[10px] ml-1 hover:opacity-80 transition-opacity" style={{ color: "var(--text-muted)" }} onClick={() => handleRemoveParticipant(p.user_id)} title="Remove">x</button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <form onSubmit={handleInvite} style={{ padding: "12px 20px", "border-top": "1px solid var(--border)" }}>
              <label class="text-[10px] font-medium mb-2 block" style={{ color: "var(--text-muted)" }}>Invite an artist</label>
              <div class="flex gap-2">
                <div class="relative flex-1">
                  <Show
                    when={!selectedArtist()}
                    fallback={
                      <div class="input text-xs flex items-center gap-2 cursor-pointer" onClick={() => { setSelectedArtist(null); setSearchQuery(""); }} title="Click to change">
                        {selectedArtist()!.avatar_url ? (
                          <img src={sanitizeImageUrl(selectedArtist()!.avatar_url)} alt="" class="w-5 h-5 rounded-full object-cover" />
                        ) : (
                          <div class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: "var(--surface-light)", color: "var(--gold)" }}>{selectedArtist()!.display_name?.[0]?.toUpperCase() || "?"}</div>
                        )}
                        <span style={{ color: "var(--cream)" }}>{selectedArtist()!.display_name}</span>
                        <span class="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>x</span>
                      </div>
                    }
                  >
                    <input type="text" class="input w-full text-xs" placeholder="Search artists by name..." value={searchQuery()} onInput={(e) => handleSearchInput(e.currentTarget.value)} onFocus={() => { if (searchResults().length > 0) setShowDropdown(true); }} onBlur={() => setTimeout(() => setShowDropdown(false), 200)} />
                    <Show when={searching()}>
                      <div class="absolute right-2 top-1/2 -translate-y-1/2"><div class="w-3 h-3 rounded-full animate-spin" style={{ border: "2px solid var(--border)", "border-top-color": "var(--gold)" }} /></div>
                    </Show>
                  </Show>
                  <Show when={showDropdown() && searchResults().length > 0}>
                    <div class="absolute left-0 right-0 mt-1 rounded-lg z-50" style={{ background: "var(--surface)", border: "1px solid var(--border)", "max-height": "240px", "overflow-y": "auto", "box-shadow": "0 8px 32px rgba(0,0,0,0.5)" }}>
                      <For each={searchResults()}>
                        {(artist) => (
                          <button type="button" class="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5" style={{ "border-bottom": "1px solid var(--border)" }} onMouseDown={() => selectArtist(artist)}>
                            {artist.avatar_url ? (<img src={sanitizeImageUrl(artist.avatar_url)} alt="" class="w-7 h-7 rounded-full object-cover flex-shrink-0" />) : (<div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: "var(--surface-light)", color: "var(--gold)" }}>{artist.display_name?.[0]?.toUpperCase() || "?"}</div>)}
                            <div class="min-w-0 flex-1">
                              <div class="text-sm font-medium truncate" style={{ color: "var(--cream)" }}>{artist.display_name}</div>
                              <Show when={artist.bio}><div class="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{artist.bio}</div></Show>
                            </div>
                            <span class="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(212,168,83,0.12)", color: "var(--gold)" }}>artist</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={showDropdown() && searchResults().length === 0 && searchQuery().trim().length >= 2 && !searching()}>
                    <div class="absolute left-0 right-0 mt-1 rounded-lg z-50 px-3 py-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)", "box-shadow": "0 8px 32px rgba(0,0,0,0.5)" }}>
                      <span class="text-xs" style={{ color: "var(--text-muted)" }}>No artists found</span>
                    </div>
                  </Show>
                </div>
                <button type="submit" class="btn-secondary text-xs" disabled={inviting() || !selectedArtist()}>
                  {inviting() ? "..." : "Invite"}
                </button>
              </div>
            </form>
          </div>
        </Show>

        {/* ── Shared Collections (owner view) ── */}
        <Show when={isOwner() && sharedCollections().length > 0}>
          <div class="card" style={{ padding: "0" }}>
            <div style={{ padding: "14px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
              <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Shared Collections</span>
              <span class="text-xs" style={{ color: "var(--text-muted)" }}>{sharedCollections().length}</span>
            </div>
            <div style={{ padding: "0" }}>
              <For each={sharedCollections()}>
                {(col) => (
                  <div class="flex items-center justify-between" style={{ padding: "12px 20px", "border-bottom": "1px solid var(--border)" }}>
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-medium" style={{ color: "var(--cream)" }}>{col.collection_name}</p>
                      <p class="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {col.nft_count} NFT{col.nft_count > 1 ? "s" : ""}
                      </p>
                    </div>
                    <div class="flex items-center gap-3 ml-4 shrink-0">
                      <div class="flex items-center gap-1.5">
                        <div class="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold" style={{ background: "var(--surface)", color: "var(--gold)" }}>
                          {col.proposed_by_name?.[0]?.toUpperCase() || "?"}
                        </div>
                        <span class="text-[10px]" style={{ color: "var(--cream-muted)" }}>{col.proposed_by_name}</span>
                      </div>
                      <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}>shared</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* ── Publish / Public URL (owner, active showroom) ── */}
        <Show when={isOwner() && sr()?.status === "active"}>
          <Show when={!sr()?.is_public}>
            <button
              class="btn-gold w-full text-sm"
              onClick={handlePublish}
              disabled={publishing()}
              style={{ opacity: publishing() ? "0.7" : "1" }}
            >
              {publishing() ? "Publishing..." : "Create a public sale page"}
            </button>
          </Show>

          <Show when={sr()?.is_public && sr()?.public_slug}>
            <div class="card" style={{ padding: "0", overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "14px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full" style={{ background: "var(--emerald)" }} />
                  <span class="text-sm font-medium" style={{ color: "var(--emerald)" }}>Sale page active</span>
                </div>
                <button
                  class="text-xs px-2.5 py-1 rounded-md transition-colors"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
                  onClick={handleUnpublish}
                  disabled={unpublishing()}
                >
                  Remove public link
                </button>
              </div>

              {/* URL row */}
              <div style={{ padding: "16px 20px", display: "flex", "align-items": "center", gap: "12px" }}>
                <a
                  href={getShowroomSaleUrl(sr()!.public_slug!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm font-mono flex-1"
                  style={{ color: "var(--gold)", "word-break": "break-all" }}
                >
                  {getShowroomSaleUrl(sr()!.public_slug!)}
                </a>
                <div class="flex items-center gap-2 shrink-0">
                  <button
                    class="text-xs px-3 py-1.5 rounded-md transition-colors"
                    style={{
                      border: "1px solid var(--border)",
                      background: copiedUrl() ? "rgba(52,211,153,0.15)" : "transparent",
                      color: copiedUrl() ? "var(--emerald)" : "var(--text-muted)",
                    }}
                    onClick={copyUrl}
                  >
                    {copiedUrl() ? "Copied!" : "Copy"}
                  </button>
                  <a
                    href={getShowroomSaleUrl(sr()!.public_slug!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-xs px-3 py-1.5 rounded-md transition-colors font-medium"
                    style={{ background: "var(--gold)", color: "var(--noir)" }}
                  >
                    Open
                  </a>
                </div>
              </div>
            </div>
          </Show>
        </Show>

        {/* ── Artist view: My Collections (shared / not shared) ── */}
        <Show when={!isOwner() && isMember()}>
          <div class="card" style={{ padding: "0" }}>
            <div style={{ padding: "14px 20px", "border-bottom": "1px solid var(--border)" }}>
              <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>My Collections</span>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <Show when={sharedCollections().length > 0}>
                <div class="space-y-2 mb-4">
                  <For each={sharedCollections()}>
                    {(col) => (
                      <div class="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--noir-light)" }}>
                        <div class="min-w-0 flex-1">
                          <p class="text-sm font-medium truncate" style={{ color: "var(--cream)" }}>{col.collection_name}</p>
                          <p class="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{col.nft_count} NFT{col.nft_count > 1 ? "s" : ""} shared</p>
                        </div>
                        <div class="flex items-center gap-3 ml-4 shrink-0">
                          <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}>shared</span>
                          <button class="text-[10px] px-2 py-1 rounded transition-colors hover:opacity-80" style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }} onClick={() => handleUnshareCollection(col.collection_id)}>Unshare</button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={!proposableCollections.loading} fallback={<p class="text-xs" style={{ color: "var(--text-muted)" }}>Loading collections...</p>}>
                <Show when={(proposableCollections() || []).length > 0}>
                  <Show when={sharedCollections().length > 0}><div class="divider my-3" /></Show>
                  <div class="space-y-2">
                    <For each={proposableCollections() || []}>
                      {(col: Collection) => (
                        <div class="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--noir-light)" }}>
                          <div class="min-w-0 flex-1">
                            <p class="text-sm font-medium truncate" style={{ color: "var(--cream)" }}>{col.name}</p>
                            <p class="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{col.description?.slice(0, 80) || "Deployed collection"}</p>
                          </div>
                          <div class="flex items-center gap-3 ml-4 shrink-0">
                            <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(107,114,128,0.12)", color: "var(--text-muted)" }}>not shared</span>
                            <button class="btn-gold text-xs" onClick={() => handleProposeCollection(col.id)} disabled={proposing()}>{proposing() ? "..." : "Share"}</button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={(proposableCollections() || []).length === 0 && sharedCollections().length === 0}>
                  <p class="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>No deployed collections available.</p>
                </Show>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
