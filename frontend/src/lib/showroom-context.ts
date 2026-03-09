import { createContext, useContext } from "solid-js";
import type { Accessor, Resource } from "solid-js";
import type { ShowroomDetail, User } from "~/lib/api-client";

export interface ShowroomContextValue {
  showroom: Resource<ShowroomDetail | undefined>;
  refetch: () => void;
  user: Accessor<User | null>;
  isOwner: Accessor<boolean>;
  isMember: Accessor<boolean>;
}

export const ShowroomContext = createContext<ShowroomContextValue>();

export function useShowroom(): ShowroomContextValue {
  const ctx = useContext(ShowroomContext);
  if (!ctx) throw new Error("useShowroom must be used within ShowroomContext.Provider");
  return ctx;
}
