import { Show } from "solid-js";
import { useWork } from "~/lib/work-context";
import SplitVisualizer from "~/components/project/SplitVisualizer";

export default function WorkRepartition() {
  const { work, user } = useWork();

  return (
    <Show when={work()}>
      {(w) => (
        <div class="space-y-6">
          <p class="text-xs" style={{ color: "var(--text-muted)" }}>
            Royalty distribution ({(w().royalty_bps || 0) / 100}%) on each resale.
            Primary sales go 100% to the creator via the integrated marketplace.
          </p>
          <SplitVisualizer
            allocations={w().allocations || []}
            creatorSharesBps={w().creator_shares_bps}
            creatorName={user()?.display_name}
          />
        </div>
      )}
    </Show>
  );
}
