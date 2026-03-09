import { Show, For, createSignal, createMemo } from "solid-js";
import { api } from "~/lib/api-client";
import type { ShowroomListing } from "~/lib/api-client";
import { sanitizeImageUrl } from "~/lib/utils";
import { showToast } from "~/components/ui/Toast";
import { useShowroom } from "~/lib/showroom-context";

interface CollectionGroup {
  collection_id: string;
  collection_name: string;
  proposed_by_name: string;
  listings: ShowroomListing[];
}

export default function ShowroomListings() {
  const { showroom, refetch, isOwner } = useShowroom();

  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [batchMargin, setBatchMargin] = createSignal("");
  const [applyingMargin, setApplyingMargin] = createSignal(false);
  const [expandedCollections, setExpandedCollections] = createSignal<Set<string>>(new Set());

  // Group listings by collection_id
  const collectionGroups = createMemo((): CollectionGroup[] => {
    const listings = showroom()?.listings || [];
    const map = new Map<string, CollectionGroup>();
    const ungrouped: ShowroomListing[] = [];
    for (const l of listings) {
      if (!l.collection_id) { ungrouped.push(l); continue; }
      const existing = map.get(l.collection_id);
      if (existing) { existing.listings.push(l); }
      else { map.set(l.collection_id, { collection_id: l.collection_id, collection_name: l.collection_name || "Unnamed", proposed_by_name: l.proposed_by_name || "", listings: [l] }); }
    }
    const groups = Array.from(map.values());
    if (ungrouped.length > 0) groups.push({ collection_id: "__ungrouped__", collection_name: "Other", proposed_by_name: "", listings: ungrouped });
    return groups;
  });

  const visibleCount = () => (showroom()?.listings || []).filter(l => l.status !== "hidden").length;
  const totalCount = () => (showroom()?.listings || []).length;

  // ── Helpers ──

  function toWei(val: string): bigint {
    if (!val || val === "0") return 0n;
    if (val.includes(".")) {
      const [intPart, decPart = ""] = val.split(".");
      const padded = (decPart + "000000000000000000").slice(0, 18);
      return BigInt(intPart || "0") * 1000000000000000000n + BigInt(padded);
    }
    return BigInt(val);
  }

  function formatAvax(val: string) {
    if (!val || val === "0") return "0";
    try {
      const wei = toWei(val);
      const n = Number(wei) / 1e18;
      return n % 1 === 0 ? n.toString() : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    } catch { return val; }
  }

  function listingTotal(listing: ShowroomListing): bigint {
    try { return toWei(listing.base_price || "0") + toWei(listing.margin || "0"); } catch { return 0n; }
  }

  function isHidden(listing: ShowroomListing): boolean {
    return listing.status === "hidden";
  }

  // ── Selection ──

  function toggleSelected(id: string) {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleCollectionSelected(group: CollectionGroup) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = group.listings.every(l => next.has(l.id));
      if (allSelected) group.listings.forEach(l => next.delete(l.id));
      else group.listings.forEach(l => next.add(l.id));
      return next;
    });
  }

  function isCollectionFullySelected(group: CollectionGroup): boolean {
    const sel = selectedIds();
    return group.listings.length > 0 && group.listings.every(l => sel.has(l.id));
  }

  function isCollectionPartiallySelected(group: CollectionGroup): boolean {
    const sel = selectedIds();
    return group.listings.some(l => sel.has(l.id)) && !group.listings.every(l => sel.has(l.id));
  }

  function toggleAll() {
    const listings = showroom()?.listings || [];
    if (selectedIds().size === listings.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(listings.map(l => l.id)));
  }

  function toggleExpanded(collectionId: string) {
    setExpandedCollections(prev => { const next = new Set(prev); if (next.has(collectionId)) next.delete(collectionId); else next.add(collectionId); return next; });
  }

  // ── Actions ──

  async function handleBatchMargin() {
    const sr = showroom();
    const ids = Array.from(selectedIds());
    const margin = batchMargin().trim();
    if (!sr || ids.length === 0 || !margin) return;
    setApplyingMargin(true);
    try {
      await api.batchUpdateMargin(sr.id, ids, margin);
      setSelectedIds(new Set());
      setBatchMargin("");
      refetch();
    } catch (err) { if (import.meta.env.DEV) console.error("Batch margin failed:", err); showToast((err as Error).message); } finally { setApplyingMargin(false); }
  }

  async function handleSingleMargin(listingId: string, marginAvax: string) {
    const sr = showroom();
    if (!sr || !marginAvax.trim()) return;
    try {
      await api.updateShowroomListing(listingId, { margin: marginAvax.trim() });
      refetch();
    } catch (err) { if (import.meta.env.DEV) console.error("Set margin failed:", err); }
  }

  async function handleToggleVisibility(listing: ShowroomListing) {
    const newStatus = listing.status === "hidden" ? "proposed" : "hidden";
    try {
      await api.updateShowroomListing(listing.id, { status: newStatus });
      refetch();
    } catch (err) { if (import.meta.env.DEV) console.error("Toggle visibility failed:", err); }
  }

  const sr = () => showroom();

  // Non-owner: show read-only message
  if (!isOwner()) {
    return (
      <div class="text-center py-20">
        <p class="text-sm" style={{ color: "var(--text-muted)" }}>Only the showroom owner can manage listings.</p>
      </div>
    );
  }

  return (
    <div class="animate-fade-in-up">
      <div class="card" style={{ padding: "0", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>NFT Listings</span>
            <span class="text-xs" style={{ color: "var(--text-muted)" }}>
              {visibleCount() === totalCount() ? `${totalCount()} items` : `${visibleCount()} visible / ${totalCount()} total`}
            </span>
          </div>
          <Show when={totalCount() > 0}>
            <button
              class="text-[10px] px-2 py-1 rounded transition-colors"
              style={{ color: "var(--text-muted)", background: "var(--surface-light)" }}
              onClick={() => {
                const all = collectionGroups().map(g => g.collection_id);
                const allExpanded = all.every(id => expandedCollections().has(id));
                setExpandedCollections(allExpanded ? new Set() : new Set(all));
              }}
            >
              {collectionGroups().every(g => expandedCollections().has(g.collection_id)) ? "Collapse all" : "Expand all"}
            </button>
          </Show>
        </div>

        {/* Batch actions bar */}
        <Show when={selectedIds().size > 0}>
          <div class="flex items-center gap-3" style={{ padding: "10px 20px", background: "rgba(212,168,83,0.06)", "border-bottom": "1px solid var(--border)" }}>
            <span class="text-xs font-medium" style={{ color: "var(--gold)" }}>{selectedIds().size} selected</span>
            <div class="flex items-center gap-2 ml-auto">
              <input type="number" step="0.01" min="0" class="input text-xs w-28" placeholder="Margin (AVAX)" value={batchMargin()} onInput={(e) => setBatchMargin(e.currentTarget.value)} />
              <button class="btn-gold text-xs" disabled={applyingMargin() || !batchMargin().trim()} onClick={handleBatchMargin}>
                {applyingMargin() ? "..." : "Apply margin"}
              </button>
            </div>
          </div>
        </Show>

        <Show
          when={totalCount() > 0}
          fallback={<div class="text-center py-12"><p class="text-sm" style={{ color: "var(--text-muted)" }}>No NFTs proposed yet</p></div>}
        >
          <div style={{ "overflow-x": "auto" }}>
            <table class="w-full" style={{ "border-collapse": "collapse" }}>
              <thead>
                <tr style={{ "border-bottom": "1px solid var(--border)" }}>
                  <th style={{ padding: "10px 12px 10px 20px", width: "40px" }}>
                    <input type="checkbox" checked={selectedIds().size === totalCount() && totalCount() > 0} onChange={toggleAll} class="accent-[var(--gold)]" />
                  </th>
                  <th class="text-left text-[10px] font-medium uppercase tracking-wide" style={{ padding: "10px 12px", color: "var(--text-muted)" }}>NFT</th>
                  <th class="text-right text-[10px] font-medium uppercase tracking-wide" style={{ padding: "10px 12px", color: "var(--text-muted)" }}>Price</th>
                  <th class="text-right text-[10px] font-medium uppercase tracking-wide" style={{ padding: "10px 12px", color: "var(--text-muted)" }}>Margin</th>
                  <th class="text-right text-[10px] font-medium uppercase tracking-wide" style={{ padding: "10px 12px", color: "var(--text-muted)" }}>Total</th>
                  <th style={{ padding: "10px 12px", width: "70px" }} />
                </tr>
              </thead>
              <tbody>
                <For each={collectionGroups()}>
                  {(group) => {
                    const expanded = () => expandedCollections().has(group.collection_id);
                    const visibleListings = () => group.listings.filter(l => !isHidden(l));
                    const groupTotalWei = () => visibleListings().reduce((sum, l) => sum + listingTotal(l), 0n);

                    return (
                      <>
                        {/* Collection group header */}
                        <tr
                          style={{ "border-bottom": "1px solid var(--border)", background: "var(--surface-light)", cursor: "pointer" }}
                          class="hover:bg-white/[0.03] transition-colors"
                          onClick={() => toggleExpanded(group.collection_id)}
                        >
                          <td style={{ padding: "10px 12px 10px 20px", width: "40px" }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isCollectionFullySelected(group)}
                              ref={(el) => { el.indeterminate = isCollectionPartiallySelected(group); }}
                              onChange={() => toggleCollectionSelected(group)}
                              class="accent-[var(--gold)]"
                            />
                          </td>
                          <td style={{ padding: "10px 12px" }} colSpan={2}>
                            <div class="flex items-center gap-2">
                              <span class="text-[10px] transition-transform inline-block" style={{ color: "var(--text-muted)", transform: expanded() ? "rotate(90deg)" : "rotate(0deg)" }}>&#9654;</span>
                              <span class="text-xs font-semibold" style={{ color: "var(--cream)" }}>{group.collection_name}</span>
                              <span class="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                                {visibleListings().length === group.listings.length
                                  ? `${group.listings.length} NFT${group.listings.length > 1 ? "s" : ""}`
                                  : `${visibleListings().length}/${group.listings.length} visible`}
                              </span>
                              <Show when={group.proposed_by_name}>
                                <span class="text-[10px]" style={{ color: "var(--text-muted)" }}>shared by {group.proposed_by_name}</span>
                              </Show>
                            </div>
                          </td>
                          <td />
                          <td class="text-right" style={{ padding: "10px 12px" }}>
                            <span class="text-xs font-mono font-medium" style={{ color: "var(--cream)" }}>{formatAvax(groupTotalWei().toString())} AVAX</span>
                          </td>
                          <td />
                        </tr>

                        {/* NFT rows (expanded) */}
                        <Show when={expanded()}>
                          <For each={group.listings}>
                            {(listing: ShowroomListing) => {
                              const hidden = () => isHidden(listing);
                              return (
                                <tr
                                  style={{ "border-bottom": "1px solid var(--border)", opacity: hidden() ? 0.4 : 1 }}
                                  class="hover:bg-white/[0.02] transition-all"
                                >
                                  <td style={{ padding: "8px 12px 8px 20px", width: "40px" }}>
                                    <input type="checkbox" checked={selectedIds().has(listing.id)} onChange={() => toggleSelected(listing.id)} class="accent-[var(--gold)]" />
                                  </td>
                                  <td style={{ padding: "8px 12px" }}>
                                    <div class="flex items-center gap-3" style={{ "padding-left": "18px" }}>
                                      {listing.image_url ? (
                                        <img src={sanitizeImageUrl(listing.image_url)} alt="" class="w-9 h-9 rounded-lg object-cover shrink-0" style={{ border: "1px solid var(--border)" }} />
                                      ) : (
                                        <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--surface-light)", border: "1px solid var(--border)" }}>
                                          <span class="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>#{listing.token_id}</span>
                                        </div>
                                      )}
                                      <div class="min-w-0">
                                        <p class="text-xs font-medium truncate" style={{ color: "var(--cream)", "text-decoration": hidden() ? "line-through" : "none" }}>{listing.title || `Token #${listing.token_id}`}</p>
                                        <p class="text-[10px] font-mono truncate" style={{ color: "var(--text-muted)" }}>{listing.nft_contract.slice(0, 8)}...#{listing.token_id}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td class="text-right" style={{ padding: "8px 12px" }}>
                                    <span class="text-xs font-mono" style={{ color: "var(--cream)" }}>{formatAvax(listing.base_price)}</span>
                                  </td>
                                  <td class="text-right" style={{ padding: "8px 12px" }}>
                                    <MarginInput value={formatAvax(listing.margin)} onSave={(val) => handleSingleMargin(listing.id, val)} />
                                  </td>
                                  <td class="text-right" style={{ padding: "8px 12px" }}>
                                    <span class="text-xs font-mono font-medium" style={{ color: "var(--cream)" }}>{formatAvax(listingTotal(listing).toString())}</span>
                                  </td>
                                  <td class="text-center" style={{ padding: "8px 12px" }}>
                                    <button
                                      class="text-[10px] px-2 py-1 rounded transition-colors"
                                      style={{
                                        color: hidden() ? "#34d399" : "var(--text-muted)",
                                        background: hidden() ? "rgba(52,211,153,0.1)" : "var(--surface-light)",
                                      }}
                                      onClick={() => handleToggleVisibility(listing)}
                                    >
                                      {hidden() ? "Show" : "Hide"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            }}
                          </For>
                        </Show>
                      </>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </div>
  );
}

/** Inline margin input with save on blur/enter */
function MarginInput(props: { value: string; onSave: (val: string) => void }) {
  const [editing, setEditing] = createSignal(false);
  const [val, setVal] = createSignal(props.value);

  function save() {
    setEditing(false);
    if (val() !== props.value && val().trim()) {
      props.onSave(val());
    }
  }

  return (
    <Show
      when={editing()}
      fallback={
        <button
          class="text-xs font-mono text-right w-full cursor-pointer hover:opacity-80"
          style={{ color: "var(--gold)", background: "none", border: "none" }}
          onClick={() => { setVal(props.value); setEditing(true); }}
        >
          {props.value || "0"}
        </button>
      }
    >
      <input
        type="number"
        step="0.01"
        min="0"
        class="input text-xs text-right w-20 font-mono"
        style={{ padding: "2px 6px" }}
        value={val()}
        onInput={(e) => setVal(e.currentTarget.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        autofocus
      />
    </Show>
  );
}
