import { createContext, useContext } from "solid-js";
import type { Accessor, Resource } from "solid-js";
import type { ProjectDetail, User, Collection } from "~/lib/api-client";

export interface ProjectContextValue {
  project: Resource<ProjectDetail | undefined>;
  refetch: () => void;
  user: Accessor<User | null>;
  isCreator: Accessor<boolean>;
  isMember: Accessor<boolean>;
  collections: Resource<Collection[] | undefined>;
  refetchCollections: () => void;
}

export const ProjectContext = createContext<ProjectContextValue>();

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectContext.Provider");
  return ctx;
}
