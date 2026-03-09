import { createSignal, Show } from "solid-js";
import { useShowroom } from "~/lib/showroom-context";

const VALID_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
function isValidAddress(addr: string | null | undefined): boolean {
  return !!addr && VALID_ADDRESS_RE.test(addr);
}

export default function ShowroomIntegration() {
  const { showroom } = useShowroom();
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
    name: import.meta.env.VITE_CHAIN_LABEL || "Avalanche Fuji Testnet",
    chainId: Number(import.meta.env.VITE_CHAIN_ID || "43113"),
    explorer: import.meta.env.VITE_CHAIN_EXPLORER || "https://testnet.snowtrace.io",
  });

  return (
    <div class="space-y-6">
      {/* Network */}
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
                <a href={chain().explorer} target="_blank" rel="noopener noreferrer" style={{ color: "var(--gold)" }}>{chain().explorer}</a>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Contract */}
      <div class="card" style={{ padding: "0", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", gap: "8px" }}>
          <div style={{ width: "6px", height: "6px", "border-radius": "50%", background: "var(--gold)" }} />
          <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Smart Contract</span>
        </div>
        <div>
          <Show when={isValidAddress(showroom()?.contract_address)} fallback={
            <div style={{ padding: "20px", "text-align": "center" }}>
              <span class="text-sm" style={{ color: "var(--text-muted)" }}>No contract deployed yet. Deploy the showroom first.</span>
            </div>
          }>
            <div style={{
              padding: "14px 20px",
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              gap: "12px",
            }}>
              <div style={{ "min-width": "0" }}>
                <span class="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)", "letter-spacing": "0.06em" }}>
                  Showroom Contract
                </span>
                <div class="flex items-center gap-2 mt-1">
                  <code class="font-mono text-sm truncate" style={{ color: "var(--cream)" }}>
                    {showroom()?.contract_address}
                  </code>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button
                  class="text-xs px-2.5 py-1 rounded-md transition-colors"
                  style={{
                    border: "1px solid var(--border)",
                    background: copied() === "showroom" ? "rgba(52,211,153,0.15)" : "transparent",
                    color: copied() === "showroom" ? "var(--emerald)" : "var(--text-muted)",
                  }}
                  onClick={() => copy(showroom()!.contract_address!, "showroom")}
                >
                  {copied() === "showroom" ? "Copied!" : "Copy"}
                </button>
                <a
                  href={`${chain().explorer}/address/${showroom()?.contract_address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xs px-2.5 py-1 rounded-md transition-colors"
                  style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
                >
                  Explorer
                </a>
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* Public URL */}
      <Show when={showroom()?.public_slug && showroom()?.is_public}>
        <div class="card" style={{ padding: "0", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", "border-bottom": "1px solid var(--border)", display: "flex", "align-items": "center", gap: "8px" }}>
            <div style={{ width: "6px", height: "6px", "border-radius": "50%", background: "var(--emerald)" }} />
            <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Public Sale Page</span>
          </div>
          <div style={{
            padding: "14px 20px",
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "12px",
          }}>
            <div style={{ "min-width": "0" }}>
              <code class="font-mono text-sm truncate" style={{ color: "var(--cream)" }}>
                {window.location.origin}/showroom/sale/{showroom()?.public_slug}
              </code>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                class="text-xs px-2.5 py-1 rounded-md transition-colors"
                style={{
                  border: "1px solid var(--border)",
                  background: copied() === "url" ? "rgba(52,211,153,0.15)" : "transparent",
                  color: copied() === "url" ? "var(--emerald)" : "var(--text-muted)",
                }}
                onClick={() => copy(`${window.location.origin}/showroom/sale/${showroom()?.public_slug}`, "url")}
              >
                {copied() === "url" ? "Copied!" : "Copy"}
              </button>
              <a
                href={`/showroom/sale/${showroom()?.public_slug}`}
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs px-2.5 py-1 rounded-md transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--gold)" }}
              >
                Open
              </a>
            </div>
          </div>
        </div>
      </Show>

      {/* Docs link */}
      <div class="card" style={{ padding: "14px 20px", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
        <span class="text-sm" style={{ color: "var(--text-muted)" }}>Code examples and integration guide</span>
        <a href="/docs" class="text-xs font-medium" style={{ color: "var(--gold)" }}>Documentation</a>
      </div>
    </div>
  );
}
