import { createSignal, onMount, onCleanup, For, Show, createResource, createEffect, JSX } from "solid-js";
import { useProject } from "~/lib/project-context";
import { api } from "~/lib/api-client";
import type { ThreadDetail, MessageDetail, PublicUser } from "~/lib/api-client";
import { formatDate, sanitizeImageUrl } from "~/lib/utils";

export default function ProjectDiscussion(props: Record<string, any> & { workId?: string }) {
  const { project, user, isCreator } = useProject();
  const [threads, setThreads] = createSignal<ThreadDetail[]>([]);
  const [activeThread, setActiveThread] = createSignal<ThreadDetail | null>(null);
  const [messages, setMessages] = createSignal<MessageDetail[]>([]);
  const [input, setInput] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [showNewThread, setShowNewThread] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal("");
  const [newContent, setNewContent] = createSignal("");
  const [creatingThread, setCreatingThread] = createSignal(false);
  const [showResolve, setShowResolve] = createSignal(false);
  const [conclusion, setConclusion] = createSignal("");
  const [showMentions, setShowMentions] = createSignal(false);
  const [mentionQuery, setMentionQuery] = createSignal("");
  const [mentionIndex, setMentionIndex] = createSignal(0);
  const [activeMentionTarget, setActiveMentionTarget] = createSignal<"message" | "newThread" | null>(null);
  // F4-8: Guard against concurrent message loads from polling + WebSocket
  const [loadingMessages, setLoadingMessages] = createSignal(false);
  // Map display name -> user id for resolving @Name to @[Name](id) on send
  const mentionMap = new Map<string, string>();
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let newContentRef: HTMLTextAreaElement | undefined;
  let pollInterval: ReturnType<typeof setInterval> | undefined;

  const projectId = () => project()?.id;
  const creatorId = () => project()?.creator_id;

  // Fetch users for @mention autocomplete
  const [usersMap] = createResource(async () => {
    try {
      const users = await api.listUsers();
      const map: Record<string, PublicUser> = {};
      for (const u of users) map[u.id] = u;
      return map;
    } catch { return {}; }
  });

  const mentionCandidates = () => {
    const p = project();
    const map = usersMap();
    if (!p || !map) return [];
    const q = mentionQuery().toLowerCase();
    const participantUserIds = p.participants
      .filter((pt) => pt.user_id && pt.status !== "rejected" && pt.status !== "kicked")
      .map((pt) => pt.user_id!);
    // Also include creator
    const allIds = [...new Set([p.creator_id, ...participantUserIds])];
    return allIds
      .filter((id) => map[id] && map[id].display_name.toLowerCase().includes(q))
      .map((id) => map[id]);
  };

  async function loadThreads() {
    const pid = projectId();
    if (!pid) return;
    try {
      const t = await api.listThreads(pid, props.workId);
      setThreads(t);
    } catch (e) {
      console.error("Failed to load threads:", e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function openThread(thread: ThreadDetail) {
    mentionMap.clear();
    setActiveThread(thread);
    setMessages([]);
    try {
      const msgs = await api.listMessages(thread.id);
      setMessages(msgs);
      scrollToBottom();
    } catch (e) {
      console.error("Failed to load messages:", e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function pollMessages() {
    const thread = activeThread();
    if (!thread) return;
    // F4-8: Skip if another load is already in progress (prevents polling + WebSocket race)
    if (loadingMessages()) return;
    setLoadingMessages(true);
    // Save the active thread before the async fetch so we can detect changes
    const threadAtStart = thread;
    const msgs = messages();
    const since = msgs.length > 0 ? msgs[msgs.length - 1].created_at : undefined;
    try {
      const newMsgs = await api.listMessages(thread.id, since);
      // If the user switched threads while we were fetching, discard the result
      if (activeThread()?.id !== threadAtStart.id) return;
      if (newMsgs.length > 0) {
        setMessages((prev) => [...prev, ...newMsgs]);
        scrollToBottom();
      }
    } catch { /* ignore */ } finally {
      setLoadingMessages(false);
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEndRef?.scrollIntoView({ behavior: "smooth" });
    });
  }

  onMount(() => {
    loadThreads();
    pollInterval = setInterval(() => {
      if (document.hidden) return;
      if (activeThread()) pollMessages();
    }, 5000);
  });

  onCleanup(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  // Clear mentionMap when switching threads to prevent stale mentions leaking
  createEffect(() => {
    activeThread(); // track
    mentionMap.clear();
  });

  async function handleCreateThread() {
    const pid = projectId();
    if (!pid || !newTitle().trim()) return;
    setCreatingThread(true);
    try {
      const thread = await api.createThread(pid, {
        title: newTitle().trim(),
        content: resolveMentions(newContent().trim()),
        work_id: props.workId,
      });
      setShowNewThread(false);
      setNewTitle("");
      setNewContent("");
      await loadThreads();
      openThread(thread);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCreatingThread(false);
    }
  }

  async function handleSend() {
    const thread = activeThread();
    if (!thread || !input().trim()) return;
    setSending(true);
    try {
      const content = resolveMentions(input().trim());
      const msg = await api.createMessage(thread.id, content);
      setMessages((prev) => [...prev, msg]);
      setInput("");
      scrollToBottom();
    } catch (e) {
      console.error("Failed to send message:", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSending(false);
    }
  }

  function detectMention(el: HTMLInputElement | HTMLTextAreaElement, target: "message" | "newThread") {
    const cursorPos = el.selectionStart || 0;
    const val = el.value;
    const textBefore = val.slice(0, cursorPos);
    const atMatch = textBefore.match(/@([^\s@]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setShowMentions(true);
      setMentionIndex(0);
      setActiveMentionTarget(target);
    } else {
      setShowMentions(false);
      setActiveMentionTarget(null);
    }
  }

  function handleInputChange(e: InputEvent) {
    const el = e.currentTarget as HTMLInputElement;
    setInput(el.value);
    detectMention(el, "message");
  }

  function handleNewContentInput(e: InputEvent) {
    const el = e.currentTarget as HTMLTextAreaElement;
    setNewContent(el.value);
    detectMention(el, "newThread");
  }

  function insertMention(u: PublicUser) {
    const target = activeMentionTarget();
    const el = target === "newThread" ? newContentRef : inputRef;
    if (!el) return;

    const cursorPos = el.selectionStart || 0;
    const val = target === "newThread" ? newContent() : input();
    const textBefore = val.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx === -1) return;

    // Store the mapping for when we send
    mentionMap.set(u.display_name, u.id);

    // Insert just @Name in the visible text
    const mention = `@${u.display_name} `;
    const newVal = val.slice(0, atIdx) + mention + val.slice(cursorPos);

    if (target === "newThread") {
      setNewContent(newVal);
    } else {
      setInput(newVal);
    }
    setShowMentions(false);
    setActiveMentionTarget(null);

    requestAnimationFrame(() => {
      const newPos = atIdx + mention.length;
      el.setSelectionRange(newPos, newPos);
      el.focus();
    });
  }

  /** Convert @Name to @[Name](id) before sending */
  function resolveMentions(text: string): string {
    // Sort by name length descending to match longer names first
    const names = [...mentionMap.keys()].sort((a, b) => b.length - a.length);
    let result = text;
    for (const name of names) {
      const id = mentionMap.get(name)!;
      result = result.replace(new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `@[${name}](${id})`);
    }
    return result;
  }

  function handleMentionKeyDown(e: KeyboardEvent) {
    if (showMentions() && mentionCandidates().length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionCandidates().length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionCandidates()[mentionIndex()]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMentions(false);
        return;
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    handleMentionKeyDown(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleResolve() {
    const thread = activeThread();
    if (!thread) return;
    try {
      const updated = await api.resolveThread(thread.id, conclusion().trim());
      setActiveThread(updated);
      setShowResolve(false);
      setConclusion("");
      await loadThreads();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleReopen() {
    const thread = activeThread();
    if (!thread) return;
    try {
      const updated = await api.reopenThread(thread.id);
      setActiveThread(updated);
      await loadThreads();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // ── Render mentions in message content ──
  function renderMessageContent(content: string, isOwn: boolean): JSX.Element {
    const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const parts: JSX.Element[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<>{content.slice(lastIndex, match.index)}</>);
      }
      const displayName = match[1];
      parts.push(
        <span
          class="font-bold"
          style={{
            color: isOwn ? "white" : "var(--gold)",
            "text-decoration": "underline",
            "text-decoration-color": isOwn ? "rgba(255,255,255,0.4)" : "rgba(212,168,83,0.4)",
            "text-underline-offset": "2px",
          }}
        >@{displayName}</span>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push(<>{content.slice(lastIndex)}</>);
    }
    return <>{parts}</>;
  }

  // ── Thread list view ──
  const ThreadListView = () => (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
          Discussions ({threads().length})
        </h3>
        <button class="btn-secondary text-xs" onClick={() => setShowNewThread(true)}>
          + New topic
        </button>
      </div>

      {/* New thread form */}
      <Show when={showNewThread()}>
        <div class="card space-y-4">
          <div>
            <label class="label">Topic *</label>
            <input class="input" placeholder="E.g.: Revenue split proposal..."
              value={newTitle()} onInput={(e) => setNewTitle(e.currentTarget.value)} autofocus />
          </div>
          <div class="relative">
            <label class="label">First message</label>
            <Show when={showMentions() && activeMentionTarget() === "newThread" && mentionCandidates().length > 0}>
              <div
                class="absolute left-0 right-0 bottom-full mb-1 rounded-xl overflow-hidden shadow-lg z-50"
                style={{ background: "var(--noir-light)", border: "1px solid var(--border-light)", "max-height": "200px", "overflow-y": "auto" }}
              >
                <For each={mentionCandidates()}>
                  {(u, idx) => (
                    <button
                      class="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors"
                      style={{
                        background: idx() === mentionIndex() ? "var(--surface-light)" : "transparent",
                        color: "var(--cream)",
                      }}
                      onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
                      onMouseEnter={() => setMentionIndex(idx())}
                    >
                      {u.avatar_url ? (
                        <img src={sanitizeImageUrl(u.avatar_url)} alt="" class="w-6 h-6 rounded-full object-cover" />
                      ) : (
                        <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
                          {u.display_name?.[0]?.toUpperCase() || "?"}
                        </div>
                      )}
                      <span class="text-sm font-medium">{u.display_name}</span>
                      <span class="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>{u.role}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <textarea class="input min-h-[80px] resize-none" placeholder="Describe your point... (@ to mention)"
              ref={newContentRef}
              value={newContent()} onInput={handleNewContentInput}
              onKeyDown={handleMentionKeyDown}
              onBlur={() => setTimeout(() => { if (activeMentionTarget() === "newThread") setShowMentions(false); }, 200)} />
          </div>
          <div class="flex gap-2">
            <button class="btn-gold flex-1 text-sm" onClick={handleCreateThread}
              disabled={creatingThread() || !newTitle().trim()}>
              {creatingThread() ? "Creating..." : "Create topic"}
            </button>
            <button class="btn-secondary text-sm" onClick={() => { setShowNewThread(false); setNewTitle(""); setNewContent(""); }}>
              Cancel
            </button>
          </div>
        </div>
      </Show>

      {/* Thread list */}
      <Show when={threads().length > 0} fallback={
        <div class="card text-center py-12">
          <p class="text-sm" style={{ color: "var(--text-muted)" }}>
            No discussions yet. Start a new topic!
          </p>
        </div>
      }>
        <div class="space-y-2">
          <For each={threads()}>
            {(thread) => {
              const isResolved = () => thread.status === "resolved";
              return (
                <button
                  class="w-full text-left p-4 rounded-xl transition-all hover:scale-[1.01]"
                  style={{
                    background: isResolved() ? "var(--surface-light)" : "var(--noir-light)",
                    border: `1px solid ${isResolved() ? "var(--border)" : "var(--border-light)"}`,
                    opacity: isResolved() ? 0.7 : 1,
                  }}
                  onClick={() => openThread(thread)}
                >
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center gap-2 mb-1">
                        <span
                          class="w-2 h-2 rounded-full shrink-0"
                          style={{ background: isResolved() ? "var(--emerald)" : "var(--gold)" }}
                        />
                        <span class="font-medium text-sm" style={{ color: "var(--cream)" }}>
                          {thread.title}
                        </span>
                        <Show when={isResolved()}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(52,211,153,0.12)", color: "var(--emerald)" }}>
                            Resolved
                          </span>
                        </Show>
                      </div>
                      <div class="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
                        <span>{thread.author_name}</span>
                        <span>{formatDate(thread.created_at)}</span>
                        <span>{thread.message_count} message{thread.message_count !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <svg class="w-4 h-4 shrink-0 mt-1" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );

  // ── Thread detail view ──
  const ThreadDetailView = () => {
    const t = () => activeThread()!;
    const isResolved = () => t().status === "resolved";

    return (
      <div class="space-y-4">
        {/* Back + header */}
        <div class="flex items-start gap-3">
          <button
            class="mt-1 w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--surface-light)" }}
            onClick={() => { mentionMap.clear(); setActiveThread(null); loadThreads(); }}
          >
            <svg class="w-4 h-4" style={{ color: "var(--cream)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold" style={{ color: "var(--cream)" }}>{t().title}</h3>
              <Show when={isResolved()}>
                <span class="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ background: "rgba(52,211,153,0.12)", color: "var(--emerald)" }}>
                  Resolved
                </span>
              </Show>
            </div>
            <div class="text-xs" style={{ color: "var(--text-muted)" }}>
              By {t().author_name} — {formatDate(t().created_at)}
            </div>
          </div>
        </div>

        {/* Conclusion banner */}
        <Show when={isResolved() && t().conclusion}>
          <div class="p-4 rounded-xl" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)" }}>
            <div class="flex items-center gap-2 mb-2">
              <svg class="w-4 h-4" style={{ color: "var(--emerald)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <span class="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--emerald)" }}>
                Conclusion {t().concluded_by_name ? `by ${t().concluded_by_name}` : ""}
              </span>
            </div>
            <p class="text-sm" style={{ color: "var(--cream)" }}>{t().conclusion}</p>
          </div>
        </Show>

        {/* Messages */}
        <div class="card" style={{ padding: "0", overflow: "hidden" }}>
          <div class="overflow-y-auto p-6 space-y-4" style={{ "max-height": "400px", "min-height": "200px" }}>
            <Show when={messages().length === 0}>
              <div class="flex items-center justify-center py-8">
                <p class="text-sm" style={{ color: "var(--text-muted)" }}>No messages in this topic.</p>
              </div>
            </Show>
            <For each={messages()}>
              {(msg) => {
                const isOwn = () => msg.user_id === user()?.id;
                const isOwner = () => msg.user_id === creatorId();
                return (
                  <div class="flex gap-3" classList={{ "flex-row-reverse": isOwn() }}>
                    <div class="shrink-0 relative">
                      {msg.avatar_url ? (
                        <img src={sanitizeImageUrl(msg.avatar_url)} alt="" class="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                          style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
                          {msg.display_name?.[0]?.toUpperCase() || "?"}
                        </div>
                      )}
                      <Show when={isOwner()}>
                        <div class="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px]"
                          style={{ background: "var(--gold)", color: "var(--noir)" }} title="Creator">&#9733;</div>
                      </Show>
                    </div>
                    <div class="max-w-[70%] rounded-xl px-4 py-2.5"
                      style={{ background: isOwn() ? "var(--accent)" : "var(--surface-light)", color: isOwn() ? "white" : "var(--cream)" }}>
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-xs font-medium" style={{ color: isOwn() ? "rgba(255,255,255,0.8)" : "var(--gold)" }}>
                          {msg.display_name}
                        </span>
                        <Show when={isOwner()}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: isOwn() ? "rgba(255,255,255,0.15)" : "rgba(212,168,83,0.15)", color: isOwn() ? "rgba(255,255,255,0.8)" : "var(--gold)" }}>
                            Creator
                          </span>
                        </Show>
                      </div>
                      <p class="text-sm leading-relaxed whitespace-pre-wrap">{renderMessageContent(msg.content, isOwn())}</p>
                      <div class="text-[10px] mt-1" style={{ color: isOwn() ? "rgba(255,255,255,0.6)" : "var(--text-muted)" }}>
                        {formatDate(msg.created_at)}
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <Show when={!isResolved()}>
            <div class="p-4 relative" style={{ "border-top": "1px solid var(--border)" }}>
              {/* @mention dropdown */}
              <Show when={showMentions() && mentionCandidates().length > 0}>
                <div
                  class="absolute bottom-full left-4 right-4 mb-1 rounded-xl overflow-hidden shadow-lg z-50"
                  style={{ background: "var(--noir-light)", border: "1px solid var(--border-light)", "max-height": "200px", "overflow-y": "auto" }}
                >
                  <For each={mentionCandidates()}>
                    {(u, idx) => (
                      <button
                        class="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors"
                        style={{
                          background: idx() === mentionIndex() ? "var(--surface-light)" : "transparent",
                          color: "var(--cream)",
                        }}
                        onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
                        onMouseEnter={() => setMentionIndex(idx())}
                      >
                        {u.avatar_url ? (
                          <img src={sanitizeImageUrl(u.avatar_url)} alt="" class="w-6 h-6 rounded-full object-cover" />
                        ) : (
                          <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
                            {u.display_name?.[0]?.toUpperCase() || "?"}
                          </div>
                        )}
                        <span class="text-sm font-medium">{u.display_name}</span>
                        <span class="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>{u.role}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <div class="flex gap-3">
                <input class="input flex-1" placeholder="Write a message... (@ to mention)"
                  ref={inputRef}
                  value={input()} onInput={handleInputChange}
                  onKeyDown={handleKeyDown} disabled={sending()}
                  onBlur={() => setTimeout(() => setShowMentions(false), 200)} />
                <button class="btn-gold" onClick={handleSend}
                  disabled={sending() || !input().trim()}>
                  {sending() ? "..." : "Send"}
                </button>
              </div>
            </div>
          </Show>
        </div>

        {/* Actions */}
        <div class="flex gap-2">
          <Show when={!isResolved()}>
            <Show when={!showResolve()} fallback={
              <div class="flex-1 card space-y-3">
                <div>
                  <label class="label">Conclusion</label>
                  <textarea class="input min-h-[60px] resize-none" placeholder="Summarize the decision made..."
                    value={conclusion()} onInput={(e) => setConclusion(e.currentTarget.value)} />
                </div>
                <div class="flex gap-2">
                  <button class="btn-gold flex-1 text-sm" onClick={handleResolve}>
                    Mark as resolved
                  </button>
                  <button class="btn-secondary text-sm" onClick={() => setShowResolve(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            }>
              <button class="btn-secondary text-xs" onClick={() => setShowResolve(true)}>
                Resolve this topic
              </button>
            </Show>
          </Show>
          <Show when={isResolved()}>
            <button class="btn-secondary text-xs" onClick={handleReopen}>
              Reopen this topic
            </button>
          </Show>
        </div>
      </div>
    );
  };

  return (
    <Show when={activeThread()} fallback={<ThreadListView />}>
      <ThreadDetailView />
    </Show>
  );
}
