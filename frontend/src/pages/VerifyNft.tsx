import { Show, createResource, For } from "solid-js";
import { useParams } from "@solidjs/router";
import { api } from "~/lib/api-client";
import { shortenAddress, bpsToPercent, ROLE_LABELS } from "~/lib/utils";

export default function VerifyNft() {
  const params = useParams();
  const [data] = createResource(
    () => {
      const tokenId = parseInt(params.token);
      if (isNaN(tokenId)) return null;
      const contract = params.contract;
      if (!contract || !/^0x[0-9a-fA-F]{40}$/.test(contract)) return null;
      return { contract, tokenId };
    },
    (source) => source ? api.verifyNft(source.contract, source.tokenId) : Promise.reject("Invalid parameters")
  );

  return (
    <div class="gradient-bg noise-bg min-h-screen">
      <div class="relative z-10 max-w-2xl mx-auto px-6 py-16">
        {/* Header */}
        <div class="text-center mb-12">
          <div
            class="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" }}
          >
            <svg class="w-10 h-10" style={{ color: "var(--emerald)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
          </div>
          <h1 class="font-display text-4xl font-bold mb-2" style={{ color: "var(--cream)" }}>
            Verify <span class="italic" style={{ color: "var(--emerald)" }}>NFT</span>
          </h1>
          <p class="text-sm" style={{ color: "var(--text-muted)" }}>On-chain certificate of authenticity</p>
        </div>

        <Show
          when={data()}
          fallback={
            <div class="flex items-center justify-center gap-3 py-12">
              <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
              <span class="text-sm" style={{ color: "var(--text-muted)" }}>Verifying...</span>
            </div>
          }
        >
          {(d) => (
            <div class="space-y-6">
              {/* NFT Info */}
              <div class="card">
                <h3 class="font-display text-2xl font-bold mb-5" style={{ color: "var(--cream)" }}>{d().nft.title}</h3>
                <div class="space-y-3">
                  {[
                    { label: "Token ID", value: `#${d().nft.token_id}` },
                  ].map((row) => (
                    <div class="flex items-center justify-between py-2" style={{ "border-bottom": "1px solid var(--border)" }}>
                      <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{row.label}</span>
                      <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>{row.value}</span>
                    </div>
                  ))}
                  <div class="flex items-center justify-between py-2" style={{ "border-bottom": "1px solid var(--border)" }}>
                    <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Phase</span>
                    <span
                      class="text-sm font-medium"
                      style={{ color: d().nft.phase === "primary" ? "var(--gold)" : "var(--emerald)" }}
                    >
                      {d().nft.phase === "primary" ? "Primary" : "Secondary"}
                    </span>
                  </div>
                  <div class="flex items-center justify-between py-2">
                    <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Contract</span>
                    <code class="text-xs font-mono" style={{ color: "var(--cream-muted)" }}>{shortenAddress(params.contract)}</code>
                  </div>
                </div>
              </div>

              {/* Project & Rights holders */}
              <div class="card">
                <h3 class="font-display text-xl font-bold mb-1" style={{ color: "var(--cream)" }}>{d().project.name}</h3>
                <p class="text-sm mb-6" style={{ color: "var(--cream-muted)" }}>{d().project.description}</p>

                <h4 class="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "var(--text-muted)" }}>Rights holders</h4>
                <div class="space-y-2">
                  <For each={d().participants}>
                    {(p) => (
                      <div class="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--noir-light)" }}>
                        <div class="flex items-center gap-3">
                          <div
                            class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                            style={{ background: "var(--surface-light)", color: "var(--gold)" }}
                          >
                            {(ROLE_LABELS[p.role] || p.role)[0]}
                          </div>
                          <div>
                            <span class="text-sm" style={{ color: "var(--cream-muted)" }}>
                              {ROLE_LABELS[p.role] || p.role}
                            </span>
                            <span class="text-xs font-mono ml-2" style={{ color: "var(--text-muted)" }}>
                              {shortenAddress(p.wallet_address)}
                            </span>
                          </div>
                        </div>
                        <span class="text-sm font-bold font-mono" style={{ color: "var(--cream)" }}>{bpsToPercent(p.shares_bps)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* Legal */}
              <div class="card" style={{ background: "rgba(212,168,83,0.05)", border: "1px solid rgba(212,168,83,0.2)" }}>
                <div class="flex items-center gap-2 mb-3">
                  <div class="w-1.5 h-1.5 rounded-full" style={{ background: "var(--gold)" }} />
                  <h3 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--gold)" }}>
                    Legal compliance
                  </h3>
                </div>
                <p class="text-sm leading-relaxed" style={{ color: "var(--cream-muted)" }}>
                  This contract complies with the French Intellectual Property Code (CPI L122-8).
                  Primary phase: 100% to the producer (VAT 5.5%, social contributions ~17%).
                  Secondary phase: automatic trustless distribution among rights holders.
                </p>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
