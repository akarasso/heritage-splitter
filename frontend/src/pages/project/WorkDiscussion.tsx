import { useParams } from "@solidjs/router";
import ProjectDiscussion from "./ProjectDiscussion";

export default function WorkDiscussion() {
  const params = useParams();
  return <ProjectDiscussion workId={params.workId} />;
}
