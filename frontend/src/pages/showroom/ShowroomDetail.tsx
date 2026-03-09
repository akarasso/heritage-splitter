import { createResource, Show, For, createSignal, onCleanup } from "solid-js";
import { useParams, A } from "@solidjs/router";
import { api } from "~/lib/api-client";
import type { ShowroomDetail as ShowroomDetailType, ShowroomListing, ShowroomParticipantDetail, PublicUser } from "~/lib/api-client";
import { useAuth } from "~/hooks/createAuth";
import { sanitizeImageUrl } from "~/lib/utils";

export default function ShowroomDetail() {
  const params = useParams();
  const { user } = useAuth();
  const [showroom, { refetch }] = createResource(() => params.id, (id) => api.getShowroom(id));
  const [inviting, setInviting] = createSignal(false);
  const [deploying, setDeploying] = createSignal(false);

  // Artist search state
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<PublicUser[]>([]);
  const [selectedArtist, setSelectedArtist] = createSignal<PublicUser | null>(null);
  const [showDropdown, setShowDropdown] = createSignal(false);
  const [searching, setSearching] = createSignal(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => { if (debounceTimer) clearTimeout(debounceTimer); });

  function handleSearchInput(value: string) {
    setSearchQuery(value);
    setSelectedArtist(null);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    debounceTimer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchUsers(value.trim(), "artist");
        // Exclude already invited participants
        const participantIds = new Set(showroom()?.participants.map((p: ShowroomParticipantDetail) => p.user_id) || []);
        setSearchResults(results.filter(u => !participantIds.has(u.id) && u.id !== user()?.id));
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function selectArtist(artist: PublicUser) {
    setSelectedArtist(artist);
    setSearchQuery(artist.display_name || artist.id);
    setShowDropdown(false);
    setSearchResults([]);
  }

  const isOwner = () => showroom()?.creator_id === user()?.id;

  async function handleInvite(e: Event) {
    e.preventDefault();
    const artist = selectedArtist();
    if (!artist) return;
    setInviting(true);
    try {
      await api.inviteToShowroom(params.id, artist.id);
      setSearchQuery("");
      setSelectedArtist(null);
      refetch();
    } catch (err) {
      if (import.meta.env.DEV) console.error("Invite failed:", err);
    } finally {
      setInviting(false);
    }
  }

  async function handleAccept() {
    try {
      await api.acceptShowroomInvite(params.id);
      refetch();
    } catch (err) {
      if (import.meta.env.DEV) console.error("Accept failed:", err);
    }
  }

  async function handleDeploy() {
    setDeploying(true);
    try {
      await api.deployShowroom(params.id);
      refetch();
    } catch (err) {
      if (import.meta.env.DEV) console.error("Deploy failed:", err);
    } finally {
      setDeploying(false);
    }
  }

  async function handleSetMargin(listingId: string, margin: string) {
    try {
      await api.updateShowroomListing(listingId, { margin });
      refetch();
    } catch (err) {
      if (import.meta.env.DEV) console.error("Set margin failed:", err);
    }
  }

  async function handleApproveListing(listingId: string) {
    try {
      await api.updateShowroomListing(listingId, { status: "approved" });
      refetch();
    } catch (err) {
      if (import.meta.env.DEV) console.error("Approve failed:", err);
    }
  }

  async function handleDeleteListing(listingId: string) {
    try {
      await api.deleteShowroomListing(listingId);
      refetch();
    } catch (err) {
      if (import.meta.env.DEV) console.error("Delete failed:", err);
    }
  }

  function statusColor(status: string) {
    switch (status) {
      case "accepted": return "#34d399";
      case "invited": return "var(--gold)";
      case "approved": return "#34d399";
      case "proposed": return "var(--gold)";
      default: return "var(--text-muted)";
    }
  }

  return (
    <div class="max-w-5xl mx-auto px-6 py-12">
      <Show
        when={!showroom.loading && showroom()}
        fallback={
          <div class="flex items-center gap-3 py-12">
            <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
            <span class="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</span>
          </div>
        }
      >
        {(sr) => {
          // Check if current user has a pending invitation
          const myInvite = () => sr().participants.find(
            (p: ShowroomParticipantDetail) => p.user_id === user()?.id && p.status === "invited"
          );

          return (
            <>
              {/* Header */}
              <div class="flex items-start justify-between mb-8">
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
                <Show when={isOwner() && sr().status === "draft"}>
                  <button class="btn-gold text-sm" onClick={handleDeploy} disabled={deploying()}>
                    {deploying() ? "Deploying..." : "Deploy Showroom"}
                  </button>
                </Show>
              </div>

              {/* Pending invitation banner */}
              <Show when={myInvite()}>
                <div class="card mb-6" style={{ padding: "16px 20px", background: "rgba(212,168,83,0.08)", border: "1px solid rgba(212,168,83,0.3)" }}>
                  <div class="flex items-center justify-between">
                    <span class="text-sm" style={{ color: "var(--gold)" }}>You have been invited to this showroom</span>
                    <button class="btn-gold text-xs" onClick={handleAccept}>Accept Invitation</button>
                  </div>
                </div>
              </Show>

              <div class="flex flex-col gap-6">
                {/* Participants + Invite */}
                <div class="card relative z-10" style={{ padding: "0" }}>
                  <div style={{ padding: "14px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                    <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Participants</span>
                    <span class="text-xs" style={{ color: "var(--text-muted)" }}>{sr().participants.length}</span>
                  </div>

                  {/* Participant list as horizontal chips */}
                  <div style={{ padding: "12px 20px" }}>
                    <Show
                      when={sr().participants.length > 0}
                      fallback={<p class="text-xs py-2 text-center" style={{ color: "var(--text-muted)" }}>No participants yet</p>}
                    >
                      <div class="flex flex-wrap gap-2">
                        <For each={sr().participants}>
                          {(p: ShowroomParticipantDetail) => (
                            <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "var(--surface-light)" }}>
                              <div class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: "var(--surface)", color: "var(--gold)" }}>
                                {p.display_name?.[0]?.toUpperCase() || "?"}
                              </div>
                              <span class="text-xs" style={{ color: "var(--cream-muted)" }}>{p.display_name}</span>
                              <span class="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ color: statusColor(p.status), background: `${statusColor(p.status)}15` }}>
                                {p.status}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* Invite form */}
                  <Show when={isOwner()}>
                    <form onSubmit={handleInvite} style={{ padding: "12px 20px", "border-top": "1px solid var(--border)" }}>
                      <label class="text-[10px] font-medium mb-2 block" style={{ color: "var(--text-muted)" }}>Invite an artist</label>
                      <div class="flex gap-2">
                        <div class="relative flex-1">
                          <Show
                            when={!selectedArtist()}
                            fallback={
                              <div
                                class="input text-xs flex items-center gap-2 cursor-pointer"
                                onClick={() => { setSelectedArtist(null); setSearchQuery(""); }}
                                title="Click to change"
                              >
                                {selectedArtist()!.avatar_url ? (
                                  <img src={sanitizeImageUrl(selectedArtist()!.avatar_url)} alt="" class="w-5 h-5 rounded-full object-cover" />
                                ) : (
                                  <div class="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
                                    {selectedArtist()!.display_name?.[0]?.toUpperCase() || "?"}
                                  </div>
                                )}
                                <span style={{ color: "var(--cream)" }}>{selectedArtist()!.display_name}</span>
                                <span class="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>x</span>
                              </div>
                            }
                          >
                            <input
                              type="text"
                              class="input w-full text-xs"
                              placeholder="Search artists by name..."
                              value={searchQuery()}
                              onInput={(e) => handleSearchInput(e.currentTarget.value)}
                              onFocus={() => { if (searchResults().length > 0) setShowDropdown(true); }}
                              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                            />
                            <Show when={searching()}>
                              <div class="absolute right-2 top-1/2 -translate-y-1/2">
                                <div class="w-3 h-3 rounded-full animate-spin" style={{ border: "2px solid var(--border)", "border-top-color": "var(--gold)" }} />
                              </div>
                            </Show>
                          </Show>

                          {/* Dropdown */}
                          <Show when={showDropdown() && searchResults().length > 0}>
                            <div
                              class="absolute left-0 right-0 mt-1 rounded-lg z-50"
                              style={{ background: "var(--surface)", border: "1px solid var(--border)", "max-height": "240px", "overflow-y": "auto", "box-shadow": "0 8px 32px rgba(0,0,0,0.5)" }}
                            >
                              <For each={searchResults()}>
                                {(artist) => (
                                  <button
                                    type="button"
                                    class="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                                    style={{ "border-bottom": "1px solid var(--border)" }}
                                    onMouseDown={() => selectArtist(artist)}
                                  >
                                    {artist.avatar_url ? (
                                      <img src={sanitizeImageUrl(artist.avatar_url)} alt="" class="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                                    ) : (
                                      <div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
                                        {artist.display_name?.[0]?.toUpperCase() || "?"}
                                      </div>
                                    )}
                                    <div class="min-w-0 flex-1">
                                      <div class="text-sm font-medium truncate" style={{ color: "var(--cream)" }}>{artist.display_name}</div>
                                      <Show when={artist.bio}>
                                        <div class="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{artist.bio}</div>
                                      </Show>
                                    </div>
                                    <span class="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(212,168,83,0.12)", color: "var(--gold)" }}>
                                      artist
                                    </span>
                                  </button>
                                )}
                              </For>
                            </div>
                          </Show>

                          {/* No results message */}
                          <Show when={showDropdown() && searchResults().length === 0 && searchQuery().trim().length >= 2 && !searching()}>
                            <div
                              class="absolute left-0 right-0 mt-1 rounded-lg z-50 px-3 py-3 text-center"
                              style={{ background: "var(--surface)", border: "1px solid var(--border)", "box-shadow": "0 8px 32px rgba(0,0,0,0.5)" }}
                            >
                              <span class="text-xs" style={{ color: "var(--text-muted)" }}>No artists found</span>
                            </div>
                          </Show>
                        </div>
                        <button type="submit" class="btn-secondary text-xs" disabled={inviting() || !selectedArtist()}>
                          {inviting() ? "..." : "Invite"}
                        </button>
                      </div>
                    </form>
                  </Show>
                </div>

                {/* Listings */}
                <div class="card" style={{ padding: "0", overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                    <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Listings</span>
                    <span class="text-xs" style={{ color: "var(--text-muted)" }}>{sr().listings.length} items</span>
                  </div>

                  <Show
                    when={sr().listings.length > 0}
                    fallback={
                      <div class="text-center py-12">
                        <p class="text-sm" style={{ color: "var(--text-muted)" }}>No listings proposed yet</p>
                      </div>
                    }
                  >
                    <div>
                      <For each={sr().listings}>
                        {(listing: ShowroomListing) => (
                          <div class="flex items-center justify-between" style={{ padding: "12px 20px", "border-bottom": "1px solid var(--border)" }}>
                            <div>
                              <div class="flex items-center gap-2">
                                <span class="text-xs font-mono" style={{ color: "var(--cream-muted)" }}>
                                  #{listing.token_id}
                                </span>
                                <span class="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                                  {listing.nft_contract.slice(0, 10)}...
                                </span>
                                <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: statusColor(listing.status), background: `${statusColor(listing.status)}15` }}>
                                  {listing.status}
                                </span>
                              </div>
                              <div class="flex items-center gap-4 mt-1">
                                <span class="text-[10px]" style={{ color: "var(--text-muted)" }}>
                                  Base: {listing.base_price || "0"} wei
                                </span>
                                <span class="text-[10px]" style={{ color: "var(--text-muted)" }}>
                                  Margin: {listing.margin || "0"} wei
                                </span>
                              </div>
                            </div>
                            <Show when={isOwner()}>
                              <div class="flex items-center gap-2">
                                <Show when={listing.status === "proposed"}>
                                  <button
                                    class="text-[10px] px-2 py-1 rounded"
                                    style={{ color: "#34d399", background: "rgba(52,211,153,0.1)" }}
                                    onClick={() => handleApproveListing(listing.id)}
                                  >
                                    Approve
                                  </button>
                                </Show>
                                <button
                                  class="text-[10px] px-2 py-1 rounded"
                                  style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}
                                  onClick={() => handleDeleteListing(listing.id)}
                                >
                                  Remove
                                </button>
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
}
