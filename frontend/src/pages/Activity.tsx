import { For, Show, createResource, createSignal, createEffect } from "solid-js";
import { A, useSearchParams } from "@solidjs/router";
import { api } from "~/lib/api-client";
import type { Notification, Conversation, DirectMessageDetail } from "~/lib/api-client";
import { useAuth } from "~/hooks/createAuth";
import { useWebSocket } from "~/hooks/createWebSocket";
import { formatDate, sanitizeImageUrl } from "~/lib/utils";

const KIND_LABELS: Record<string, string> = {
  join_request: "Join request",
  join_accepted: "Accepted",
  join_rejected: "Rejected",
  invitation_received: "Invitation",
  thread_created: "Discussion",
  message_posted: "Message",
  thread_resolved: "Resolved",
  participant_kicked: "Removed",
  dm_received: "Direct message",
  approval_requested: "Approval required",
  participant_approved: "Approved",
  all_approved: "All approved",
};

const KIND_COLORS: Record<string, string> = {
  join_request: "var(--gold)",
  join_accepted: "var(--emerald)",
  join_rejected: "var(--accent)",
  invitation_received: "var(--gold)",
  thread_created: "var(--violet)",
  message_posted: "var(--cream-muted)",
  thread_resolved: "var(--emerald)",
  participant_kicked: "var(--accent)",
  dm_received: "var(--gold)",
  approval_requested: "var(--gold)",
  participant_approved: "var(--emerald)",
  all_approved: "var(--emerald)",
};

export default function Activity() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = createSignal<"notifications" | "messages">(
    searchParams.dm ? "messages" : "notifications"
  );
  const [selectedUser, setSelectedUser] = createSignal<string | null>(
    searchParams.dm || null
  );
  const [messageInput, setMessageInput] = createSignal("");
  const [sending, setSending] = createSignal(false);

  const [notifications, { refetch: refetchNotifs }] = createResource(
    () => true,
    () => api.listNotifications()
  );
  const [conversations, { refetch: refetchConvos }] = createResource(
    () => true,
    () => api.listConversations()
  );
  const [messages, setMessages] = createSignal<DirectMessageDetail[]>([]);
  const [hasMore, setHasMore] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [initialLoading, setInitialLoading] = createSignal(false);

  async function loadMessages(before?: string) {
    if (!selectedUser()) return;
    if (loadingMore()) return;
    setLoadingMore(true);
    try {
      const res = await api.getConversation(selectedUser()!, before, 50);
      if (before) {
        setMessages(prev => [...res.messages, ...prev]);
      } else {
        setMessages(res.messages);
      }
      setHasMore(res.has_more);
    } catch (e) {
      console.error("Failed to load messages:", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingMore(false);
      setInitialLoading(false);
    }
  }

  // Load messages when selectedUser changes
  createEffect(() => {
    const uid = selectedUser();
    if (uid) {
      setMessages([]);
      setHasMore(true);
      setInitialLoading(true);
      loadMessages();
    } else {
      setMessages([]);
      setHasMore(true);
    }
  });

  // WebSocket refresh — read selectedUser() inside the callback to avoid stale closure
  useWebSocket((msg) => {
    if (msg.kind === "dm_received") {
      refetchConvos();
      // Append new messages by reloading without cursor (gets latest page)
      // Read selectedUser() reactively here, not captured from closure
      const currentUser = selectedUser();
      if (currentUser) {
        loadMessages();
      }
    } else {
      refetchNotifs();
    }
  });

  function handleScroll(e: Event) {
    const el = e.target as HTMLElement;
    if (el.scrollTop === 0 && hasMore() && !loadingMore()) {
      if (!messages() || messages().length === 0) return;
      const oldest = messages()[0];
      if (!oldest) return;
      const oldHeight = el.scrollHeight;
      loadMessages(oldest.created_at).then(() => {
        // Preserve scroll position after prepending
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - oldHeight;
        });
      });
    }
  }

  async function markAllRead() {
    await api.markAllNotificationsRead();
    refetchNotifs();
  }

  async function handleSendMessage() {
    const uid = selectedUser();
    const content = messageInput().trim();
    if (!uid || !content) return;
    setSending(true);
    try {
      const sent = await api.sendDirectMessage(uid, content);
      setMessageInput("");
      // Append the sent message directly
      setMessages(prev => [...prev, sent]);
      try {
        refetchConvos();
      } catch (refetchErr) {
        // Refetch failures are non-critical — data will refresh on next event
        console.warn("[Activity] refetchConvos failed:", refetchErr instanceof Error ? refetchErr.message : "Unknown error");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      alert(errMsg);
    } finally {
      setSending(false);
    }
  }

  function selectConversation(userId: string) {
    setSelectedUser(userId);
  }

  // Get name from conversation list for header
  const selectedConvoUser = () => {
    const uid = selectedUser();
    if (!uid) return null;
    return conversations()?.find(c => c.user_id === uid) || null;
  };

  return (
    <div class="max-w-5xl mx-auto px-6 lg:px-8 py-12">
      {/* Header */}
      <div class="mb-8 animate-fade-in-up">
        <p class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
          Personal space
        </p>
        <h1 class="font-display text-4xl md:text-5xl font-bold mb-4" style={{ color: "var(--cream)" }}>
          Activity
        </h1>
      </div>

      {/* Tabs */}
      <div class="flex items-center gap-1 mb-8 p-1 rounded-xl inline-flex" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <button
          class="px-5 py-2 rounded-lg text-sm font-medium transition-all"
          style={{
            background: tab() === "notifications" ? "var(--gold)" : "transparent",
            color: tab() === "notifications" ? "var(--noir)" : "var(--cream-muted)",
          }}
          onClick={() => setTab("notifications")}
        >
          Notifications
        </button>
        <button
          class="px-5 py-2 rounded-lg text-sm font-medium transition-all"
          style={{
            background: tab() === "messages" ? "var(--gold)" : "transparent",
            color: tab() === "messages" ? "var(--noir)" : "var(--cream-muted)",
          }}
          onClick={() => setTab("messages")}
        >
          Messages
        </button>
      </div>

      {/* NOTIFICATIONS TAB */}
      <Show when={tab() === "notifications"}>
        <div class="card">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--cream-muted)" }}>
              Notifications
            </h3>
            <button
              class="text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ color: "var(--gold)", border: "1px solid rgba(212,168,83,0.3)" }}
              onClick={markAllRead}
            >
              Mark all as read
            </button>
          </div>

          <Show when={!notifications.loading} fallback={
            <div class="flex items-center gap-3 py-6">
              <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
              <span class="text-sm" style={{ color: "var(--text-muted)" }}>Loading...</span>
            </div>
          }>
            <Show when={(notifications() || []).length > 0} fallback={
              <p class="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>No notifications.</p>
            }>
              <div class="space-y-2">
                <For each={notifications()!}>
                  {(notif) => (
                    <div
                      class="flex items-start gap-3 p-3 rounded-lg transition-all"
                      style={{
                        background: notif.is_read ? "transparent" : "rgba(212,168,83,0.05)",
                        border: notif.is_read ? "1px solid transparent" : "1px solid rgba(212,168,83,0.15)",
                      }}
                    >
                      <div class="w-2 h-2 rounded-full mt-1.5 shrink-0"
                        style={{ background: notif.is_read ? "var(--border)" : (KIND_COLORS[notif.kind] || "var(--gold)") }} />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="text-xs font-medium px-2 py-0.5 rounded"
                            style={{ background: "var(--surface-light)", color: KIND_COLORS[notif.kind] || "var(--cream-muted)" }}>
                            {KIND_LABELS[notif.kind] || notif.kind}
                          </span>
                          <span class="text-xs" style={{ color: "var(--text-muted)" }}>
                            {formatDate(notif.created_at)}
                          </span>
                        </div>
                        <p class="text-sm" style={{ color: notif.is_read ? "var(--cream-muted)" : "var(--cream)" }}>
                          {notif.title}
                        </p>
                        <Show when={notif.body}>
                          <p class="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>{notif.body}</p>
                        </Show>
                        <Show when={notif.kind === "invitation_received" && notif.reference_id && !notif.is_read}>
                          <div class="flex items-center gap-2 mt-2">
                            <button
                              class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                              style={{ background: "rgba(76,175,80,0.15)", color: "var(--emerald)", border: "1px solid rgba(76,175,80,0.3)" }}
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await api.acceptInvitation(notif.reference_id!);
                                  await api.markNotificationRead(notif.id);
                                  refetchNotifs();
                                } catch (err) { alert((err as Error).message); }
                              }}
                            >
                              Accept
                            </button>
                            <button
                              class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                              style={{ background: "rgba(229,115,115,0.15)", color: "var(--accent)", border: "1px solid rgba(229,115,115,0.3)" }}
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await api.rejectInvitation(notif.reference_id!);
                                  await api.markNotificationRead(notif.id);
                                  refetchNotifs();
                                } catch (err) { alert((err as Error).message); }
                              }}
                            >
                              Decline
                            </button>
                          </div>
                        </Show>
                        <Show when={notif.project_id && notif.kind !== "invitation_received"}>
                          <A href={`/projects/${notif.project_id}`}
                            class="text-xs mt-1 inline-block"
                            style={{ color: "var(--gold)" }}>
                            View project →
                          </A>
                        </Show>
                        <Show when={notif.project_id && notif.kind === "invitation_received" && notif.is_read}>
                          <A href={`/projects/${notif.project_id}`}
                            class="text-xs mt-1 inline-block"
                            style={{ color: "var(--gold)" }}>
                            View project →
                          </A>
                        </Show>
                      </div>
                      <Show when={!notif.is_read}>
                        <button
                          class="text-xs shrink-0 px-2 py-1 rounded"
                          style={{ color: "var(--text-muted)" }}
                          aria-label="Mark as read"
                          onClick={async () => {
                            await api.markNotificationRead(notif.id);
                            refetchNotifs();
                          }}
                        >
                          ✓
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </Show>

      {/* MESSAGES TAB */}
      <Show when={tab() === "messages"}>
        <div class="flex gap-6" style={{ "min-height": "500px" }}>
          {/* Conversations list */}
          <div class="w-72 shrink-0">
            <div class="card" style={{ height: "100%" }}>
              <h3 class="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "var(--cream-muted)" }}>
                Conversations
              </h3>
              <Show when={!conversations.loading} fallback={
                <p class="text-xs" style={{ color: "var(--text-muted)" }}>Loading...</p>
              }>
                <Show when={(conversations() || []).length > 0} fallback={
                  <p class="text-xs" style={{ color: "var(--text-muted)" }}>No conversations.</p>
                }>
                  <div class="space-y-1">
                    <For each={conversations()!}>
                      {(conv) => (
                        <button
                          class="w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all"
                          style={{
                            background: selectedUser() === conv.user_id ? "var(--surface-light)" : "transparent",
                          }}
                          onClick={() => selectConversation(conv.user_id)}
                        >
                          {conv.avatar_url ? (
                            <img src={sanitizeImageUrl(conv.avatar_url)} alt={`${conv.display_name || "User"} avatar`} class="w-8 h-8 rounded-full object-cover shrink-0" />
                          ) : (
                            <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                              style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
                              {conv.display_name?.[0]?.toUpperCase() || "?"}
                            </div>
                          )}
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between">
                              <p class="text-sm font-medium truncate" style={{ color: "var(--cream)" }}>
                                {conv.display_name || "User"}
                              </p>
                              <Show when={conv.unread_count > 0}>
                                <span class="w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold"
                                  style={{ background: "var(--accent)", color: "white" }}>
                                  {conv.unread_count}
                                </span>
                              </Show>
                            </div>
                            <p class="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                              {conv.last_message || "..."}
                            </p>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </div>

          {/* Chat area */}
          <div class="flex-1">
            <div class="card" style={{ height: "100%", display: "flex", "flex-direction": "column" }}>
              <Show when={selectedUser()} fallback={
                <div class="flex-1 flex items-center justify-center">
                  <p class="text-sm" style={{ color: "var(--text-muted)" }}>Select a conversation</p>
                </div>
              }>
                {/* Chat header */}
                <div class="flex items-center gap-3 pb-4 mb-4" style={{ "border-bottom": "1px solid var(--border)" }}>
                  <Show when={selectedConvoUser()}>
                    {selectedConvoUser()!.avatar_url ? (
                      <img src={sanitizeImageUrl(selectedConvoUser()!.avatar_url)} alt={`${selectedConvoUser()!.display_name || "User"} avatar`} class="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
                        {selectedConvoUser()!.display_name?.[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                    <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>
                      {selectedConvoUser()!.display_name}
                    </span>
                  </Show>
                </div>

                {/* Messages */}
                <div class="flex-1 overflow-y-auto space-y-3 mb-4" style={{ "max-height": "400px" }} onScroll={handleScroll}>
                  <Show when={!initialLoading()} fallback={
                    <p class="text-xs" style={{ color: "var(--text-muted)" }}>Loading...</p>
                  }>
                    {loadingMore() && <div class="text-center text-xs py-2" style={{ color: "var(--text-muted)" }}>Loading older messages...</div>}
                    <For each={messages()}>
                      {(msg) => {
                        const isMe = () => msg.sender_id === user()?.id;
                        return (
                          <div class="flex" style={{ "justify-content": isMe() ? "flex-end" : "flex-start" }}>
                            <div
                              class="max-w-[75%] px-3 py-2 rounded-lg"
                              style={{
                                background: isMe() ? "rgba(212,168,83,0.15)" : "var(--surface-light)",
                                color: "var(--cream)",
                              }}
                            >
                              <p class="text-sm">{msg.content}</p>
                              <p class="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                                {formatDate(msg.created_at)}
                              </p>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>

                {/* Input */}
                <div class="flex items-center gap-2">
                  <input
                    class="input flex-1"
                    placeholder="Write a message..."
                    value={messageInput()}
                    onInput={(e) => setMessageInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <button
                    class="btn-gold text-xs"
                    onClick={handleSendMessage}
                    disabled={sending() || !messageInput().trim()}
                  >
                    {sending() ? "..." : "Send"}
                  </button>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
