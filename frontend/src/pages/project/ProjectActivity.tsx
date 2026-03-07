import { For, Show, createResource } from "solid-js";
import { api } from "~/lib/api-client";
import type { ActivityItem } from "~/lib/api-client";
import { useProject } from "~/lib/project-context";
import { useWebSocket } from "~/hooks/createWebSocket";
import { formatDate } from "~/lib/utils";

const KIND_LABELS: Record<string, string> = {
  join_request: "Join request",
  join_accepted: "Request accepted",
  join_rejected: "Request rejected",
  thread_created: "Discussion created",
  message_posted: "Message posted",
  thread_resolved: "Discussion resolved",
  invitation_received: "Invitation received",
  invitation_sent: "Invitation sent",
  participant_kicked: "Participant removed",
  dm_received: "Direct message",
  approval_requested: "Approval requested",
  participant_approved: "Approved",
  all_approved: "All approved",
};

const KIND_COLORS: Record<string, string> = {
  join_request: "var(--gold)",
  join_accepted: "var(--emerald)",
  join_rejected: "var(--accent)",
  invitation_received: "var(--gold)",
  invitation_sent: "var(--gold)",
  thread_created: "var(--violet)",
  message_posted: "var(--cream-muted)",
  thread_resolved: "var(--emerald)",
  participant_kicked: "var(--accent)",
  approval_requested: "var(--gold)",
  participant_approved: "var(--emerald)",
  all_approved: "var(--emerald)",
};

export default function ProjectActivity() {
  const { project, isMember } = useProject();
  const [activity, { refetch: refetchActivity }] = createResource(
    () => project()?.id,
    (id) => api.getProjectActivity(id)
  );

  // WebSocket refresh
  useWebSocket((msg) => {
    if (["join_request", "thread_created", "message_posted", "thread_resolved", "invitation_sent", "invitation_received"].includes(msg.kind)) {
      refetchActivity();
    }
  });

  return (
    <Show when={isMember()} fallback={
      <div class="text-center py-20">
        <h2 class="font-display text-2xl font-bold mb-2" style={{ color: "var(--cream)" }}>Restricted access</h2>
        <p class="text-sm" style={{ color: "var(--text-muted)" }}>Only project members can view this page.</p>
      </div>
    }>
      <div class="space-y-8 animate-fade-in-up">
        {/* Activity feed */}
        <div class="card">
          <div class="flex items-center gap-2 mb-4">
            <h3 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--cream-muted)" }}>
              Activity feed
            </h3>
          </div>
          <Show when={!activity.loading} fallback={
            <div class="flex items-center gap-3 py-6">
              <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
              <span class="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</span>
            </div>
          }>
            <Show when={(activity() || []).length > 0} fallback={
              <p class="text-sm py-4" style={{ color: "var(--text-muted)" }}>No activity yet.</p>
            }>
              <div class="space-y-3">
                <For each={activity()!}>
                  {(item) => (
                    <div class="flex items-start gap-3 p-3 rounded-lg" style={{ background: "var(--noir-light)" }}>
                      <div class="w-2 h-2 rounded-full mt-1.5 shrink-0"
                        style={{ background: KIND_COLORS[item.kind] || "var(--text-muted)" }} />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="text-xs font-medium px-2 py-0.5 rounded"
                            style={{ background: "var(--surface-light)", color: KIND_COLORS[item.kind] || "var(--cream-muted)" }}>
                            {KIND_LABELS[item.kind] || item.kind}
                          </span>
                          <span class="text-xs" style={{ color: "var(--text-muted)" }}>
                            {formatDate(item.created_at)}
                          </span>
                        </div>
                        <p class="text-sm" style={{ color: "var(--cream)" }}>{item.title}</p>
                        <Show when={item.body}>
                          <p class="text-xs mt-1 truncate" style={{ color: "var(--cream-muted)" }}>{item.body}</p>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  );
}
