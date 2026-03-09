import { Show, createResource, createSignal, createEffect, onCleanup } from "solid-js";
import type { ParentProps } from "solid-js";
import { useParams, useLocation, A } from "@solidjs/router";
import { api } from "~/lib/api-client";
import { useAuth } from "~/hooks/createAuth";
import { useProject } from "~/lib/project-context";
import { CollectionContext } from "~/lib/collection-context";
import { useWebSocket } from "~/hooks/createWebSocket";
import { showConfirm, showAlert } from "~/lib/modal-store";

export default function CollectionLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const { project } = useProject();

  const [collection, { refetch }] = createResource(
    () => params.collectionId,
    (id) => api.getCollection(id)
  );

  const [submitting, setSubmitting] = createSignal(false);
  const [deploying, setDeploying] = createSignal(false);
  const [validating, setValidating] = createSignal(false);
  const [submittingMint, setSubmittingMint] = createSignal(false);
  const [mintingAll, setMintingAll] = createSignal(false);

  const isCreator = () => project()?.creator_id === user()?.id;
  const projectId = () => params.id || "";

  // Real-time updates via WebSocket — re-register when collectionId changes
  createEffect(() => {
    const currentCollectionId = params.collectionId; // track
    const { cleanup } = useWebSocket((msg) => {
      const collectionEvents = [
        "work_approval_requested",
        "work_participant_approved",
        "work_all_approved",
        "work_mint_approval_requested",
        "invitation_accepted",
        "participant_approved",
      ];
      if (collectionEvents.includes(msg.kind)) {
        // Refetch if the event is for this collection
        if (msg.payload?.reference_id === currentCollectionId || !msg.payload?.reference_id) {
          refetch();
        }
      }
    });
    onCleanup(cleanup);
  });

  const basePath = () => `/projects/${params.id}/collections/${params.collectionId}`;

  const allTabs = [
    { label: "Overview", path: "" },
    { label: "Shares", path: "/allocations" },
    { label: "Revenue split", path: "/repartition" },
    { label: "Simulation", path: "/simulation" },
    { label: "NFTs", path: "/nfts", nftOnly: true },
    { label: "History", path: "/history", deployed: true },
    { label: "Discussion", path: "/discussion" },
    { label: "Integration", path: "/integration", deployed: true },
  ];

  const tabs = () => allTabs.filter(t => {
    if (t.nftOnly && collection()?.collection_type !== "nft_collection") return false;
    if (t.deployed && !collection()?.contract_nft_address) return false;
    return true;
  });

  const isActive = (tabPath: string) => {
    const current = location.pathname;
    const full = basePath() + tabPath;
    if (tabPath === "") {
      return current === full || current === full + "/";
    }
    return current.startsWith(full);
  };

  function handleSubmitForApproval() {
    showConfirm({
      title: "Submit for approval",
      message: "Participants will be invited to approve the terms. Any modification to shares or NFTs will cancel approvals and revert to draft.",
      confirmLabel: "Submit",
      onConfirm: async () => {
        setSubmitting(true);
        try {
          await api.submitCollectionForApproval(collection()!.id);
          refetch();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          showAlert({ title: "Error", message: msg });
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  function handleValidateApproval() {
    showConfirm({
      title: "Final validation",
      message: "All participants have approved. Do you confirm the final approval?",
      confirmLabel: "Confirm",
      onConfirm: async () => {
        setValidating(true);
        try {
          await api.validateApproval(collection()!.id);
          refetch();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          showAlert({ title: "Error", message: msg });
        } finally {
          setValidating(false);
        }
      },
    });
  }

  function handleDeploy() {
    showConfirm({
      title: "Blockchain deployment",
      message: "Deploy this collection on the Avalanche blockchain? The server will deploy the smart contracts with your wallet as owner.",
      confirmLabel: "Deploy",
      onConfirm: async () => {
        setDeploying(true);
        try {
          await api.deployCollection(collection()!.id);
          refetch();
        } catch (e) {
          const msg = e instanceof Error
            ? (e as Error & { shortMessage?: string }).shortMessage || e.message
            : String(e) || "Deployment error";
          showAlert({ title: "Error", message: msg });
        } finally {
          setDeploying(false);
        }
      },
    });
  }

  function handleSubmitForMintApproval() {
    showConfirm({
      title: "Submit NFTs for approval",
      message: "Participants will need to approve the NFTs before minting.",
      confirmLabel: "Submit",
      onConfirm: async () => {
        setSubmittingMint(true);
        try {
          await api.submitForMintApproval(collection()!.id);
          refetch();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          showAlert({ title: "Error", message: msg });
        } finally {
          setSubmittingMint(false);
        }
      },
    });
  }

  async function handleMintAll() {
    const c = collection();
    if (!c) return;
    const drafts = c.draft_nfts || [];
    if (drafts.length === 0) return;

    showConfirm({
      title: "Mint all NFTs",
      message: `Mint ${drafts.length} NFT${drafts.length > 1 ? "s" : ""}?`,
      confirmLabel: "Mint",
      onConfirm: async () => {
        setMintingAll(true);
        const failedMints: { title: string; error: string }[] = [];
        for (const draft of drafts) {
          try {
            await api.mintCollectionNft(c.id, {
              title: draft.title,
              draft_nft_id: draft.id,
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            failedMints.push({ title: draft.title, error: errMsg });
          }
        }
        refetch();
        if (failedMints.length > 0) {
          const details = failedMints.map(f => `- ${f.title}: ${f.error}`).join("\n");
          showAlert({ title: "Some mints failed", message: `${failedMints.length} of ${drafts.length} NFTs failed to mint:\n${details}` });
        }
        setMintingAll(false);
      },
    });
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case "deployed": return "Deployed";
      case "ready_to_deploy": return "Ready to deploy";
      case "approved": return "Approved — final validation required";
      case "pending_approval": return "Pending approval";
      case "pending_mint_approval": return "Mint approval in progress";
      case "mint_ready": return "Ready to mint";
      default: return "Draft";
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "deployed": return "var(--emerald)";
      case "ready_to_deploy": return "var(--emerald)";
      case "approved": return "var(--gold)";
      case "pending_approval": return "var(--violet)";
      case "pending_mint_approval": return "var(--violet)";
      case "mint_ready": return "var(--emerald)";
      default: return "var(--gold)";
    }
  };

  const statusBg = (status: string) => {
    switch (status) {
      case "deployed": return "rgba(52,211,153,0.1)";
      case "ready_to_deploy": return "rgba(52,211,153,0.1)";
      case "approved": return "rgba(212,168,83,0.1)";
      case "pending_approval": return "rgba(139,92,246,0.1)";
      case "pending_mint_approval": return "rgba(139,92,246,0.1)";
      case "mint_ready": return "rgba(52,211,153,0.1)";
      default: return "rgba(212,168,83,0.1)";
    }
  };

  const statusBorder = (status: string) => {
    switch (status) {
      case "deployed": return "rgba(52,211,153,0.3)";
      case "ready_to_deploy": return "rgba(52,211,153,0.3)";
      case "approved": return "rgba(212,168,83,0.3)";
      case "pending_approval": return "rgba(139,92,246,0.3)";
      case "pending_mint_approval": return "rgba(139,92,246,0.3)";
      case "mint_ready": return "rgba(52,211,153,0.3)";
      default: return "rgba(212,168,83,0.3)";
    }
  };

  return (
    <Show
      when={collection()}
      fallback={
        <div class="flex items-center gap-3 py-12">
          <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
          <span class="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</span>
        </div>
      }
    >
      {(w) => (
        <div class="space-y-4">
          {/* Action buttons — right-aligned */}
          <Show when={isCreator()}>
            <div class="flex justify-end gap-2">
              <Show when={w().status === "draft"}>
                <button class="btn-gold shrink-0 whitespace-nowrap text-sm"
                  onClick={handleSubmitForApproval} disabled={submitting()}>
                  {submitting() ? "Submitting..." : "Submit for approval"}
                </button>
              </Show>
              <Show when={w().status === "approved"}>
                <button class="btn-gold shrink-0 whitespace-nowrap text-sm"
                  onClick={handleValidateApproval} disabled={validating()}>
                  {validating() ? "Validating..." : "Validate final approval"}
                </button>
              </Show>
              <Show when={w().status === "ready_to_deploy"}>
                <button class="btn-gold shrink-0 whitespace-nowrap text-sm"
                  onClick={handleDeploy} disabled={deploying()}>
                  {deploying() ? "Deploying..." : "Deploy to blockchain"}
                </button>
              </Show>
              <Show when={w().status === "deployed" && (w().draft_nfts?.length || 0) > 0}>
                <button class="btn-gold shrink-0 whitespace-nowrap text-sm"
                  onClick={handleSubmitForMintApproval} disabled={submittingMint()}>
                  {submittingMint() ? "Submitting..." : "Submit NFTs for approval"}
                </button>
              </Show>
              <Show when={w().status === "mint_ready"}>
                <button class="btn-gold shrink-0 whitespace-nowrap text-sm"
                  onClick={handleMintAll} disabled={mintingAll()}>
                  {mintingAll() ? "Minting..." : `Mint NFTs (${w().draft_nfts?.length || 0})`}
                </button>
              </Show>
            </div>
          </Show>

          {/* Status banner — prominent */}
          <div class="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{
              background: statusBg(w().status),
              border: `1px solid ${statusBorder(w().status)}`,
            }}>
            <div class="w-3 h-3 rounded-full shrink-0" style={{ background: statusColor(w().status) }} />
            <div class="flex-1">
              <span class="text-sm font-bold" style={{ color: statusColor(w().status) }}>
                {statusLabel(w().status)}
              </span>
              <Show when={w().status === "draft"}>
                <p class="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Configure shares, revenue split, and NFTs, then submit for approval.
                </p>
              </Show>
              <Show when={w().status === "pending_approval"}>
                <p class="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Waiting for your collaborators to approve.
                </p>
              </Show>
              <Show when={w().status === "approved"}>
                <p class="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Everyone approved. Validate the final approval to continue.
                </p>
              </Show>
              <Show when={w().status === "ready_to_deploy"}>
                <p class="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Approval validated. You can deploy to the blockchain.
                </p>
              </Show>
              <Show when={w().status === "deployed"}>
                <p class="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Smart contracts deployed. Add NFTs then submit for approval before minting.
                </p>
              </Show>
              <Show when={w().status === "pending_mint_approval"}>
                <p class="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Waiting for collaborators to approve the mint.
                </p>
              </Show>
              <Show when={w().status === "mint_ready"}>
                <p class="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Everyone approved. The NFTs can be minted.
                </p>
              </Show>
            </div>
          </div>

          {/* Tab navigation */}
          <nav class="flex gap-1 p-1 rounded-xl" style={{ background: "var(--surface-light)" }}>
            {tabs().map((tab) => (
              <A
                href={basePath() + tab.path}
                class="px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  color: isActive(tab.path) ? "var(--cream)" : "var(--text-muted)",
                  background: isActive(tab.path) ? "var(--noir-light)" : "transparent",
                }}
              >
                {tab.label}
              </A>
            ))}
          </nav>

          {/* Sub-page content */}
          <CollectionContext.Provider value={{ collection, refetch, user, isCreator, projectId }}>
            {props.children}
          </CollectionContext.Provider>
        </div>
      )}
    </Show>
  );
}
