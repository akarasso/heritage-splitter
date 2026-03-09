import { Show, For, createResource, createSignal } from "solid-js";
import { useProject } from "~/lib/project-context";
import { api } from "~/lib/api-client";
import type { DocumentInfo, PublicUser } from "~/lib/api-client";
import { formatDate } from "~/lib/utils";
import { showToast } from "~/components/ui/Toast";
import { onboard } from "~/config/wallet";
import { createWalletClient, custom, type WalletClient } from "viem";
import { appChain, chainIdHex, chainRpc, chainName } from "~/config/chain";

export default function ProjectDocuments() {
  const { project, user, isCreator, isMember } = useProject();

  const [documents, { refetch }] = createResource(
    () => project()?.id,
    (id) => api.listDocuments(id)
  );

  const [uploading, setUploading] = createSignal(false);
  const [certifying, setCertifying] = createSignal<string | null>(null);
  const [shareDocId, setShareDocId] = createSignal<string | null>(null);
  const [dragOver, setDragOver] = createSignal(false);

  const [participants] = createResource(
    () => project()?.id,
    async () => {
      const p = project();
      if (!p) return [];
      return p.participants.filter((pt) => pt.status === "accepted");
    }
  );

  const [usersMap] = createResource(async () => {
    try {
      const users = await api.listUsers();
      const map: Record<string, PublicUser> = {};
      for (const u of users) map[u.id] = u;
      return map;
    } catch {
      return {};
    }
  });

  const getName = (userId: string | null) => {
    const map = usersMap();
    if (map && userId && map[userId]) return map[userId].display_name;
    return "User";
  };

  async function handleUpload(file: File) {
    const p = project();
    if (!p) return;
    if (file.size > 50 * 1024 * 1024) {
      showToast("File is too large (max 50 MB).");
      return;
    }
    setUploading(true);
    try {
      await api.uploadDocument(p.id, file);
      refetch();
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function onFileInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleUpload(file);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleUpload(file);
  }

  async function handleCertify(doc: DocumentInfo) {
    setCertifying(doc.id);
    try {
      const wallets = onboard.state.get().wallets;
      if (wallets.length === 0) {
        throw new Error("Connect your wallet to certify a document");
      }

      const wallet = wallets[0];
      const address = wallet.accounts[0].address.toLowerCase() as `0x${string}`;

      // Switch to Avalanche Fuji if needed
      const currentChainId = parseInt(wallet.chains[0]?.id, 16) || 0;
      if (currentChainId !== appChain.id) {
        try {
          await wallet.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: chainIdHex }],
          });
        } catch (switchErr) {
          const switchError = switchErr as { code?: number };
          if (switchError.code === 4902) {
            await wallet.provider.request({
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
      }

      // Fetch nonce from contract
      const { nonce } = await api.getCertifierNonce(address);

      // Deadline: 10 minutes from now
      const deadline = Math.floor(Date.now() / 1000) + 600;

      const hashHex = `0x${doc.sha256_hash}` as `0x${string}`;
      const registryAddress = (import.meta.env.VITE_DOCUMENT_REGISTRY_ADDRESS) as `0x${string}`;

      const walletClient = createWalletClient({
        account: address,
        chain: appChain,
        transport: custom(wallet.provider),
      });

      // EIP-712 typed data signature
      const signature = await walletClient.signTypedData({
        account: address,
        domain: {
          name: "DocumentRegistry",
          version: "1",
          chainId: BigInt(appChain.id),
          verifyingContract: registryAddress,
        },
        types: {
          Certify: [
            { name: "hash", type: "bytes32" },
            { name: "certifier", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Certify",
        message: {
          hash: hashHex,
          certifier: address,
          nonce: BigInt(nonce),
          deadline: BigInt(deadline),
        },
      });

      await api.certifyDocument(doc.id, { signature, deadline });
      refetch();
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setCertifying(null);
    }
  }

  async function handleDownload(doc: DocumentInfo) {
    try {
      const blob = await api.downloadDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.original_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  const [selectedUsers, setSelectedUsers] = createSignal<string[]>([]);

  async function handleShare() {
    const docId = shareDocId();
    const userIds = selectedUsers();
    if (!docId || userIds.length === 0) return;
    try {
      await api.shareDocument(docId, userIds);
      setShareDocId(null);
      setSelectedUsers([]);
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  function toggleUser(userId: string) {
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  return (
    <Show
      when={isMember()}
      fallback={
        <div class="text-center py-20">
          <h2 class="font-display text-2xl font-bold mb-2" style={{ color: "var(--cream)" }}>
            Restricted access
          </h2>
          <p class="text-sm" style={{ color: "var(--text-muted)" }}>
            Only project members can view documents.
          </p>
        </div>
      }
    >
      <div class="space-y-8 animate-fade-in-up">
        {/* Upload zone — creator only */}
        <Show when={isCreator()}>
          <div
            class="card transition-all cursor-pointer"
            style={{
              border: dragOver()
                ? "2px dashed var(--gold)"
                : "2px dashed var(--border)",
              background: dragOver() ? "rgba(212,168,83,0.05)" : undefined,
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById("doc-upload-input")?.click()}
          >
            <div class="flex flex-col items-center justify-center py-8 gap-3">
              <svg
                class="w-10 h-10"
                style={{ color: "var(--text-muted)" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
                />
              </svg>
              <p class="text-sm" style={{ color: "var(--cream-muted)" }}>
                {uploading()
                  ? "Uploading..."
                  : "Drag a file here or click to upload"}
              </p>
              <p class="text-xs" style={{ color: "var(--text-muted)" }}>
                Max 50 MB — Automatic AES-256 encryption
              </p>
            </div>
            <input
              id="doc-upload-input"
              type="file"
              class="hidden"
              onChange={onFileInput}
            />
          </div>
        </Show>

        {/* Document list */}
        <div class="card">
          <h3
            class="text-xs font-medium tracking-widest uppercase mb-4"
            style={{ color: "var(--text-muted)" }}
          >
            Documents{" "}
            {documents() ? `(${documents()!.length})` : ""}
          </h3>

          <Show
            when={!documents.loading}
            fallback={
              <div class="flex items-center gap-3 py-6">
                <div
                  class="w-2 h-2 rounded-full animate-glow"
                  style={{ background: "var(--accent)" }}
                />
                <span class="text-sm" style={{ color: "var(--text-muted)" }}>
                  Loading...
                </span>
              </div>
            }
          >
            <Show
              when={(documents() || []).length > 0}
              fallback={
                <p class="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>
                  No documents yet.
                </p>
              }
            >
              <div class="space-y-2">
                <For each={documents()!}>
                  {(doc) => (
                    <div
                      class="p-4 rounded-lg relative"
                      style={{ background: "var(--noir-light)" }}
                    >
                      {/* Certifying overlay */}
                      <Show when={certifying() === doc.id}>
                        <div
                          class="absolute inset-0 rounded-lg flex items-center justify-center gap-3 z-10"
                          style={{ background: "rgba(18,18,20,0.85)" }}
                        >
                          <div
                            class="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                            style={{ "border-color": "var(--gold)", "border-top-color": "transparent" }}
                          />
                          <span class="text-sm font-medium" style={{ color: "var(--gold)" }}>
                            Certifying...
                          </span>
                        </div>
                      </Show>
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3 min-w-0 flex-1">
                          <div
                            class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                              background: "var(--surface-light)",
                              color: "var(--gold)",
                            }}
                          >
                            <svg
                              class="w-5 h-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              stroke-width="1.5"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                              />
                            </svg>
                          </div>
                          <div class="min-w-0">
                            <p
                              class="text-sm font-medium truncate"
                              style={{ color: "var(--cream)" }}
                            >
                              {doc.original_name}
                            </p>
                            <div class="flex items-center gap-2 mt-0.5">
                              <span class="text-xs" style={{ color: "var(--text-muted)" }}>
                                {formatSize(doc.file_size)}
                              </span>
                              <span class="text-xs" style={{ color: "var(--text-muted)" }}>
                                {formatDate(doc.created_at)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div class="flex items-center gap-2 shrink-0">
                          {/* Certification badge */}
                          <Show when={doc.certified_at}>
                            {doc.tx_hash ? (
                              <a
                                href={`https://testnet.snowtrace.io/tx/${doc.tx_hash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-[10px] px-2 py-0.5 rounded-full font-medium"
                                style={{
                                  color: "var(--emerald)",
                                  background: "rgba(52,211,153,0.1)",
                                  border: "1px solid rgba(52,211,153,0.3)",
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                Certified
                              </a>
                            ) : (
                              <span
                                class="text-[10px] px-2 py-0.5 rounded-full font-medium"
                                style={{
                                  color: "var(--emerald)",
                                  background: "rgba(52,211,153,0.1)",
                                  border: "1px solid rgba(52,211,153,0.3)",
                                }}
                              >
                                Certified
                              </span>
                            )}
                          </Show>

                          {/* Download */}
                          <button
                            class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                            style={{
                              background: "var(--surface-light)",
                              color: "var(--cream-muted)",
                            }}
                            onClick={() => handleDownload(doc)}
                          >
                            Download
                          </button>

                          {/* Certify — creator only, not yet certified */}
                          <Show when={isCreator() && !doc.certified_at}>
                            <button
                              class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                              style={{
                                background: "rgba(212,168,83,0.12)",
                                color: "var(--gold)",
                                border: "1px solid rgba(212,168,83,0.3)",
                              }}
                              onClick={() => handleCertify(doc)}
                              disabled={certifying() === doc.id}
                            >
                              {certifying() === doc.id ? "Certifying..." : "Certify"}
                            </button>
                          </Show>

                          {/* Share — creator only */}
                          <Show when={isCreator()}>
                            <button
                              class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                              style={{
                                background: "rgba(167,139,250,0.12)",
                                color: "var(--violet)",
                                border: "1px solid rgba(167,139,250,0.3)",
                              }}
                              onClick={() => {
                                setShareDocId(doc.id);
                                setSelectedUsers([]);
                              }}
                            >
                              Share
                            </button>
                          </Show>
                        </div>
                      </div>

                      {/* Already certified via another document banner */}
                      <Show when={doc.original_project_name}>
                        <div
                          class="mt-3 p-3 rounded-lg flex items-start gap-2"
                          style={{ background: "rgba(212,168,83,0.08)", border: "1px solid rgba(212,168,83,0.2)" }}
                        >
                          <svg class="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-2.06a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757" />
                          </svg>
                          <div class="text-xs leading-relaxed" style={{ color: "var(--cream-muted)" }}>
                            <span>This file was already certified on the blockchain in the project </span>
                            <a
                              href={`/projects/${doc.original_project_id}`}
                              class="font-semibold hover:underline"
                              style={{ color: "var(--gold)" }}
                            >
                              {doc.original_project_name}
                            </a>
                            <Show when={doc.original_certified_by}>
                              <span> by </span>
                              <a
                                href={`https://testnet.snowtrace.io/address/${doc.original_certified_by}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="font-mono font-medium hover:underline"
                                style={{ color: "var(--gold)" }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {doc.original_certified_by!.slice(0, 6)}...{doc.original_certified_by!.slice(-4)}
                              </a>
                            </Show>
                            <span>. The transaction below is from the original certification — the file's SHA-256 hash is identical.</span>
                          </div>
                        </div>
                      </Show>

                      {/* Blockchain info — shown when certified */}
                      <Show when={doc.certified_at}>
                        <div
                          class="mt-3 pt-3 space-y-1.5"
                          style={{ "border-top": "1px solid var(--border)" }}
                        >
                          <div class="flex items-center gap-2">
                            <span class="text-[10px] uppercase tracking-wide w-20 shrink-0" style={{ color: "var(--text-muted)" }}>SHA-256</span>
                            <code
                              class="text-[11px] font-mono cursor-pointer hover:opacity-80 transition-opacity"
                              style={{ color: "var(--emerald)" }}
                              title={doc.sha256_hash}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(doc.sha256_hash);
                              }}
                            >
                              {doc.sha256_hash.slice(0, 16)}...{doc.sha256_hash.slice(-8)}
                            </code>
                          </div>
                          <Show when={doc.tx_hash}>
                            <div class="flex items-center gap-2">
                              <span class="text-[10px] uppercase tracking-wide w-20 shrink-0" style={{ color: "var(--text-muted)" }}>Transaction</span>
                              <a
                                href={`https://testnet.snowtrace.io/tx/${doc.tx_hash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-[11px] font-mono hover:opacity-80 transition-opacity"
                                style={{ color: "var(--emerald)" }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {doc.tx_hash!.slice(0, 10)}...{doc.tx_hash!.slice(-6)}
                              </a>
                            </div>
                          </Show>
                          <Show when={doc.certified_at}>
                            <div class="flex items-center gap-2">
                              <span class="text-[10px] uppercase tracking-wide w-20 shrink-0" style={{ color: "var(--text-muted)" }}>Certified on</span>
                              <span class="text-[11px]" style={{ color: "var(--cream-muted)" }}>
                                {formatDate(doc.certified_at!)}
                              </span>
                            </div>
                          </Show>
                          <Show when={doc.certified_by}>
                            <div class="flex items-center gap-2">
                              <span class="text-[10px] uppercase tracking-wide w-20 shrink-0" style={{ color: "var(--text-muted)" }}>Certifier</span>
                              <a
                                href={`https://testnet.snowtrace.io/address/${doc.certified_by}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-[11px] font-mono hover:opacity-80 transition-opacity"
                                style={{ color: "var(--gold)" }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {doc.certified_by!.slice(0, 6)}...{doc.certified_by!.slice(-4)}
                              </a>
                            </div>
                          </Show>
                          <div class="flex items-center gap-2">
                            <span class="text-[10px] uppercase tracking-wide w-20 shrink-0" style={{ color: "var(--text-muted)" }}>Registry</span>
                            {(() => {
                              const addr = import.meta.env.VITE_DOCUMENT_REGISTRY_ADDRESS;
                              return (
                                <a
                                  href={`https://testnet.snowtrace.io/address/${addr}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="text-[11px] font-mono hover:opacity-80 transition-opacity"
                                  style={{ color: "var(--cream-muted)" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {addr.slice(0, 6)}...{addr.slice(-4)}
                                </a>
                              );
                            })()}
                          </div>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        {/* Share modal */}
        <Show when={shareDocId()}>
          <div
            class="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={() => setShareDocId(null)}
          >
            <div
              class="card w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                class="text-xs font-medium tracking-widest uppercase mb-4"
                style={{ color: "var(--gold)" }}
              >
                Share document
              </h3>
              <div class="space-y-2 mb-4 max-h-60 overflow-y-auto">
                <For each={participants() || []}>
                  {(pt) => (
                    <Show when={pt.user_id && pt.user_id !== user()?.id}>
                      <label
                        class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
                        style={{
                          background: selectedUsers().includes(pt.user_id!)
                            ? "rgba(167,139,250,0.08)"
                            : "var(--noir-light)",
                          border: selectedUsers().includes(pt.user_id!)
                            ? "1px solid rgba(167,139,250,0.3)"
                            : "1px solid transparent",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedUsers().includes(pt.user_id!)}
                          onChange={() => toggleUser(pt.user_id!)}
                          class="accent-[var(--violet)]"
                        />
                        <span class="text-sm" style={{ color: "var(--cream)" }}>
                          {getName(pt.user_id)}
                        </span>
                        <span class="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
                          {pt.role}
                        </span>
                      </label>
                    </Show>
                  )}
                </For>
              </div>
              <div class="flex gap-3">
                <button
                  class="btn-gold text-sm flex-1"
                  disabled={selectedUsers().length === 0}
                  onClick={handleShare}
                >
                  Share ({selectedUsers().length})
                </button>
                <button
                  class="btn-secondary text-sm"
                  onClick={() => setShareDocId(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
