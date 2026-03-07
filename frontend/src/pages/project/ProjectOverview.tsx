import { Show, For, createResource, createSignal } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { useProject } from "~/lib/project-context";
import { api } from "~/lib/api-client";
import type { PublicUser, Work } from "~/lib/api-client";
import { useWebSocket } from "~/hooks/createWebSocket";
import { sanitizeImageUrl } from "~/lib/utils";

export default function ProjectOverview() {
  const params = useParams();
  const navigate = useNavigate();
  const { project, refetch, user, isCreator, isMember, works, refetchWorks } = useProject();

  const [usersMap] = createResource(async () => {
    try {
      const users = await api.listUsers();
      const map: Record<string, PublicUser> = {};
      for (const u of users) map[u.id] = u;
      return map;
    } catch { return {}; }
  });

  // Real-time updates via WebSocket
  useWebSocket((msg) => {
    if (["invitation_accepted", "invitation_received", "participant_kicked"].includes(msg.kind)) {
      refetch();
    }
  });

  const getName = (userId: string | null) => {
    const map = usersMap();
    if (map && userId && map[userId]) return map[userId].display_name;
    return "Participant";
  };

  const getAvatar = (userId: string | null) => {
    const map = usersMap();
    if (map && userId && map[userId]) return map[userId].avatar_url || "";
    return "";
  };

  async function handleAccept(participantId: string) {
    await api.acceptInvitation(participantId);
    refetch();
  }

  async function handleReject(participantId: string) {
    await api.rejectInvitation(participantId);
    refetch();
  }

  // Only show project-level participants (no allocation_id), not work-level ones
  const projectParticipants = () =>
    (project()?.participants || []).filter((p) => !p.allocation_id);

  const allParticipants = () =>
    projectParticipants().filter((p) => p.status !== "rejected" && p.status !== "kicked");

  const acceptedCount = () =>
    projectParticipants().filter((p) => p.status === "accepted").length + 1; // +1 for creator

  const pendingCount = () =>
    projectParticipants().filter((p) => p.status === "invited").length;

  const statusLabel = (status: string) => {
    switch (status) {
      case "accepted": return "Accepted";
      case "invited": return "Invited";
      case "requested": return "Requested";
      default: return status;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "accepted": return "var(--emerald)";
      case "invited": return "var(--gold)";
      case "requested": return "var(--violet)";
      default: return "var(--text-muted)";
    }
  };

  // ── Invitation (user search only) ─────────────────────────
  const [inviteQuery, setInviteQuery] = createSignal("");
  const [inviting, setInviting] = createSignal(false);
  const [inviteError, setInviteError] = createSignal("");

  const [searchResults, { mutate: setSearchResults }] = createResource(
    () => inviteQuery().length >= 2 ? inviteQuery() : null,
    async (q) => {
      if (!q) return [];
      try {
        const users = await api.searchUsers(q);
        const existingIds = new Set(
          (project()?.participants || []).map(p => p.user_id).filter(Boolean)
        );
        existingIds.add(project()?.creator_id);
        return users.filter(u => !existingIds.has(u.id));
      } catch { return []; }
    }
  );

  async function handleInviteUser(userId: string) {
    setInviting(true);
    setInviteError("");
    try {
      await api.addParticipant(project()!.id, {
        user_id: userId,
        role: "member",
        shares_bps: 0,
      });
      setInviteQuery("");
      setSearchResults([]);
      refetch();
    } catch (e) {
      setInviteError((e as Error).message);
    } finally {
      setInviting(false);
    }
  }

  return (
    <div class="space-y-8">
      {/* Pending invitation for current user */}
      <Show when={project()?.participants.some(
        (pt) => pt.wallet_address === user()?.wallet_address && pt.status === "invited"
      )}>
        <div class="card">
          <h3 class="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "var(--gold)" }}>
            Pending invitation
          </h3>
          {project()!.participants
            .filter((pt) => pt.wallet_address === user()?.wallet_address && pt.status === "invited")
            .map((pt) => (
              <div class="flex gap-3">
                <button
                  class="text-xs px-4 py-2 rounded-lg font-medium"
                  style={{ background: "rgba(52,211,153,0.12)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.3)" }}
                  onClick={() => handleAccept(pt.id)}
                >
                  Accept
                </button>
                <button class="btn-secondary text-xs py-2 px-4" onClick={() => handleReject(pt.id)}>
                  Decline
                </button>
              </div>
            ))}
        </div>
      </Show>

      {/* Participant count */}
      <div class="card text-center">
        <div class="text-2xl font-bold font-mono" style={{ color: "var(--gold)" }}>
          {acceptedCount()}
          <Show when={pendingCount() > 0}>
            <span class="text-lg" style={{ color: "var(--text-muted)" }}> (+{pendingCount()})</span>
          </Show>
        </div>
        <div class="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          Participant{acceptedCount() > 1 ? "s" : ""}
          <Show when={pendingCount() > 0}>
            {" "}— {pendingCount()} pending invitation{pendingCount() > 1 ? "s" : ""}
          </Show>
        </div>
      </div>

      {/* Invite — creator only, user search */}
      <Show when={isCreator()}>
        <div class="card">
          <h3 class="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "var(--text-muted)" }}>
            Invite a participant
          </h3>
          <input
            class="input w-full"
            placeholder="Search for a user..."
            value={inviteQuery()}
            onInput={(e) => setInviteQuery(e.currentTarget.value)}
          />
          <Show when={inviteError()}>
            <p class="text-xs mt-2" style={{ color: "var(--accent)" }}>{inviteError()}</p>
          </Show>
          {/* Search results dropdown */}
          <Show when={searchResults() && searchResults()!.length > 0}>
            <div class="mt-2 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--noir-light)" }}>
              <For each={searchResults()!}>
                {(u) => (
                  <button
                    class="w-full flex items-center gap-3 p-3 text-left transition-colors hover:opacity-80"
                    style={{ background: "transparent", border: "none", "border-bottom": "1px solid var(--border)" }}
                    onClick={() => handleInviteUser(u.id)}
                    disabled={inviting()}
                  >
                    {u.avatar_url ? (
                      <img src={sanitizeImageUrl(u.avatar_url)} alt="" class="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
                        {u.display_name[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                    <div class="flex-1 min-w-0">
                      <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>{u.display_name}</span>
                      <span class="text-xs ml-2" style={{ color: "var(--text-muted)" }}>{u.role}</span>
                    </div>
                    <span class="text-xs px-3 py-1 rounded-lg" style={{ background: "rgba(212,168,83,0.1)", color: "var(--gold)", border: "1px solid rgba(212,168,83,0.2)" }}>
                      Invite
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={inviteQuery().length >= 2 && searchResults() && searchResults()!.length === 0}>
            <p class="text-xs mt-2" style={{ color: "var(--text-muted)" }}>No users found.</p>
          </Show>
        </div>
      </Show>

      {/* Create work button — creator only */}
      <Show when={isCreator()}>
        <button
          class="w-full p-5 rounded-xl text-left transition-all hover:opacity-90"
          style={{ background: "var(--noir-light)", border: "2px solid var(--border)" }}
          onClick={() => navigate(`/projects/${params.id}/works/new?type=nft_collection`)}
        >
          <div class="flex items-center gap-3 mb-2">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(139,92,246,0.15)" }}>
              <svg class="w-4 h-4" style={{ color: "var(--violet)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
              </svg>
            </div>
            <span class="text-sm font-semibold" style={{ color: "var(--cream)" }}>
              Create an NFT collection
            </span>
          </div>
          <p class="text-xs" style={{ color: "var(--text-muted)" }}>
            Deploys your NFT collection + revenue splitter on Avalanche.
          </p>
        </button>
      </Show>

      {/* Participants list */}
      <div class="card">
        <h3 class="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "var(--text-muted)" }}>
          Project participants
        </h3>
        <Show when={allParticipants().length > 0} fallback={
          <p class="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>
            No participants yet.
          </p>
        }>
          <div class="space-y-2">
            <For each={allParticipants()}>
              {(p) => (
                <div class="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--noir-light)" }}>
                  <div class="flex items-center gap-3">
                    {getAvatar(p.user_id) ? (
                      <img src={sanitizeImageUrl(getAvatar(p.user_id))} alt="" class="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
                        {getName(p.user_id)[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                    <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>
                      {getName(p.user_id)}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{
                        color: statusColor(p.status),
                        background: `${statusColor(p.status)}15`,
                        border: `1px solid ${statusColor(p.status)}30`,
                      }}
                    >
                      {statusLabel(p.status)}
                    </span>
                    <Show when={isCreator()}>
                      <button
                        class="w-6 h-6 rounded-md flex items-center justify-center text-xs transition-colors"
                        style={{ color: "var(--accent)", background: "rgba(255,59,63,0.08)" }}
                        title={p.status === "invited" ? "Cancel invitation" : "Remove"}
                        aria-label={p.status === "invited" ? "Cancel invitation" : "Remove participant"}
                        onClick={async () => {
                          await api.kickParticipant(p.id);
                          refetch();
                        }}
                      >
                        &times;
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
