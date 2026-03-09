import { useCollection } from "~/lib/collection-context";
import SimulationCartoon from "~/components/project/SimulationCartoon";

export default function CollectionSimulation() {
  const { collection, user } = useCollection();

  return (
    <SimulationCartoon
      allocations={collection()?.allocations || []}
      creatorSharesBps={collection()?.creator_shares_bps ?? 10000}
      royalty_bps={collection()?.royalty_bps ?? 0}
      creatorName={user()?.display_name}
      salePrice={1}
      creatorRole={user()?.role}
    />
  );
}
