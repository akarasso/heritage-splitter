import { useWork } from "~/lib/work-context";
import SimulationCartoon from "~/components/project/SimulationCartoon";

export default function WorkSimulation() {
  const { work, user } = useWork();

  return (
    <SimulationCartoon
      allocations={work()?.allocations || []}
      creatorSharesBps={work()?.creator_shares_bps ?? 10000}
      royalty_bps={work()?.royalty_bps ?? 0}
      creatorName={user()?.display_name}
      salePrice={1}
      creatorRole={user()?.role}
    />
  );
}
