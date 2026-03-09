import { Show, For, createResource } from "solid-js";
import { useCollection } from "~/lib/collection-context";
import { api } from "~/lib/api-client";
import type { CollectionHistory as CollectionHistoryType, TokenTransferEvent, PurchaseEvent, PaymentEvent } from "~/lib/api-client";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function weiToAvax(wei: string): string {
  const n = BigInt(wei);
  const whole = n / BigInt(1e18);
  const frac = n % BigInt(1e18);
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fracStr}`;
}

function explorerTxUrl(hash: string) {
  return `https://testnet.snowtrace.io/tx/${hash}`;
}

export default function CollectionHistory() {
  const { collection } = useCollection();

  const [history] = createResource(
    () => collection()?.id && collection()?.contract_nft_address ? collection()!.id : null,
    (id) => api.getCollectionHistory(id)
  );

  // Group all events into a single timeline sorted by block number desc
  const timeline = () => {
    const h = history();
    if (!h) return [];

    type TimelineEntry =
      | { type: "transfer"; data: TokenTransferEvent }
      | { type: "purchase"; data: PurchaseEvent }
      | { type: "payment"; data: PaymentEvent };

    const entries: TimelineEntry[] = [];
    for (const t of h.transfers) entries.push({ type: "transfer", data: t });
    for (const p of h.purchases) entries.push({ type: "purchase", data: p });
    for (const p of h.payments) entries.push({ type: "payment", data: p });

    entries.sort((a, b) => b.data.block_number - a.data.block_number);
    return entries;
  };

  // Aggregate payments per beneficiary
  const beneficiaryTotals = () => {
    const h = history();
    if (!h) return [];
    const map: Record<string, bigint> = {};
    for (const p of h.payments) {
      map[p.beneficiary] = (map[p.beneficiary] || BigInt(0)) + BigInt(p.amount_wei);
    }
    return Object.entries(map)
      .map(([addr, total]) => ({ address: addr, total_wei: total.toString() }))
      .sort((a, b) => (BigInt(b.total_wei) > BigInt(a.total_wei) ? 1 : -1));
  };

  return (
    <div class="space-y-6">
      <Show
        when={!history.loading}
        fallback={
          <div class="flex items-center gap-3 py-12">
            <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
            <span class="text-sm" style={{ color: "var(--text-muted)" }}>Loading on-chain history...</span>
          </div>
        }
      >
        <Show when={history.error}>
          <div class="p-4 rounded-xl text-sm" style={{ background: "rgba(255,59,63,0.08)", color: "var(--accent)", border: "1px solid rgba(255,59,63,0.2)" }}>
            Failed to load history: {(history.error as Error)?.message || "Unknown error"}
          </div>
        </Show>

        <Show when={history()}>
          {(h) => (
            <>
              {/* Summary cards */}
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div class="card p-4">
                  <div class="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Transfers</div>
                  <div class="text-2xl font-bold font-mono mt-1" style={{ color: "var(--cream)" }}>
                    {h().transfers.length}
                  </div>
                </div>
                <div class="card p-4">
                  <div class="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Sales</div>
                  <div class="text-2xl font-bold font-mono mt-1" style={{ color: "var(--cream)" }}>
                    {h().purchases.length}
                  </div>
                </div>
                <div class="card p-4">
                  <div class="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Payments</div>
                  <div class="text-2xl font-bold font-mono mt-1" style={{ color: "var(--cream)" }}>
                    {h().payments.length}
                  </div>
                </div>
                <div class="card p-4">
                  <div class="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Total revenue</div>
                  <div class="text-2xl font-bold font-mono mt-1" style={{ color: "var(--gold)" }}>
                    {weiToAvax(h().total_revenue_wei)}
                  </div>
                  <div class="text-xs" style={{ color: "var(--text-muted)" }}>AVAX</div>
                </div>
              </div>

              {/* Revenue distribution per beneficiary */}
              <Show when={beneficiaryTotals().length > 0}>
                <div class="card p-4 space-y-3">
                  <h4 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
                    Revenue distribution
                  </h4>
                  <For each={beneficiaryTotals()}>
                    {(b) => {
                      const totalBig = BigInt(h().total_revenue_wei);
                      const pct = totalBig > BigInt(0) ? Number((BigInt(b.total_wei) * BigInt(10000)) / totalBig) / 100 : 0;
                      return (
                        <div class="flex items-center gap-3">
                          <code class="text-xs font-mono shrink-0" style={{ color: "var(--cream)" }}>{shortAddr(b.address)}</code>
                          <div class="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-light)" }}>
                            <div class="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--gold)" }} />
                          </div>
                          <span class="text-xs font-mono shrink-0" style={{ color: "var(--gold)" }}>
                            {weiToAvax(b.total_wei)} AVAX
                          </span>
                          <span class="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
                            ({pct.toFixed(1)}%)
                          </span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>

              {/* Timeline */}
              <Show when={timeline().length > 0} fallback={
                <div class="card text-center py-12">
                  <p class="text-sm" style={{ color: "var(--text-muted)" }}>No on-chain events yet.</p>
                </div>
              }>
                <div class="space-y-2">
                  <h4 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
                    Event timeline
                  </h4>
                  <div class="space-y-1">
                    <For each={timeline()}>
                      {(entry) => {
                        if (entry.type === "purchase") {
                          const e = entry.data as PurchaseEvent;
                          return (
                            <a href={explorerTxUrl(e.tx_hash)} target="_blank" rel="noopener noreferrer"
                              class="flex items-center gap-3 p-3 rounded-xl transition-colors"
                              style={{ background: "rgba(212,168,83,0.06)", border: "1px solid rgba(212,168,83,0.15)" }}>
                              <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                style={{ background: "rgba(212,168,83,0.15)" }}>
                                <svg class="w-4 h-4" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                                </svg>
                              </div>
                              <div class="flex-1 min-w-0">
                                <div class="text-sm font-medium" style={{ color: "var(--cream)" }}>
                                  NFT #{e.token_id} purchased
                                </div>
                                <div class="text-xs" style={{ color: "var(--text-muted)" }}>
                                  by {shortAddr(e.buyer)} for <span class="font-mono" style={{ color: "var(--gold)" }}>{weiToAvax(e.price_wei)} AVAX</span>
                                </div>
                              </div>
                              <div class="text-[10px] font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
                                Block {e.block_number}
                              </div>
                            </a>
                          );
                        }

                        if (entry.type === "payment") {
                          const e = entry.data as PaymentEvent;
                          return (
                            <a href={explorerTxUrl(e.tx_hash)} target="_blank" rel="noopener noreferrer"
                              class="flex items-center gap-3 p-3 rounded-xl transition-colors"
                              style={{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.15)" }}>
                              <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                style={{ background: "rgba(52,211,153,0.15)" }}>
                                <svg class="w-4 h-4" style={{ color: "var(--emerald)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                </svg>
                              </div>
                              <div class="flex-1 min-w-0">
                                <div class="text-sm font-medium" style={{ color: "var(--cream)" }}>
                                  Payment to {shortAddr(e.beneficiary)}
                                </div>
                                <div class="text-xs font-mono" style={{ color: "var(--emerald)" }}>
                                  {weiToAvax(e.amount_wei)} AVAX
                                </div>
                              </div>
                              <div class="text-[10px] font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
                                Block {e.block_number}
                              </div>
                            </a>
                          );
                        }

                        // transfer
                        const e = entry.data as TokenTransferEvent;
                        const isMint = e.from === ZERO_ADDR;
                        return (
                          <a href={explorerTxUrl(e.tx_hash)} target="_blank" rel="noopener noreferrer"
                            class="flex items-center gap-3 p-3 rounded-xl transition-colors"
                            style={{ background: "var(--surface-light)", border: "1px solid var(--border)" }}>
                            <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                              style={{ background: isMint ? "rgba(139,92,246,0.15)" : "rgba(212,168,83,0.08)" }}>
                              <svg class="w-4 h-4" style={{ color: isMint ? "var(--violet)" : "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                              </svg>
                            </div>
                            <div class="flex-1 min-w-0">
                              <div class="text-sm font-medium" style={{ color: "var(--cream)" }}>
                                {isMint ? `NFT #${e.token_id} minted` : `NFT #${e.token_id} transferred`}
                              </div>
                              <div class="text-xs" style={{ color: "var(--text-muted)" }}>
                                {isMint ? `to ${shortAddr(e.to)}` : `${shortAddr(e.from)} → ${shortAddr(e.to)}`}
                              </div>
                            </div>
                            <div class="text-[10px] font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
                              Block {e.block_number}
                            </div>
                          </a>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
