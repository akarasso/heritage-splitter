import { createResource, Show, For, createSignal, createEffect } from "solid-js";
import { useParams } from "@solidjs/router";
import type { RouteSectionProps } from "@solidjs/router";
import { createWalletClient, createPublicClient, custom, http, formatEther, parseEther } from "viem";
import { appChain, chainIdHex, chainRpc, chainName } from "~/config/chain";
import { api } from "~/lib/api-client";
import type { PublicShowroomListing } from "~/lib/api-client";
import { LogoFull } from "~/components/ui/Logo";
import { sanitizeImageUrl } from "~/lib/utils";

const SHOWROOM_ABI = [
  {
    name: "purchase",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "nft", type: "address" }, { name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "listAvailable",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "nftContracts", type: "address[]" },
      { name: "tokenIds", type: "uint256[]" },
      { name: "markets", type: "address[]" },
      { name: "marketListingIds", type: "uint256[]" },
      { name: "margins", type: "uint256[]" },
      { name: "basePrices", type: "uint256[]" },
    ],
  },
] as const;

function nftKey(nftContract: string, tokenId: number | bigint): string {
  return `${nftContract.toLowerCase()}:${tokenId}`;
}

function formatAvax(wei: string): string {
  try {
    return parseFloat(formatEther(BigInt(wei))).toFixed(4);
  } catch {
    return "0";
  }
}

export default function PublicShowroom(props: RouteSectionProps) {
  const params = useParams<{ slug: string }>();
  const [showroom] = createResource(() => params.slug, async (slug) => {
    try {
      return await api.getPublicShowroom(slug);
    } catch {
      return null;
    }
  });

  const [detailNft, setDetailNft] = createSignal<PublicShowroomListing | null>(null);
  const [purchasingKey, setPurchasingKey] = createSignal<string | null>(null);
  const [purchaseError, setPurchaseError] = createSignal<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = createSignal<string | null>(null);
  // Track sold items: "nft:tokenId" → true
  const [soldMap, setSoldMap] = createSignal<Record<string, boolean>>({});
  // On-chain prices: "nft:tokenId" → { basePrice, margin }
  const [priceMap, setPriceMap] = createSignal<Record<string, { basePrice: bigint; margin: bigint }>>({});

  // Load on-chain data via listAvailable()
  async function loadOnChainData() {
    const sr = showroom();
    if (!sr?.contract_address) return;

    try {
      const publicClient = createPublicClient({
        chain: appChain,
        transport: http(chainRpc),
      });

      const result = await publicClient.readContract({
        address: sr.contract_address as `0x${string}`,
        abi: SHOWROOM_ABI,
        functionName: "listAvailable",
      }) as [string[], bigint[], string[], bigint[], bigint[], bigint[]];

      const [nftContracts, tokenIds, , , margins, basePrices] = result;
      const pMap: Record<string, { basePrice: bigint; margin: bigint }> = {};

      for (let i = 0; i < nftContracts.length; i++) {
        const key = nftKey(nftContracts[i], tokenIds[i]);
        pMap[key] = { basePrice: basePrices[i], margin: margins[i] };
      }

      setPriceMap(pMap);

      // Mark DB listings as sold if they are NOT in the on-chain active list
      const sMap: Record<string, boolean> = {};
      for (const l of sr.listings) {
        const key = nftKey(l.nft_contract, l.token_id);
        if (!pMap[key]) {
          sMap[key] = true;
        }
      }
      setSoldMap(sMap);
    } catch (e) {
      if (import.meta.env.DEV) console.error("Failed to load on-chain data:", e);
    }
  }

  createEffect(() => {
    if (showroom()) loadOnChainData();
  });

  const listings = () => {
    const sr = showroom();
    if (!sr) return [];
    return sr.listings.filter(l => !soldMap()[nftKey(l.nft_contract, l.token_id)]);
  };

  async function handlePurchase(listing: PublicShowroomListing) {
    if (purchasingKey() !== null) return;
    const sr = showroom();
    if (!sr?.contract_address) return;

    if (!window || !('ethereum' in window)) {
      setPurchaseError("No wallet detected. Install MetaMask to purchase.");
      return;
    }
    const ethereum = (window as unknown as Record<string, unknown>).ethereum as
      | { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
      | undefined;
    if (!ethereum || typeof ethereum?.request !== "function") {
      setPurchaseError("No wallet detected. Install MetaMask to purchase.");
      return;
    }

    const key = nftKey(listing.nft_contract, listing.token_id);
    setPurchasingKey(key);
    setPurchaseError(null);
    setPurchaseSuccess(null);

    try {
      const rawAccounts = await ethereum.request({ method: "eth_requestAccounts" });
      const accounts = Array.isArray(rawAccounts) ? rawAccounts as string[] : [];
      if (accounts.length === 0 || !accounts[0]) { setPurchasingKey(null); return; }
      const addr = accounts[0];
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setPurchaseError("Invalid wallet address."); setPurchasingKey(null); return; }
      const account = addr as `0x${string}`;

      // Switch chain
      try {
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
      } catch (switchErr) {
        const err = switchErr as { code?: number };
        if (err.code === 4902) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: chainIdHex, chainName, nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: [chainRpc] }],
          });
        } else throw switchErr;
      }

      // Verify chain ID after switch
      const currentChainId = await ethereum.request({ method: "eth_chainId" }) as string;
      if (currentChainId !== chainIdHex) {
        setPurchaseError("Failed to switch to the correct network. Please switch manually.");
        setPurchasingKey(null);
        return;
      }

      // Get on-chain price
      const prices = priceMap()[key];
      if (!prices) {
        setPurchaseError("This item is no longer available.");
        setPurchasingKey(null);
        return;
      }
      const totalPrice = prices.basePrice + prices.margin;

      const txPublicClient = createPublicClient({ chain: appChain, transport: http(chainRpc) });
      const walletClient = createWalletClient({ account, chain: appChain, transport: custom(ethereum) });

      const hash = await walletClient.writeContract({
        address: sr.contract_address as `0x${string}`,
        abi: SHOWROOM_ABI,
        functionName: "purchase",
        args: [listing.nft_contract as `0x${string}`, BigInt(listing.token_id)],
        value: totalPrice,
      });

      const receipt = await txPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        setPurchaseSuccess(`Purchase confirmed! TX: ${hash.slice(0, 10)}...${hash.slice(-8)}`);
        setSoldMap(prev => ({ ...prev, [key]: true }));
      } else {
        setPurchaseError("Transaction failed.");
      }
    } catch (err) {
      if (err instanceof Error) {
        const e = err as Error & { code?: number; shortMessage?: string };
        if (e.code === 4001 || e.message?.includes("rejected")) {
          setPurchaseError("Transaction cancelled.");
        } else {
          setPurchaseError(e.shortMessage || e.message || "Error during purchase.");
        }
      } else {
        setPurchaseError(String(err) || "Error during purchase.");
      }
    } finally {
      setPurchasingKey(null);
    }
  }

  function totalPrice(listing: PublicShowroomListing): string {
    const key = nftKey(listing.nft_contract, listing.token_id);
    const prices = priceMap()[key];
    if (prices) {
      return formatAvax((prices.basePrice + prices.margin).toString());
    }
    // Fallback to DB values (both stored as AVAX decimal strings like "0.2")
    try {
      const baseWei = listing.base_price.includes(".") ? parseEther(listing.base_price) : BigInt(listing.base_price);
      const marginWei = listing.margin.includes(".") ? parseEther(listing.margin) : BigInt(listing.margin || "0");
      return formatAvax((baseWei + marginWei).toString());
    } catch {
      return "?";
    }
  }

  return (
    <div class="min-h-screen gradient-bg flex flex-col">
      {/* Header */}
      <header class="sticky top-0 z-40 backdrop-blur-md" style={{ background: "rgba(8,8,12,0.85)", "border-bottom": "1px solid var(--border)" }}>
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <LogoFull />
          <Show when={showroom()}>
            <span class="font-display text-sm sm:text-base font-semibold truncate max-w-[200px] sm:max-none" style={{ color: "var(--cream-muted)" }}>
              {showroom()?.name ?? ""}
            </span>
          </Show>
        </div>
      </header>

      {/* Loading */}
      <Show when={showroom.loading}>
        <div class="flex items-center justify-center py-32">
          <div class="flex items-center gap-3">
            <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--gold)" }} />
            <span class="text-sm" style={{ color: "var(--cream-muted)" }}>Loading showroom...</span>
          </div>
        </div>
      </Show>

      {/* Error */}
      <Show when={showroom.error || (!showroom.loading && !showroom())}>
        <div class="flex flex-col items-center justify-center py-32 px-4 text-center">
          <h2 class="font-display text-2xl font-bold mb-2" style={{ color: "var(--cream)" }}>Showroom not found</h2>
          <p class="text-sm" style={{ color: "var(--text-muted)" }}>This showroom does not exist or is not yet available.</p>
        </div>
      </Show>

      {/* Main content */}
      <Show when={showroom()}>
        {(sr) => (
          <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            {/* Hero */}
            <section class="mb-12 animate-fade-in">
              <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
                <div>
                  <p class="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--gold)" }}>Showroom</p>
                  <h1 class="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-gradient">{sr().name}</h1>
                </div>
                <div class="flex items-center gap-4">
                  <div class="text-right">
                    <p class="text-2xl font-bold font-mono" style={{ color: "var(--cream)" }}>{listings().length}</p>
                    <p class="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      {listings().length === 1 ? "artwork" : "artworks"}
                    </p>
                  </div>
                </div>
              </div>
              <Show when={sr().description}>
                <p class="text-sm sm:text-base leading-relaxed max-w-3xl" style={{ color: "var(--cream-muted)" }}>{sr().description}</p>
              </Show>
              <div class="divider mt-8" />
            </section>

            {/* Status messages */}
            <Show when={purchaseError()}>
              <div class="mb-4 p-3 rounded-lg text-sm" style={{ background: "rgba(255,59,63,0.1)", color: "var(--accent)", border: "1px solid rgba(255,59,63,0.2)" }}>
                {purchaseError()}
              </div>
            </Show>
            <Show when={purchaseSuccess()}>
              <div class="mb-4 p-3 rounded-lg text-sm" style={{ background: "rgba(52,211,153,0.1)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.2)" }}>
                {purchaseSuccess()}
              </div>
            </Show>

            {/* NFT grid */}
            <section>
              <Show
                when={listings().length > 0}
                fallback={
                  <div class="card text-center py-16">
                    <p class="text-sm font-medium mb-1" style={{ color: "var(--cream)" }}>No NFTs available</p>
                    <p class="text-xs" style={{ color: "var(--text-muted)" }}>The artworks in this showroom are not yet for sale.</p>
                  </div>
                }
              >
                <div class="flex items-center justify-between mb-6">
                  <h2 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>Artworks</h2>
                  <span class="text-xs" style={{ color: "var(--emerald)" }}>{listings().length} available</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 stagger">
                  <For each={listings()}>
                    {(listing) => {
                      const key = nftKey(listing.nft_contract, listing.token_id);
                      const buying = () => purchasingKey() === key;
                      return (
                        <div
                          class="rounded-xl overflow-hidden transition-all cursor-pointer group hover:scale-[1.02]"
                          style={{ background: "var(--noir-light)", border: "1px solid var(--border)" }}
                          onClick={() => setDetailNft(listing)}
                        >
                          {/* Image */}
                          <div class="aspect-square relative overflow-hidden" style={{ background: "var(--surface-light)" }}>
                            <Show
                              when={listing.image_url}
                              fallback={
                                <div class="w-full h-full flex items-center justify-center">
                                  <span class="text-4xl font-bold font-mono" style={{ color: "var(--gold)", opacity: 0.3 }}>#{listing.token_id}</span>
                                </div>
                              }
                            >
                              <img src={sanitizeImageUrl(listing.image_url)} alt={listing.title} loading="lazy" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                            </Show>
                            <div class="absolute top-2 left-2">
                              <span class="text-[10px] px-2 py-0.5 rounded-full font-medium font-mono backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.55)", color: "var(--cream-muted)" }}>
                                #{listing.token_id}
                              </span>
                            </div>
                            <div class="absolute top-2 right-2">
                              <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold backdrop-blur-sm" style={{ background: "rgba(52,211,153,0.85)", color: "white" }}>
                                Available
                              </span>
                            </div>
                          </div>

                          {/* Info */}
                          <div class="p-4">
                            <h5 class="text-sm font-semibold truncate" style={{ color: "var(--cream)" }}>{listing.title}</h5>
                            <Show when={listing.artist_name}>
                              <p class="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>{listing.artist_name}</p>
                            </Show>
                            <Show when={listing.collection_name}>
                              <p class="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{listing.collection_name}</p>
                            </Show>

                            {/* Price + Buy */}
                            <div class="flex items-center justify-between mt-4">
                              <div>
                                <p class="text-lg font-bold font-mono" style={{ color: "var(--gold)" }}>{totalPrice(listing)} AVAX</p>
                              </div>
                              <button
                                class="px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                                style={{ background: "var(--gold)", color: "var(--noir)" }}
                                classList={{ "opacity-50": buying() }}
                                disabled={buying()}
                                onClick={(e) => { e.stopPropagation(); handlePurchase(listing); }}
                              >
                                {buying() ? "Buying..." : "Buy"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </section>
          </main>
        )}
      </Show>

      {/* Detail modal */}
      <Show when={detailNft()}>
        {(nft) => {
          const key = nftKey(nft().nft_contract, nft().token_id);
          const buying = () => purchasingKey() === key;
          return (
            <div class="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setDetailNft(null)}>
              <div class="rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" style={{ background: "var(--noir-light)", border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
                <Show when={nft().image_url}>
                  <img src={sanitizeImageUrl(nft().image_url)} alt={nft().title} class="w-full rounded-t-2xl" style={{ "max-height": "400px", "object-fit": "cover" }} />
                </Show>
                <div class="p-6">
                  <h3 class="font-display text-xl font-bold mb-1" style={{ color: "var(--cream)" }}>{nft().title}</h3>
                  <Show when={nft().artist_name}>
                    <p class="text-sm mb-1" style={{ color: "var(--text-muted)" }}>{nft().artist_name}</p>
                  </Show>
                  <Show when={nft().collection_name}>
                    <p class="text-xs mb-4" style={{ color: "var(--text-muted)" }}>Collection: {nft().collection_name}</p>
                  </Show>

                  <div class="flex items-center justify-between mt-4 pt-4" style={{ "border-top": "1px solid var(--border)" }}>
                    <div>
                      <p class="text-xs" style={{ color: "var(--text-muted)" }}>Total Price</p>
                      <p class="text-xl font-bold font-mono" style={{ color: "var(--gold)" }}>{totalPrice(nft())} AVAX</p>
                    </div>
                    <Show when={!soldMap()[key]}>
                      <button
                        class="px-6 py-3 rounded-lg font-semibold text-sm transition-all"
                        style={{ background: "var(--gold)", color: "var(--noir)" }}
                        classList={{ "opacity-50": buying() }}
                        disabled={buying()}
                        onClick={() => handlePurchase(nft())}
                      >
                        {buying() ? "Processing..." : "Buy Now"}
                      </button>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
