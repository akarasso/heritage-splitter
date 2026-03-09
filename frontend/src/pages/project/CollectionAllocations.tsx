import { Show, Match, Switch, createMemo } from "solid-js";
import { useCollection } from "~/lib/collection-context";
import { useProject } from "~/lib/project-context";
import ShareAllocator from "~/components/project/ShareAllocator";

export default function CollectionAllocations() {
  const { collection, refetch, isCreator, projectId } = useCollection();
  const { project } = useProject();

  const status = () => collection()?.status || "draft";

  return (
    <Show
      when={isCreator()}
      fallback={
        <div class="card text-center py-12">
          <p class="text-sm" style={{ color: "var(--text-muted)" }}>
            Only the creator can modify shares.
          </p>
          <p class="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            Check the Revenue split tab for details.
          </p>
        </div>
      }
    >
      <Switch>
        <Match when={status() === "draft" || status() === "pending_approval" || status() === "approved"}>
          <Show when={status() !== "draft"}>
            <div class="flex items-center gap-3 p-3 rounded-lg text-xs mb-4"
              style={{ background: "rgba(139,92,246,0.08)", color: "var(--violet)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              Any modification will cancel approvals and revert to draft.
            </div>
          </Show>
          <ShareAllocator
            projectId={projectId()}
            collectionId={collection()!.id}
            allocations={collection()!.allocations}
            creatorSharesBps={collection()!.creator_shares_bps}
            onUpdate={refetch}
            projectParticipants={project()?.participants}
          />
        </Match>
        <Match when={status() === "ready_to_deploy"}>
          <div class="card py-8">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-3 h-3 rounded-full" style={{ background: "var(--emerald)" }} />
              <h3 class="text-sm font-bold" style={{ color: "var(--emerald)" }}>
                Ready to deploy
              </h3>
            </div>
            <p class="text-sm" style={{ color: "var(--text-muted)" }}>
              Approval validated. The collection is ready to be deployed on the blockchain.
            </p>
          </div>
        </Match>
        <Match when={status() === "deployed"}>
          <div class="card py-8">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-3 h-3 rounded-full" style={{ background: "var(--emerald)" }} />
              <h3 class="text-sm font-bold" style={{ color: "var(--emerald)" }}>
                Deployed
              </h3>
            </div>
            <p class="text-sm" style={{ color: "var(--text-muted)" }}>
              Deployed on-chain. Shares are now immutable.
            </p>
          </div>
        </Match>
        <Match when={status() === "pending_mint_approval"}>
          <div class="card py-8">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-3 h-3 rounded-full" style={{ background: "var(--violet)" }} />
              <h3 class="text-sm font-bold" style={{ color: "var(--violet)" }}>
                Mint approval in progress
              </h3>
            </div>
            <p class="text-sm" style={{ color: "var(--text-muted)" }}>
              Shares are locked. Waiting for approval to mint the NFTs.
            </p>
          </div>
        </Match>
        <Match when={status() === "mint_ready"}>
          <div class="card py-8">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-3 h-3 rounded-full" style={{ background: "var(--emerald)" }} />
              <h3 class="text-sm font-bold" style={{ color: "var(--emerald)" }}>
                Ready to mint
              </h3>
            </div>
            <p class="text-sm" style={{ color: "var(--text-muted)" }}>
              All participants have approved. The NFTs can be minted.
            </p>
          </div>
        </Match>
      </Switch>
    </Show>
  );
}
