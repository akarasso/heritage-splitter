import { createResource, Show, For, createSignal, createEffect } from "solid-js";
import { useParams } from "@solidjs/router";
import type { RouteSectionProps } from "@solidjs/router";
import { createWalletClient, createPublicClient, custom, http } from "viem";
import { appChain, chainIdHex, chainRpc, chainName } from "~/config/chain";
import { api } from "~/lib/api-client";
import type { PublicNft, PublicCollection } from "~/lib/api-client";
import { LogoFull } from "~/components/ui/Logo";
import { sanitizeImageUrl } from "~/lib/utils";

const MARKET_ABI = [
  {
    name: "purchase",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "listings",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "nftContract", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "seller", type: "address" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "listAvailable",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      {
        name: "result",
        type: "tuple[]",
        components: [
          { name: "nftContract", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "price", type: "uint256" },
          { name: "seller", type: "address" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "listingCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const NFT_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export default function PublicSale(props: RouteSectionProps) {
  const params = useParams<{ slug: string }>();
  const [collection] = createResource(() => params.slug, async (slug) => {
    try {
      return await api.getPublicCollection(slug);
    } catch (e) {
      return null;
    }
  });
  const [detailNft, setDetailNft] = createSignal<PublicNft | null>(null);
  const [purchasingTokenId, setPurchasingTokenId] = createSignal<number | null>(null);
  const [purchaseError, setPurchaseError] = createSignal<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = createSignal<string | null>(null);
  // Track sold status per token: tokenId → owner address (null = market = available)
  const [soldMap, setSoldMap] = createSignal<Record<number, string>>({});
  // Market listings: tokenId → { listingId, price }
  const [listingMap, setListingMap] = createSignal<Record<number, { listingId: bigint; price: bigint }>>({});

  // Load market listings and check on-chain ownership
  async function loadMarketData() {
    const col = collection();
    if (!col?.contract_nft_address || !col?.contract_market_address || !col?.nfts?.length) return;

    try {
      const publicClient = createPublicClient({
        chain: appChain,
        transport: http(chainRpc),
      });

      const nftAddress = col.contract_nft_address as `0x${string}`;
      const marketAddress = col.contract_market_address as `0x${string}`;
      const marketAddr = col.contract_market_address.toLowerCase();

      // Fetch active listings from market
      const lMap: Record<number, { listingId: bigint; price: bigint }> = {};
      try {
        const count = await publicClient.readContract({
          address: marketAddress,
          abi: MARKET_ABI,
          functionName: "listingCount",
        }) as bigint;
        // Read each listing by index
        const reads = [];
        for (let i = 0n; i < count; i++) {
          reads.push(
            publicClient.readContract({
              address: marketAddress,
              abi: MARKET_ABI,
              functionName: "listings",
              args: [i],
            }).then((r: any) => ({ listingId: i, nftContract: r[0], tokenId: r[1], price: r[2], seller: r[3], active: r[4] }))
          );
        }
        const results = await Promise.all(reads);
        const nftAddr = nftAddress.toLowerCase();
        for (const l of results) {
          if (l.active && l.nftContract.toLowerCase() === nftAddr) {
            lMap[Number(l.tokenId)] = { listingId: l.listingId, price: l.price };
          }
        }
      } catch (e) {
        if (import.meta.env.DEV) console.error("Failed to load market listings:", e instanceof Error ? e.message : "Unknown error");
      }
      setListingMap(lMap);

      // Check ownership for all NFTs
      const sMap: Record<number, string> = {};
      const results = await Promise.allSettled(
        col.nfts.map(async (nft) => {
          const owner = await publicClient.readContract({
            address: nftAddress,
            abi: NFT_ABI,
            functionName: "ownerOf",
            args: [BigInt(nft.token_id)],
          });
          return { tokenId: nft.token_id, owner: owner as string };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.owner.toLowerCase() !== marketAddr) {
          sMap[r.value.tokenId] = r.value.owner;
        }
      }
      setSoldMap(sMap);
    } catch (e) {
      if (import.meta.env.DEV) console.error("Market data load failed:", e instanceof Error ? e.message : "Unknown error");
    }
  }

  // Trigger data load when collection loads
  createEffect(() => {
    if (collection()) loadMarketData();
  });

  const isSold = (tokenId: number) => tokenId in soldMap();

  async function handlePurchase(tokenId: number) {
    if (purchasingTokenId() !== null) return;
    const col = collection();
    if (!col?.contract_market_address) {
      setPurchaseError("This collection does not have a deployed market yet.");
      return;
    }

    if (!window || !('ethereum' in window)) {
      setPurchaseError("No wallet detected. Install MetaMask to purchase.");
      return;
    }
    // F4-1: The cast below is followed by a runtime type check (typeof request === 'function'),
    // so even if window.ethereum is malformed, we safely bail before using it.
    const ethereum = (window as unknown as Record<string, unknown>).ethereum as
      | { request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; isMetaMask?: boolean }
      | undefined;
    if (!ethereum || typeof ethereum?.request !== "function") {
      setPurchaseError("No wallet detected. Install MetaMask to purchase.");
      return;
    }

    setPurchasingTokenId(tokenId);
    setPurchaseError(null);
    setPurchaseSuccess(null);

    try {
      const rawAccounts = await ethereum.request({ method: "eth_requestAccounts" });
      const accounts = Array.isArray(rawAccounts) ? rawAccounts as string[] : [];
      if (accounts.length === 0 || !accounts[0]) {
        setPurchasingTokenId(null);
        return;
      }

      const addr = accounts[0];
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        setPurchaseError("Invalid wallet address format.");
        setPurchasingTokenId(null);
        return;
      }
      const account = addr as `0x${string}`;
      const marketAddress = col.contract_market_address as `0x${string}`;

      // Ensure correct chain
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchErr) {
        const err = switchErr as { code?: number };
        if (err.code === 4902) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: chainIdHex,
              chainName: chainName,
              nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
              rpcUrls: [chainRpc],
            }],
          });
        } else {
          throw switchErr;
        }
      }

      // Verify chain ID after switch
      const currentChainId = await ethereum.request({ method: "eth_chainId" }) as string;
      if (currentChainId !== chainIdHex) {
        setPurchaseError("Failed to switch to the correct network. Please switch manually.");
        setPurchasingTokenId(null);
        return;
      }

      // Look up listing for this tokenId
      const listing = listingMap()[tokenId];
      if (!listing) {
        setPurchaseError("This NFT is not currently listed for sale.");
        setPurchasingTokenId(null);
        return;
      }

      const txPublicClient = createPublicClient({
        chain: appChain,
        transport: http(chainRpc),
      });

      const walletClient = createWalletClient({
        account,
        chain: appChain,
        transport: custom(ethereum),
      });

      const hash = await walletClient.writeContract({
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "purchase",
        args: [listing.listingId],
        value: listing.price,
      });

      const receipt = await txPublicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        setPurchaseSuccess(`Purchase confirmed! TX: ${hash.slice(0, 10)}...${hash.slice(-8)}`);
        setSoldMap(prev => ({ ...prev, [tokenId]: account }));
      } else {
        setPurchaseError("The transaction failed.");
      }
    } catch (err) {
      if (err instanceof Error) {
        const e = err as Error & { code?: number; shortMessage?: string };
        if (import.meta.env.DEV) console.error("Purchase failed:", e.message);
        if (e.code === 4001 || e.message?.includes("rejected")) {
          setPurchaseError("Transaction cancelled.");
        } else {
          setPurchaseError(e.shortMessage || e.message || "Error during purchase.");
        }
      } else {
        if (import.meta.env.DEV) console.error("Purchase failed");
        setPurchaseError(String(err) || "Error during purchase.");
      }
    } finally {
      setPurchasingTokenId(null);
    }
  }

  function parseAttrs(raw: string): { key: string; value: string }[] {
    try {
      const parsed = JSON.parse(raw || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map((a: any) => ({
        key: a.key || a.trait_type || "",
        value: String(a.value ?? ""),
      }));
    } catch {
      return [];
    }
  }

  function getArtistName(nft: PublicNft): string {
    const attrs = parseAttrs(nft.attributes);
    const artistAttr = attrs.find(
      (a) => a.key.toLowerCase() === "artist" || a.key.toLowerCase() === "artist_name"
    );
    return artistAttr?.value || "";
  }

  return (
    <div class="min-h-screen gradient-bg flex flex-col">
      {/* Header */}
      <header
        class="sticky top-0 z-40 backdrop-blur-md"
        style={{
          background: "rgba(8,8,12,0.85)",
          "border-bottom": "1px solid var(--border)",
        }}
      >
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <LogoFull />
          <Show when={collection()}>
            <span
              class="font-display text-sm sm:text-base font-semibold truncate max-w-[200px] sm:max-none"
              style={{ color: "var(--cream-muted)" }}
            >
              {collection()?.name ?? ""}
            </span>
          </Show>
        </div>
      </header>

      {/* Loading */}
      <Show when={collection.loading}>
        <div class="flex items-center justify-center py-32">
          <div class="flex items-center gap-3">
            <div
              class="w-2 h-2 rounded-full animate-glow"
              style={{ background: "var(--gold)" }}
            />
            <span class="text-sm" style={{ color: "var(--cream-muted)" }}>
              Loading collection...
            </span>
          </div>
        </div>
      </Show>

      {/* Error — explicit error OR loaded with no data */}
      <Show when={collection.error || (!collection.loading && !collection())}>
        <div class="flex flex-col items-center justify-center py-32 px-4 text-center">
          <div
            class="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
            style={{
              background: "rgba(255,59,63,0.1)",
              border: "1px solid rgba(255,59,63,0.2)",
            }}
          >
            <svg
              class="w-10 h-10"
              style={{ color: "var(--accent)" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h2
            class="font-display text-2xl font-bold mb-2"
            style={{ color: "var(--cream)" }}
          >
            Collection not found
          </h2>
          <p class="text-sm" style={{ color: "var(--text-muted)" }}>
            This collection does not exist or is not yet available.
          </p>
        </div>
      </Show>

      {/* Main content */}
      <Show when={collection()}>
        {(col) => {
          const allNfts = () => col().nfts || [];
          const nfts = () => allNfts().filter(n => {
            const inListing = n.token_id in (listingMap() || {});
            const isSold = n.token_id in (soldMap() || {});
            return inListing && !isSold;
          });
          return (
            <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
              {/* Collection hero */}
              <section class="mb-12 animate-fade-in">
                <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
                  <div>
                    <p
                      class="text-xs font-medium tracking-widest uppercase mb-2"
                      style={{ color: "var(--gold)" }}
                    >
                      Collection
                    </p>
                    <h1
                      class="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-gradient"
                    >
                      {col().name}
                    </h1>
                    <Show when={col().work_type}>
                      <span
                        class="inline-block mt-2 text-xs px-3 py-1 rounded-full"
                        style={{
                          background: "rgba(212,168,83,0.1)",
                          color: "var(--gold)",
                          border: "1px solid rgba(212,168,83,0.2)",
                        }}
                      >
                        {col().work_type}
                      </span>
                    </Show>
                  </div>
                  <div class="flex items-center gap-4">
                    <div class="text-right">
                      <p
                        class="text-2xl font-bold font-mono"
                        style={{ color: "var(--cream)" }}
                      >
                        {col().total_nft_count}
                      </p>
                      <p
                        class="text-xs uppercase tracking-wider"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {col().total_nft_count === 1 ? "artwork" : "artworks"}
                      </p>
                    </div>
                  </div>
                </div>

                <Show when={col().description}>
                  <p
                    class="text-sm sm:text-base leading-relaxed max-w-3xl"
                    style={{ color: "var(--cream-muted)" }}
                  >
                    {col().description}
                  </p>
                </Show>

                <div class="divider mt-8" />
              </section>

              {/* NFT grid */}
              <section>
                <Show
                  when={nfts().length > 0}
                  fallback={
                    <div class="card text-center py-16">
                      <div
                        class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                        style={{
                          background: "rgba(212,168,83,0.1)",
                          border: "1px solid rgba(212,168,83,0.2)",
                        }}
                      >
                        <svg
                          class="w-8 h-8"
                          style={{ color: "var(--gold)" }}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="1.5"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                          />
                        </svg>
                      </div>
                      <p
                        class="text-sm font-medium mb-1"
                        style={{ color: "var(--cream)" }}
                      >
                        No NFTs available
                      </p>
                      <p class="text-xs" style={{ color: "var(--text-muted)" }}>
                        The artworks in this collection are not yet for sale.
                      </p>
                    </div>
                  }
                >
                  <div class="flex items-center justify-between mb-6">
                    <h2
                      class="text-xs font-medium tracking-widest uppercase"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Artworks
                    </h2>
                    <div class="flex items-center gap-3">
                      <span class="text-xs" style={{ color: "var(--emerald)" }}>
                        {nfts().filter(n => !isSold(n.token_id)).length} available
                      </span>
                      <Show when={nfts().some(n => isSold(n.token_id))}>
                        <span class="text-xs" style={{ color: "var(--text-muted)" }}>
                          {nfts().filter(n => isSold(n.token_id)).length} sold
                        </span>
                      </Show>
                    </div>
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 stagger">
                    <For each={nfts()}>
                      {(nft) => {
                        const attrs = parseAttrs(nft.attributes);
                        const artist = getArtistName(nft);
                        const sold = () => isSold(nft.token_id);
                        const buying = () => purchasingTokenId() === nft.token_id;
                        return (
                          <div
                            class="rounded-xl overflow-hidden transition-all cursor-pointer group"
                            classList={{ "hover:scale-[1.02]": !sold(), "opacity-75": sold() }}
                            style={{
                              background: "var(--noir-light)",
                              border: sold() ? "1px solid var(--border)" : "1px solid var(--border)",
                            }}
                            onClick={() => setDetailNft(nft)}
                          >
                            {/* Image */}
                            <div
                              class="aspect-square relative overflow-hidden"
                              style={{ background: "var(--surface-light)" }}
                            >
                              <Show
                                when={nft.image_url}
                                fallback={
                                  <div class="w-full h-full flex items-center justify-center">
                                    <span
                                      class="text-4xl font-bold font-mono"
                                      style={{
                                        color: "var(--gold)",
                                        opacity: 0.3,
                                      }}
                                    >
                                      #{nft.token_id}
                                    </span>
                                  </div>
                                }
                              >
                                <img
                                  src={sanitizeImageUrl(nft.image_url)}
                                  alt={nft.title}
                                  loading="lazy"
                                  class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                  classList={{ "grayscale-[30%]": sold() }}
                                />
                              </Show>
                              {/* Badges */}
                              <div class="absolute top-2 left-2 flex items-center gap-1.5">
                                <span
                                  class="text-[10px] px-2 py-0.5 rounded-full font-medium font-mono backdrop-blur-sm"
                                  style={{
                                    background: "rgba(0,0,0,0.55)",
                                    color: "var(--cream-muted)",
                                  }}
                                >
                                  #{nft.token_id}
                                </span>
                              </div>
                              <Show when={sold()}>
                                <div class="absolute top-2 right-2">
                                  <span
                                    class="text-[10px] px-2 py-0.5 rounded-full font-semibold backdrop-blur-sm"
                                    style={{
                                      background: "rgba(255,59,63,0.85)",
                                      color: "white",
                                    }}
                                  >
                                    Sold
                                  </span>
                                </div>
                              </Show>
                              <Show when={!sold() && nft.price}>
                                <div class="absolute top-2 right-2">
                                  <span
                                    class="text-[10px] px-2 py-0.5 rounded-full font-semibold backdrop-blur-sm"
                                    style={{
                                      background: "rgba(52,211,153,0.85)",
                                      color: "white",
                                    }}
                                  >
                                    Available
                                  </span>
                                </div>
                              </Show>
                            </div>

                            {/* Info */}
                            <div class="p-4">
                              <h5
                                class="text-sm font-semibold truncate"
                                style={{ color: "var(--cream)" }}
                              >
                                {nft.title}
                              </h5>
                              <Show when={artist}>
                                <p
                                  class="text-xs truncate mt-0.5"
                                  style={{ color: "var(--text-muted)" }}
                                >
                                  {artist}
                                </p>
                              </Show>

                              {/* Attributes */}
                              <Show when={attrs.length > 0}>
                                <div class="flex flex-wrap gap-1 mt-2">
                                  <For each={attrs.slice(0, 3)}>
                                    {(attr) => (
                                      <span
                                        class="text-[10px] px-1.5 py-0.5 rounded break-all max-w-full"
                                        style={{
                                          background: "var(--surface-light)",
                                          color: "var(--text-muted)",
                                        }}
                                      >
                                        {attr.key}: {attr.value}
                                      </span>
                                    )}
                                  </For>
                                  <Show when={attrs.length > 3}>
                                    <span
                                      class="text-[10px] px-1.5 py-0.5 rounded"
                                      style={{
                                        background: "var(--surface-light)",
                                        color: "var(--text-muted)",
                                      }}
                                    >
                                      +{attrs.length - 3}
                                    </span>
                                  </Show>
                                </div>
                              </Show>

                              {/* Price + Buy / Sold */}
                              <div class="flex items-center justify-between mt-4">
                                <Show
                                  when={nft.price}
                                  fallback={
                                    <span
                                      class="text-xs"
                                      style={{ color: "var(--text-muted)" }}
                                    >
                                      Price not set
                                    </span>
                                  }
                                >
                                  <div class="flex items-baseline gap-1">
                                    <span
                                      class="text-lg font-bold font-mono"
                                      style={{ color: sold() ? "var(--text-muted)" : "var(--gold)" }}
                                      classList={{ "line-through": sold() }}
                                    >
                                      {nft.price}
                                    </span>
                                    <span
                                      class="text-xs"
                                      style={{ color: "var(--text-muted)" }}
                                    >
                                      AVAX
                                    </span>
                                  </div>
                                </Show>
                                <Show when={!sold()} fallback={
                                  <span
                                    class="text-xs font-medium px-3 py-2 rounded-lg"
                                    style={{ color: "var(--text-muted)", background: "var(--surface-light)" }}
                                  >
                                    Sold
                                  </span>
                                }>
                                  <button
                                    class="btn-gold text-xs !py-2 !px-4"
                                    disabled={purchasingTokenId() !== null}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePurchase(nft.token_id);
                                    }}
                                  >
                                    {buying() ? "Buying..." : "Buy"}
                                  </button>
                                </Show>
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
          );
        }}
      </Show>

      {/* Detail modal */}
      <Show when={detailNft()}>
        {(nft) => {
          const attrs = () => parseAttrs(nft().attributes);
          const artist = () => getArtistName(nft());
          return (
            <div
              class="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.75)" }}
              onClick={(e) => {
                if (e.target === e.currentTarget) setDetailNft(null);
              }}
              onKeyDown={(e) => { if (e.key === "Escape") setDetailNft(null); }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={nft().title}
                class="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl animate-modal-card"
                style={{
                  background: "var(--noir-light)",
                  border: "1px solid var(--border)",
                  "max-height": "90vh",
                  "overflow-y": "auto",
                }}
              >
                {/* Image */}
                <Show when={nft().image_url}>
                  <div
                    class="w-full aspect-square relative"
                    style={{ background: "var(--surface-light)" }}
                  >
                    <img
                      src={sanitizeImageUrl(nft().image_url)}
                      alt={nft().title}
                      class="w-full h-full object-cover"
                    />
                  </div>
                </Show>
                <Show when={!nft().image_url}>
                  <div
                    class="w-full aspect-video flex items-center justify-center"
                    style={{ background: "var(--surface-light)" }}
                  >
                    <span
                      class="text-5xl font-bold font-mono"
                      style={{ color: "var(--gold)", opacity: 0.3 }}
                    >
                      #{nft().token_id}
                    </span>
                  </div>
                </Show>

                {/* Content */}
                <div class="p-6 space-y-4">
                  <div class="flex items-start justify-between">
                    <div>
                      <h3
                        class="text-lg font-bold"
                        style={{ color: "var(--cream)" }}
                      >
                        {nft().title}
                      </h3>
                      <Show when={artist()}>
                        <p
                          class="text-sm mt-0.5"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {artist()}
                        </p>
                      </Show>
                    </div>
                    <button
                      class="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{
                        color: "var(--text-muted)",
                        background: "var(--surface-light)",
                      }}
                      onClick={() => setDetailNft(null)}
                      aria-label="Close"
                    >
                      &times;
                    </button>
                  </div>

                  <div class="flex items-center gap-2">
                    <span
                      class="text-xs px-2 py-0.5 rounded-full font-medium font-mono"
                      style={{
                        background: "rgba(52,211,153,0.15)",
                        color: "var(--emerald)",
                        border: "1px solid rgba(52,211,153,0.3)",
                      }}
                    >
                      Token #{nft().token_id}
                    </span>
                    <Show when={isSold(nft().token_id)}>
                      <span
                        class="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: "rgba(255,59,63,0.15)",
                          color: "var(--accent)",
                          border: "1px solid rgba(255,59,63,0.3)",
                        }}
                      >
                        Sold
                      </span>
                    </Show>
                    <Show when={!isSold(nft().token_id) && nft().price}>
                      <span
                        class="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: "rgba(52,211,153,0.15)",
                          color: "var(--emerald)",
                          border: "1px solid rgba(52,211,153,0.3)",
                        }}
                      >
                        Available
                      </span>
                    </Show>
                  </div>

                  <Show when={nft().description}>
                    <div>
                      <label
                        class="text-xs font-medium tracking-widest uppercase"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Description
                      </label>
                      <p
                        class="text-sm mt-1 leading-relaxed"
                        style={{ color: "var(--cream)" }}
                      >
                        {nft().description}
                      </p>
                    </div>
                  </Show>

                  <Show when={nft().price}>
                    <div>
                      <label
                        class="text-xs font-medium tracking-widest uppercase"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Price
                      </label>
                      <p
                        class="text-2xl font-bold font-mono mt-1"
                        style={{ color: "var(--gold)" }}
                      >
                        {nft().price} AVAX
                      </p>
                    </div>
                  </Show>

                  <Show when={attrs().length > 0}>
                    <div>
                      <label
                        class="text-xs font-medium tracking-widest uppercase"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Attributes
                      </label>
                      <div class="grid grid-cols-2 gap-2 mt-2">
                        <For each={attrs()}>
                          {(attr) => (
                            <div
                              class="p-2 rounded-lg"
                              style={{ background: "var(--surface-light)" }}
                            >
                              <div
                                class="text-[10px] uppercase tracking-wider"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {attr.key}
                              </div>
                              <div
                                class="text-sm font-medium break-all"
                                style={{ color: "var(--cream)" }}
                              >
                                {attr.value}
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* Status messages */}
                  <Show when={purchaseError()}>
                    <div
                      class="p-3 rounded-lg text-sm"
                      style={{
                        background: "rgba(255,59,63,0.1)",
                        color: "var(--accent)",
                        border: "1px solid rgba(255,59,63,0.2)",
                      }}
                    >
                      {purchaseError()}
                    </div>
                  </Show>
                  <Show when={purchaseSuccess()}>
                    <div
                      class="p-3 rounded-lg text-sm"
                      style={{
                        background: "rgba(52,211,153,0.1)",
                        color: "var(--emerald)",
                        border: "1px solid rgba(52,211,153,0.2)",
                      }}
                    >
                      {purchaseSuccess()}
                    </div>
                  </Show>

                  {/* Buy button in modal */}
                  <Show when={!isSold(nft().token_id)} fallback={
                    <div
                      class="w-full mt-2 py-3 rounded-xl text-center text-sm font-medium"
                      style={{ background: "var(--surface-light)", color: "var(--text-muted)" }}
                    >
                      This artwork has been sold
                    </div>
                  }>
                    <button
                      class="btn-gold w-full mt-2"
                      disabled={purchasingTokenId() !== null}
                      onClick={() => handlePurchase(nft().token_id)}
                    >
                      {purchasingTokenId() === nft().token_id ? "Transaction in progress..." : "Buy this artwork"}
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          );
        }}
      </Show>

      {/* Spacer to push footer down */}
      <div class="flex-1" />

      {/* Footer */}
      <footer
        class="py-8"
        style={{
          "border-top": "1px solid var(--border)",
          background: "rgba(8,8,12,0.6)",
        }}
      >
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <LogoFull />
          <p class="text-xs" style={{ color: "var(--text-muted)" }}>
            Powered by Heritage Splitter
          </p>
        </div>
      </footer>
    </div>
  );
}
