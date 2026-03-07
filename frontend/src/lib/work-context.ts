import { createContext, useContext } from "solid-js";
import type { Accessor, Resource } from "solid-js";
import type { WorkDetail, User } from "~/lib/api-client";

export interface WorkContextValue {
  work: Resource<WorkDetail | undefined>;
  refetch: () => void;
  user: Accessor<User | null>;
  isCreator: Accessor<boolean>;
  projectId: Accessor<string>;
}

export const WorkContext = createContext<WorkContextValue>();

export function useWork(): WorkContextValue {
  const ctx = useContext(WorkContext);
  if (!ctx) throw new Error("useWork must be used within WorkContext.Provider");
  return ctx;
}
