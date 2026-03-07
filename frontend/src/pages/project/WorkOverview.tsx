import { Show, createSignal } from "solid-js";
import { useWork } from "~/lib/work-context";
import { api } from "~/lib/api-client";
import { showAlert, showConfirm } from "~/lib/modal-store";
import { getPublicSaleUrl } from "~/lib/domains";

const POST_DEPLOY_STATUSES = ["deployed", "pending_mint_approval", "mint_ready"];

export default function WorkOverview() {
  const { work, refetch, isCreator } = useWork();
  const [editingRoyalty, setEditingRoyalty] = createSignal(false);
  const [royaltyInput, setRoyaltyInput] = createSignal("");
  const [savingRoyalty, setSavingRoyalty] = createSignal(false);
  const [publishing, setPublishing] = createSignal(false);
  const [unpublishing, setUnpublishing] = createSignal(false);
  const [copiedUrl, setCopiedUrl] = createSignal(false);

  const isPostDeploy = () => POST_DEPLOY_STATUSES.includes(work()?.status || "");

  async function copyUrl() {
    const url = getPublicSaleUrl(work()!.public_slug!);
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
      await api.publishWork(work()!.id);
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
          await api.unpublishWork(work()!.id);
          refetch();
        } catch (e) {
          showAlert({ title: "Error", message: (e as Error).message });
        } finally {
          setUnpublishing(false);
        }
      },
    });
  }

  const participantStats = () => {
    const allocs = work()?.allocations || [];
    const acceptedIds = new Set<string>();
    const pendingIds = new Set<string>();
    for (const a of allocs) {
      for (const p of a.participants) {
        if (!p.user_id || p.status === "rejected" || p.status === "kicked") continue;
        if (p.status === "accepted") {
          acceptedIds.add(p.user_id);
        } else {
          pendingIds.add(p.user_id);
        }
      }
    }
    // Remove from pending those already in accepted
    for (const id of acceptedIds) pendingIds.delete(id);
    // +1 for the creator who always has a share (creator_shares_bps)
    return { accepted: acceptedIds.size + 1, pending: pendingIds.size, total: acceptedIds.size + pendingIds.size + 1 };
  };

  function startEditRoyalty() {
    setRoyaltyInput(String((work()?.royalty_bps || 0) / 100));
    setEditingRoyalty(true);
  }

  async function handleSaveRoyalty() {
    const pct = parseFloat(royaltyInput());
    if (isNaN(pct) || pct < 0 || pct > 100) {
      showAlert({ title: "Invalid percentage", message: "The percentage must be between 0 and 100." });
      return;
    }
    setSavingRoyalty(true);
    try {
      await api.updateWork(work()!.id, { royalty_bps: Math.round(pct * 100) });
      setEditingRoyalty(false);
      refetch();
    } catch (e) {
      showAlert({ title: "Error", message: (e as Error).message });
    } finally {
      setSavingRoyalty(false);
    }
  }

  return (
    <div class="space-y-6">
      {/* Summary cards */}
      <div class="grid grid-cols-2 gap-4">
        <div class="card text-center">
          <div class="text-2xl font-bold font-mono" style={{ color: "var(--gold)" }}>
            {(work()?.allocations || []).length + 1}
          </div>
          <div class="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Shares</div>
        </div>
        <div class="card text-center">
          <div class="text-2xl font-bold font-mono" style={{ color: "var(--gold)" }}>
            {participantStats().total}
          </div>
          <div class="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Participant{participantStats().total !== 1 ? "s" : ""}
            <Show when={participantStats().pending > 0}>
              <span class="ml-1" style={{ color: "var(--gold)" }}>
                ({participantStats().pending} pending)
              </span>
            </Show>
          </div>
        </div>
      </div>

      {/* Info */}
      <div class="card">
        <div class="space-y-3 text-sm">
          <div class="flex justify-between">
            <span style={{ color: "var(--text-muted)" }}>Type</span>
            <span style={{ color: "var(--cream)" }}>
              NFT Collection
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span style={{ color: "var(--text-muted)" }}>Royalties</span>
            <Show when={editingRoyalty()} fallback={
              <div class="flex items-center gap-2">
                <span style={{ color: "var(--cream)" }}>{(work()?.royalty_bps || 0) / 100}%</span>
                <Show when={work()?.status === "draft" && isCreator()}>
                  <button class="text-xs px-2 py-0.5 rounded-lg transition-colors"
                    style={{ color: "var(--gold)", background: "rgba(212,168,83,0.08)" }}
                    onClick={startEditRoyalty}>Edit</button>
                </Show>
              </div>
            }>
              <div class="flex items-center gap-2">
                <input class="input w-20 text-right text-sm" type="number" min="0" max="100" step="0.1"
                  value={royaltyInput()} onInput={(e) => setRoyaltyInput(e.currentTarget.value)} />
                <span class="text-xs" style={{ color: "var(--text-muted)" }}>%</span>
                <button class="text-xs px-2 py-0.5 rounded-lg font-medium"
                  style={{ color: "var(--noir)", background: "var(--gold)" }}
                  onClick={handleSaveRoyalty} disabled={savingRoyalty()}>
                  {savingRoyalty() ? "..." : "OK"}
                </button>
                <button class="text-xs px-2 py-0.5 rounded-lg"
                  style={{ color: "var(--text-muted)", background: "var(--surface-light)" }}
                  onClick={() => setEditingRoyalty(false)}>Cancel</button>
              </div>
            </Show>
          </div>
          <Show when={work()?.work_type === "nft_collection"}>
            <div class="flex justify-between">
              <span style={{ color: "var(--text-muted)" }}>NFTs minted</span>
              <span style={{ color: "var(--cream)" }}>{(work()?.nfts || []).length}</span>
            </div>
          </Show>
        </div>
      </div>

      {/* Publish / Public URL — post-deploy */}
      <Show when={isPostDeploy()}>
        <Show when={!work()?.is_public}>
          <button
            class="btn-gold w-full text-sm"
            onClick={handlePublish}
            disabled={publishing()}
            style={{ opacity: publishing() ? "0.7" : "1" }}
          >
            {publishing() ? "Publishing..." : "Create a public sale page"}
          </button>
        </Show>

        <Show when={work()?.is_public && work()?.public_slug}>
          <div class="card" style={{ padding: "0", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "14px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full" style={{ background: "var(--emerald)" }} />
                <span class="text-sm font-medium" style={{ color: "var(--emerald)" }}>Sale page active</span>
              </div>
              <Show when={isCreator()}>
                <button
                  class="text-xs px-2.5 py-1 rounded-md transition-colors"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
                  onClick={handleUnpublish}
                  disabled={unpublishing()}
                >
                  Remove public link
                </button>
              </Show>
            </div>

            {/* URL row */}
            <div style={{ padding: "16px 20px", display: "flex", "align-items": "center", gap: "12px" }}>
              <a
                href={getPublicSaleUrl(work()!.public_slug!)}
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm font-mono flex-1"
                style={{ color: "var(--gold)", "word-break": "break-all" }}
              >
                {getPublicSaleUrl(work()!.public_slug!)}
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
                  href={getPublicSaleUrl(work()!.public_slug!)}
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

    </div>
  );
}
