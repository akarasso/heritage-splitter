import { createSignal, For, Show } from "solid-js";

interface DocSection {
  id: string;
  title: string;
  items: DocItem[];
}

interface DocItem {
  title: string;
  description: string;
  method?: string;
  path?: string;
  auth?: boolean;
  code?: string;
  params?: { name: string; type: string; desc: string }[];
}

const BLOCKCHAIN_SECTIONS: DocSection[] = [
  {
    id: "smart-contracts",
    title: "Smart Contracts",
    items: [
      {
        title: "Architecture",
        description:
          "Each collection deploys 3 linked contracts:\n\n- CollectionNFT (ERC-721 Enumerable + ERC-2981 Royalties) — the tokens\n- ArtistsSplitter — automatic revenue redistribution among beneficiaries\n- NFTMarket — primary sale market at fixed price\n\nThe creator is the owner of all contracts. The backend is authorized as a minter for gas-free operations.",
        code: `// Addresses deployed after collection creation
// Available via GET /api/collections/{id}

{
  "contract_nft_address": "0x...",
  "contract_splitter_address": "0x...",
  "contract_market_address": "0x..."
}`,
      },
      {
        title: "List NFTs available for purchase",
        description:
          "Queries the market to get all tokens for sale with their prices in wei.",
        code: `import { createPublicClient, http } from 'viem'
import { appChain, chainRpc } from '~/config/chain'

const client = createPublicClient({
  chain: appChain,
  transport: http(chainRpc)
})

const [tokenIds, prices] = await client.readContract({
  address: MARKET_ADDRESS,
  abi: [{
    name: 'listAvailableTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'tokenIds', type: 'uint256[]' },
      { name: 'prices', type: 'uint256[]' }
    ]
  }],
  functionName: 'listAvailableTokens'
})`,
      },
      {
        title: "Read NFT metadata",
        description:
          "Retrieves the metadata URI (JSON) of a token. Contains name, description, image and attributes.",
        code: `const tokenURI = await client.readContract({
  address: NFT_ADDRESS,
  abi: [{
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }]
  }],
  functionName: 'tokenURI',
  args: [0n]
})`,
      },
      {
        title: "Buy an NFT (primary sale)",
        description:
          "Sends a payable transaction to the market. 100% of the payment is redistributed via the splitter to beneficiaries.",
        code: `import { createWalletClient, custom } from 'viem'

const wallet = createWalletClient({
  chain: appChain,
  transport: custom(window.ethereum)
})

const hash = await wallet.writeContract({
  address: MARKET_ADDRESS,
  abi: [{
    name: 'purchase',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'maxPrice', type: 'uint256' }],
    outputs: []
  }],
  functionName: 'purchase',
  args: [0n, price], // tokenId, maxPrice (slippage protection)
  value: price // in wei
})`,
      },
      {
        title: "Verify royalties (ERC-2981)",
        description:
          "Queries the NFT contract to determine the recipient and amount of royalties on secondary sales. Royalties are sent to the splitter.",
        code: `import { parseEther } from 'viem'

const [receiver, amount] = await client.readContract({
  address: NFT_ADDRESS,
  abi: [{
    name: 'royaltyInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'salePrice', type: 'uint256' }
    ],
    outputs: [
      { name: 'receiver', type: 'address' },
      { name: 'royaltyAmount', type: 'uint256' }
    ]
  }],
  functionName: 'royaltyInfo',
  args: [0n, parseEther('1')]
})`,
      },
      {
        title: "List NFTs by owner (ERC-721 Enumerable)",
        description:
          "Uses the Enumerable extension to list all tokens of an address without indexing Transfer events.",
        code: `const balance = await client.readContract({
  address: NFT_ADDRESS,
  abi: [{
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }],
  functionName: 'balanceOf',
  args: [ownerAddress]
})

// For each index 0..balance-1:
const tokenId = await client.readContract({
  address: NFT_ADDRESS,
  abi: [{
    name: 'tokenOfOwnerByIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  }],
  functionName: 'tokenOfOwnerByIndex',
  args: [ownerAddress, BigInt(i)]
})`,
      },
      {
        title: "Burn an NFT",
        description:
          "The owner of a token can burn it directly on-chain. Only the token owner can call burn().",
        code: `const hash = await wallet.writeContract({
  address: NFT_ADDRESS,
  abi: [{
    name: 'burn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: []
  }],
  functionName: 'burn',
  args: [tokenId]
})`,
      },
    ],
  },
];

export default function Documentation() {
  const [openItems, setOpenItems] = createSignal<Set<string>>(new Set());
  const [copiedCode, setCopiedCode] = createSignal<string | null>(null);

  function toggleItem(key: string) {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copyCode(code: string, key: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedCode(key);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  const methodColor = (method?: string) => {
    switch (method) {
      case "GET": return "#34d399";
      case "POST": return "#60a5fa";
      case "PUT": return "#fbbf24";
      case "DELETE": return "#f87171";
      default: return "var(--text-muted)";
    }
  };

  return (
    <div class="max-w-5xl mx-auto px-6 py-10">
      {/* Header */}
      <div class="mb-8">
        <h1 class="font-display text-2xl font-bold mb-2" style={{ color: "var(--cream)" }}>
          Documentation
        </h1>
        <p class="text-sm" style={{ color: "var(--text-muted)" }}>
          Integration guide for Heritage Splitter smart contracts on Avalanche.
        </p>
      </div>

      {/* Content */}
      <For each={BLOCKCHAIN_SECTIONS}>
        {(section) => (
          <div class="mb-8">
            <h2
              class="font-display text-lg font-semibold mb-3 flex items-center gap-2"
              style={{ color: "var(--gold)" }}
            >
              <div style={{ width: "6px", height: "6px", "border-radius": "50%", background: "var(--gold)" }} />
              {section.title}
            </h2>

            <div class="card" style={{ padding: "0", overflow: "hidden" }}>
              <For each={section.items}>
                {(item, i) => {
                  const key = `${section.id}-${i()}`;
                  return (
                    <div style={{ "border-bottom": i() < section.items.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {/* Item header */}
                      <button
                        onClick={() => toggleItem(key)}
                        style={{
                          width: "100%",
                          display: "flex",
                          "align-items": "center",
                          gap: "12px",
                          padding: "14px 20px",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          "text-align": "left",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--noir-light)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <svg
                          width="12" height="12" viewBox="0 0 14 14" fill="none"
                          style={{
                            "flex-shrink": "0",
                            transform: openItems().has(key) ? "rotate(90deg)" : "rotate(0deg)",
                            transition: "transform 0.2s ease",
                          }}
                        >
                          <path d="M5 3L9 7L5 11" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>

                        <Show when={item.method}>
                          <span
                            class="font-mono text-xs font-bold px-2 py-0.5 rounded"
                            style={{ color: methodColor(item.method), background: `${methodColor(item.method)}15`, "flex-shrink": "0" }}
                          >
                            {item.method}
                          </span>
                        </Show>

                        <Show when={item.path}>
                          <code class="font-mono text-xs" style={{ color: "var(--cream-muted)", "flex-shrink": "0" }}>
                            {item.path}
                          </code>
                        </Show>

                        <span
                          style={{
                            "font-size": "0.85rem",
                            "font-weight": "500",
                            color: openItems().has(key) ? "var(--gold)" : "var(--cream-muted)",
                            transition: "color 0.15s",
                            "margin-left": item.path ? "auto" : "0",
                          }}
                        >
                          {item.title}
                        </span>

                        <Show when={item.auth !== undefined}>
                          <span
                            class="text-xs px-1.5 py-0.5 rounded ml-auto"
                            style={{
                              background: item.auth ? "rgba(139,92,246,0.15)" : "rgba(52,211,153,0.15)",
                              color: item.auth ? "#a78bfa" : "#34d399",
                              "flex-shrink": "0",
                            }}
                          >
                            {item.auth ? "Auth" : "Public"}
                          </span>
                        </Show>
                      </button>

                      {/* Collapsible content */}
                      <div
                        style={{
                          "max-height": openItems().has(key) ? "1200px" : "0",
                          overflow: "hidden",
                          transition: "max-height 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      >
                        <div style={{ padding: "0 20px 16px 20px" }}>
                          <p
                            style={{
                              "font-size": "0.8rem",
                              color: "var(--text-muted)",
                              "line-height": "1.6",
                              margin: "0 0 12px 0",
                              "white-space": "pre-line",
                            }}
                          >
                            {item.description}
                          </p>

                          {/* Params table */}
                          <Show when={item.params && item.params.length > 0}>
                            <div
                              style={{
                                "border-radius": "8px",
                                border: "1px solid var(--border)",
                                overflow: "hidden",
                                "margin-bottom": "12px",
                              }}
                            >
                              <table style={{ width: "100%", "border-collapse": "collapse" }}>
                                <thead>
                                  <tr style={{ background: "var(--noir-light)" }}>
                                    <th style={{ padding: "8px 12px", "text-align": "left", "font-size": "0.7rem", color: "var(--text-muted)", "text-transform": "uppercase", "letter-spacing": "0.05em" }}>Parameter</th>
                                    <th style={{ padding: "8px 12px", "text-align": "left", "font-size": "0.7rem", color: "var(--text-muted)", "text-transform": "uppercase", "letter-spacing": "0.05em" }}>Type</th>
                                    <th style={{ padding: "8px 12px", "text-align": "left", "font-size": "0.7rem", color: "var(--text-muted)", "text-transform": "uppercase", "letter-spacing": "0.05em" }}>Description</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <For each={item.params}>
                                    {(param) => (
                                      <tr style={{ "border-top": "1px solid var(--border)" }}>
                                        <td style={{ padding: "8px 12px" }}>
                                          <code class="font-mono" style={{ "font-size": "0.75rem", color: "var(--gold)" }}>{param.name}</code>
                                        </td>
                                        <td style={{ padding: "8px 12px" }}>
                                          <code class="font-mono" style={{ "font-size": "0.75rem", color: "var(--cream-muted)" }}>{param.type}</code>
                                        </td>
                                        <td style={{ padding: "8px 12px", "font-size": "0.75rem", color: "var(--text-muted)" }}>{param.desc}</td>
                                      </tr>
                                    )}
                                  </For>
                                </tbody>
                              </table>
                            </div>
                          </Show>

                          {/* Code block */}
                          <Show when={item.code}>
                            <div style={{ position: "relative", "border-radius": "10px", overflow: "hidden", border: "1px solid var(--border)" }}>
                              <button
                                onClick={() => copyCode(item.code!, key)}
                                style={{
                                  position: "absolute",
                                  top: "8px",
                                  right: "8px",
                                  padding: "3px 10px",
                                  "border-radius": "6px",
                                  border: "1px solid var(--border-light)",
                                  background: copiedCode() === key ? "rgba(52,211,153,0.15)" : "var(--surface)",
                                  color: copiedCode() === key ? "var(--emerald)" : "var(--text-muted)",
                                  "font-size": "0.65rem",
                                  cursor: "pointer",
                                  "z-index": "1",
                                }}
                              >
                                {copiedCode() === key ? "Copied!" : "Copy"}
                              </button>
                              <pre
                                class="font-mono"
                                style={{
                                  margin: "0",
                                  padding: "14px 18px",
                                  background: "var(--noir)",
                                  "font-size": "0.72rem",
                                  "line-height": "1.6",
                                  color: "var(--cream-muted)",
                                  "overflow-x": "auto",
                                }}
                              >
                                <code>{item.code}</code>
                              </pre>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        )}
      </For>

      {/* Footer info */}
      <div class="card mt-8" style={{ padding: "20px 24px" }}>
        <div class="flex items-center gap-3 mb-3">
          <div style={{ width: "6px", height: "6px", "border-radius": "50%", background: "var(--emerald)" }} />
          <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Information</span>
        </div>
        <div class="text-xs space-y-1.5" style={{ color: "var(--text-muted)", "line-height": "1.6" }}>
          <p>Network: Avalanche Fuji Testnet (Chain ID: 43113)</p>
          <p>RPC: https://api.avax-test.network/ext/bc/C/rpc</p>
          <p>Explorer: https://testnet.snowtrace.io</p>
          <p>API Base: /api (relative to the main domain)</p>
          <p>Authentication: Bearer token JWT (Authorization header)</p>
        </div>
      </div>
    </div>
  );
}
