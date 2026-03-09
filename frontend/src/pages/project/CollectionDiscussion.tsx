import { useParams } from "@solidjs/router";
import ProjectDiscussion from "./ProjectDiscussion";

export default function CollectionDiscussion() {
  const params = useParams();
  return <ProjectDiscussion collectionId={params.collectionId} />;
}
