import { createContext, useContext } from "solid-js";
import type { Accessor, Resource } from "solid-js";
import type { CollectionDetail, User } from "~/lib/api-client";

export interface CollectionContextValue {
  collection: Resource<CollectionDetail | undefined>;
  refetch: () => void;
  user: Accessor<User | null>;
  isCreator: Accessor<boolean>;
  projectId: Accessor<string>;
}

export const CollectionContext = createContext<CollectionContextValue>();

export function useCollection(): CollectionContextValue {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error("useCollection must be used within CollectionContext.Provider");
  return ctx;
}
