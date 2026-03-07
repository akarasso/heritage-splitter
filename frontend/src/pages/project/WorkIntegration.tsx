import { createSignal, Show } from "solid-js";
import { useWork } from "~/lib/work-context";

const VALID_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
function isValidAddress(addr: string | null | undefined): boolean {
  return !!addr && VALID_ADDRESS_RE.test(addr);
}

export default function WorkIntegration() {
  const { work } = useWork();
  const [copied, setCopied] = createSignal<string | null>(null);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  const chain = () => ({
    name: "Avalanche Fuji Testnet",
    chainId: 43113,
    rpc: "https://api.avax-test.network/ext/bc/C/rpc",
    explorer: "https://testnet.snowtrace.io",
  });

  const contracts = () => [
    { label: "NFT (ERC-721)", address: work()?.contract_nft_address, key: "nft" },
    { label: "Revenue Splitter", address: work()?.contract_splitter_address, key: "splitter" },
    { label: "NFT Market", address: work()?.contract_vault_address, key: "vault" },
  ];

  return (
    <div class="space-y-6">
      {/* Blockchain */}
      <div class="card" style={{ padding: "0", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", gap: "8px" }}>
          <div style={{ width: "6px", height: "6px", "border-radius": "50%", background: "var(--emerald)" }} />
          <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Network</span>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <div class="grid gap-3" style={{ "grid-template-columns": "1fr 1fr" }}>
            <div>
              <span class="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Chain</span>
              <p class="text-sm mt-0.5" style={{ color: "var(--cream)" }}>{chain().name}</p>
            </div>
            <div>
              <span class="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Chain ID</span>
              <p class="text-sm mt-0.5 font-mono" style={{ color: "var(--cream)" }}>{chain().chainId}</p>
            </div>
            <div style={{ "grid-column": "span 2" }}>
              <span class="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Explorer</span>
              <p class="text-sm mt-0.5">
                <a href={chain().explorer} target="_blank" rel="noopener" style={{ color: "var(--gold)" }}>{chain().explorer}</a>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Contracts */}
      <div class="card" style={{ padding: "0", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", gap: "8px" }}>
          <div style={{ width: "6px", height: "6px", "border-radius": "50%", background: "var(--gold)" }} />
          <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Smart Contracts</span>
        </div>
        <div>
          {contracts().map((c) => (
            <Show when={c.address && isValidAddress(c.address)}>
              <div
                style={{
                  padding: "14px 20px",
                  "border-bottom": "1px solid var(--border)",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  gap: "12px",
                }}
              >
                <div style={{ "min-width": "0" }}>
                  <span class="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)", "letter-spacing": "0.06em" }}>
                    {c.label}
                  </span>
                  <div class="flex items-center gap-2 mt-1">
                    <code class="font-mono text-sm truncate" style={{ color: "var(--cream)" }}>
                      {c.address}
                    </code>
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <button
                    class="text-xs px-2.5 py-1 rounded-md transition-colors"
                    style={{
                      border: "1px solid var(--border)",
                      background: copied() === c.key ? "rgba(52,211,153,0.15)" : "transparent",
                      color: copied() === c.key ? "var(--emerald)" : "var(--text-muted)",
                    }}
                    onClick={() => copy(c.address!, c.key)}
                  >
                    {copied() === c.key ? "Copied!" : "Copy"}
                  </button>
                  <a
                    href={`${chain().explorer}/address/${c.address}`}
                    target="_blank"
                    rel="noopener"
                    class="text-xs px-2.5 py-1 rounded-md transition-colors"
                    style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
                  >
                    Explorer
                  </a>
                </div>
              </div>
            </Show>
          ))}
        </div>
      </div>

      {/* Link to full docs */}
      <div class="card" style={{ padding: "14px 20px", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
        <span class="text-sm" style={{ color: "var(--text-muted)" }}>Code examples and integration guide</span>
        <a href="/docs" class="text-xs font-medium" style={{ color: "var(--gold)" }}>Documentation</a>
      </div>
    </div>
  );
}
