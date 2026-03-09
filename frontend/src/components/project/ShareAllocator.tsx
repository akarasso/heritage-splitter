import { createSignal, For, Show, createResource, createMemo, onCleanup } from "solid-js";
import type { AllocationDetail, PublicUser, CreateAllocationInput, Participant } from "~/lib/api-client";
import { api } from "~/lib/api-client";
import { bpsToPercent, sanitizeImageUrl } from "~/lib/utils";
import { showAlert, showConfirm } from "~/lib/modal-store";

const ALLOC_COLORS = [
  "var(--accent)", "var(--gold)", "var(--emerald)", "var(--violet)",
  "#EC4899", "#06B6D4", "#F59E0B", "#84CC16",
];

interface Props {
  projectId: string;
  collectionId?: string;
  allocations: AllocationDetail[];
  creatorSharesBps: number;
  onUpdate: () => void;
  projectParticipants?: Participant[];
}

export default function ShareAllocator(props: Props) {
  const [showForm, setShowForm] = createSignal(false);
  const [formLabel, setFormLabel] = createSignal("");
  const [formPercent, setFormPercent] = createSignal(10);
  const [formMaxSlots, setFormMaxSlots] = createSignal<string>("1");
  const [formUnlimited, setFormUnlimited] = createSignal(false);
  const [formMode, setFormMode] = createSignal("equal");
  const [creating, setCreating] = createSignal(false);

  // Editing
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editPercent, setEditPercent] = createSignal(0);
  const [editLabel, setEditLabel] = createSignal("");
  const [editMode, setEditMode] = createSignal("equal");
  const [editMaxSlots, setEditMaxSlots] = createSignal<string>("1");
  const [editUnlimited, setEditUnlimited] = createSignal(false);

  // Invite
  const [invitingAllocId, setInvitingAllocId] = createSignal<string | null>(null);
  const [inviteSearch, setInviteSearch] = createSignal("");
  const [inviteSelected, setInviteSelected] = createSignal<PublicUser | null>(null);
  const [inviteShares, setInviteShares] = createSignal(0);
  const [inviteFocused, setInviteFocused] = createSignal(false);

  const [usersMap] = createResource(async () => {
    try {
      const users = await api.listUsers();
      const map: Record<string, PublicUser> = {};
      for (const u of users) map[u.id] = u;
      return map;
    } catch { return {}; }
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

  // Build list of eligible project members for invite
  const eligibleMembers = createMemo(() => {
    const map = usersMap();
    if (!map) return [];
    const participants = props.projectParticipants || [];
    // Get user IDs already in any allocation
    const allocUserIds = new Set<string>();
    for (const alloc of props.allocations) {
      for (const p of alloc.participants) {
        if (p.user_id && p.status !== "rejected") allocUserIds.add(p.user_id);
      }
    }
    // Filter project participants to those accepted and not already in an allocation
    return participants
      .filter(p => p.user_id && p.status === "accepted" && !allocUserIds.has(p.user_id!))
      .map(p => map[p.user_id!])
      .filter((u): u is PublicUser => !!u);
  });

  // Filtered invite results based on search query
  const filteredInviteResults = createMemo(() => {
    const members = eligibleMembers();
    const query = inviteSearch().toLowerCase().trim();
    if (!query) return members;
    return members.filter(u => u.display_name.toLowerCase().includes(query));
  });

  const showFormDistribution = () => {
    if (formUnlimited()) return true;
    const slots = parseInt(formMaxSlots());
    return slots >= 2;
  };

  async function handleCreate() {
    if (!formLabel().trim()) return;
    setCreating(true);
    try {
      const maxSlots = formUnlimited() ? null : (parseInt(formMaxSlots()) || 1);
      const shouldForceEqual = !showFormDistribution();
      const data: CreateAllocationInput = {
        label: formLabel().trim(),
        total_bps: Math.round(formPercent() * 100),
        max_slots: maxSlots,
        distribution_mode: shouldForceEqual ? "equal" : formMode(),
        receives_primary: false,
      };
      if (props.collectionId) {
        await api.createCollectionAllocation(props.collectionId, data);
      } else {
        await api.createAllocation(props.projectId, data);
      }
      setShowForm(false);
      setFormLabel("");
      setFormPercent(10);
      setFormMaxSlots("1");
      setFormUnlimited(false);
      setFormMode("equal");
      props.onUpdate();
    } catch (e) {
      showAlert({ title: "Error", message: (e as Error).message });
    } finally {
      setCreating(false);
    }
  }

  function startEdit(alloc: AllocationDetail) {
    setEditingId(alloc.id);
    setEditPercent(alloc.total_bps / 100);
    setEditLabel(alloc.label);
    setEditMode(alloc.distribution_mode);
    setEditUnlimited(alloc.max_slots == null);
    setEditMaxSlots(alloc.max_slots != null ? String(alloc.max_slots) : "1");
  }

  async function handleSaveEdit(alloc: AllocationDetail) {
    if (!editLabel().trim()) return;
    const maxSlots = editUnlimited() ? null : (parseInt(editMaxSlots()) || 1);
    if (maxSlots != null && maxSlots < alloc.filled_slots) {
      showAlert({ title: "Insufficient slots", message: `Cannot proceed: ${alloc.filled_slots} participant${alloc.filled_slots > 1 ? "s" : ""} already present. Remove participants first.` });
      return;
    }
    try {
      const shouldShowDist = editUnlimited() || (parseInt(editMaxSlots()) >= 2);
      await api.updateAllocation(alloc.id, {
        total_bps: Math.round(editPercent() * 100),
        label: editLabel().trim(),
        distribution_mode: shouldShowDist ? editMode() : "equal",
        max_slots: maxSlots,
        receives_primary: false,
      });
      setEditingId(null);
      props.onUpdate();
    } catch (e) {
      showAlert({ title: "Error", message: (e as Error).message });
    }
  }

  function handleDelete(allocId: string) {
    showConfirm({
      title: "Delete share",
      message: "Delete this share?",
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: async () => {
        try {
          await api.deleteAllocation(allocId);
          props.onUpdate();
        } catch (e) {
          showAlert({ title: "Error", message: (e as Error).message });
        }
      },
    });
  }

  // Invite logic — now filters from project members
  let inviteSearchTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { if (inviteSearchTimer) clearTimeout(inviteSearchTimer); });

  function handleInviteSearch(query: string) {
    setInviteSelected(null);
    if (inviteSearchTimer) clearTimeout(inviteSearchTimer);
    inviteSearchTimer = setTimeout(() => {
      setInviteSearch(query);
    }, 300);
  }

  function selectInviteUser(user: PublicUser) {
    setInviteSelected(user);
    setInviteSearch(user.display_name);
    setInviteFocused(false);
  }

  async function handleInvite(allocId: string, alloc: AllocationDetail) {
    const u = inviteSelected();
    if (!u) return;
    try {
      await api.addParticipant(props.projectId, {
        user_id: u.id,
        role: alloc.role,
        shares_bps: alloc.distribution_mode === "custom" ? Math.round(inviteShares() * 100) : 0,
        allocation_id: allocId,
      });
      setInvitingAllocId(null);
      setInviteSearch("");
      setInviteSelected(null);
      setInviteShares(0);
      props.onUpdate();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showAlert({ title: "Error", message: msg });
      // Reset invite form so user can retry
      setInviteSelected(null);
      setInviteSearch("");
      setInviteShares(0);
    }
  }

  async function handleApprove(participantId: string) {
    try { await api.acceptInvitation(participantId); props.onUpdate(); }
    catch (e) { showAlert({ title: "Error", message: (e as Error).message }); }
  }

  async function handleRejectRequest(participantId: string) {
    try { await api.rejectInvitation(participantId); props.onUpdate(); }
    catch (e) { showAlert({ title: "Error", message: (e as Error).message }); }
  }

  function handleRemoveParticipant(participantId: string) {
    showConfirm({
      title: "Remove participant",
      message: "Remove this participant?",
      confirmLabel: "Remove",
      variant: "danger",
      onConfirm: async () => {
        try {
          await api.kickParticipant(participantId);
          props.onUpdate();
        } catch (e) { showAlert({ title: "Error", message: (e as Error).message }); }
      },
    });
  }

  async function handleUpdateShares(participantId: string, newPercent: number) {
    try {
      const newBps = Math.round(newPercent * 100);
      await api.updateParticipant(participantId, { shares_bps: newBps });
      props.onUpdate();
    } catch (e) { showAlert({ title: "Error", message: (e as Error).message }); }
  }

  const totalAllocBps = () => props.allocations.reduce((sum, a) => sum + a.total_bps, 0);

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
          Shares ({props.allocations.length + 1})
        </h3>
        <button class="btn-secondary text-xs" onClick={() => setShowForm(!showForm())}>
          {showForm() ? "Cancel" : "+ Add a share"}
        </button>
      </div>

      {/* Create form */}
      <Show when={showForm()}>
        <div class="card space-y-4">
          <div>
            <label class="label">Share name *</label>
            <input
              class="input"
              placeholder="E.g.: Lead Artist, Producer..."
              value={formLabel()}
              onInput={(e) => setFormLabel(e.currentTarget.value)}
              autofocus
            />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label">Percentage (%)</label>
              <input class="input" type="number" min="0.1" max="100" step="0.1"
                value={formPercent()} onInput={(e) => setFormPercent(parseFloat(e.currentTarget.value) || 0)} />
            </div>
            <div>
              <label class="label">Slots</label>
              <div class="flex items-center gap-3 h-10">
                <ToggleSwitch checked={formUnlimited()} onChange={() => setFormUnlimited(!formUnlimited())} />
                <span class="text-xs whitespace-nowrap" style={{ color: formUnlimited() ? "var(--gold)" : "var(--cream-muted)" }}>
                  {formUnlimited() ? "Unlimited" : "Limited"}
                </span>
                <Show when={!formUnlimited()}>
                  <input class="input" type="number" min="1" max="50"
                    value={formMaxSlots()} onInput={(e) => setFormMaxSlots(e.currentTarget.value)}
                    style={{ width: "80px" }} />
                </Show>
              </div>
            </div>
          </div>
          <Show when={showFormDistribution()}>
            <div>
              <label class="label">Distribution</label>
              <select class="input" value={formMode()} onChange={(e) => setFormMode(e.currentTarget.value)}>
                <option value="equal">Equal</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </Show>
          <button class="btn-gold w-full" onClick={handleCreate}
            disabled={creating() || formPercent() <= 0 || !formLabel().trim() || (totalAllocBps() + Math.round(formPercent() * 100)) > 10000}>
            {creating() ? "Creating..." : "Create share"}
          </button>
          <Show when={(totalAllocBps() + Math.round(formPercent() * 100)) > 10000}>
            <p class="text-xs text-center" style={{ color: "var(--accent)" }}>
              Total would exceed 100%. Reduce the percentage.
            </p>
          </Show>
        </div>
      </Show>

      {/* Cards */}
      <For each={props.allocations}>
        {(alloc, idx) => {
          const color = () => ALLOC_COLORS[idx() % ALLOC_COLORS.length];
          const requests = () => alloc.participants.filter(p => p.status === "requested");
          const active = () => alloc.participants.filter(p => p.status !== "requested" && p.status !== "rejected");
          const isEditing = () => editingId() === alloc.id;
          const isInviting = () => invitingAllocId() === alloc.id;
          const isFull = () => alloc.max_slots != null && alloc.filled_slots >= alloc.max_slots;

          return (
            <div class="card" style={{ "border-left": `4px solid ${color()}`, background: `${color()}08` }}>
              <Show when={!isEditing()} fallback={
                /* -- EDIT MODE -- */
                <div class="space-y-4 mb-4">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
                      Edit share
                    </span>
                    <div class="flex items-center gap-2">
                      <button class="btn-gold text-xs" style={{ padding: "4px 12px" }} onClick={() => handleSaveEdit(alloc)}>
                        Save
                      </button>
                      <button class="btn-secondary text-xs" style={{ padding: "4px 10px" }} onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>

                  <div>
                    <label class="label">Name *</label>
                    <input class="input" value={editLabel()} onInput={(e) => setEditLabel(e.currentTarget.value)} />
                  </div>

                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="label">Percentage (%)</label>
                      <input class="input" type="number" min="0.1" max="100" step="0.1"
                        value={editPercent()} onInput={(e) => setEditPercent(parseFloat(e.currentTarget.value) || 0)} />
                    </div>
                    <div>
                      <label class="label">Slots</label>
                      <div class="flex items-center gap-3 h-10">
                        <ToggleSwitch checked={editUnlimited()} onChange={() => setEditUnlimited(!editUnlimited())} />
                        <span class="text-xs whitespace-nowrap" style={{ color: editUnlimited() ? "var(--gold)" : "var(--cream-muted)" }}>
                          {editUnlimited() ? "Unlimited" : "Limited"}
                        </span>
                        <Show when={!editUnlimited()}>
                          <input class="input" type="number"
                            min={Math.max(1, alloc.filled_slots)}
                            max="50"
                            value={editMaxSlots()} onInput={(e) => setEditMaxSlots(e.currentTarget.value)}
                            style={{ width: "80px" }} />
                        </Show>
                      </div>
                      <Show when={!editUnlimited() && alloc.filled_slots > 0}>
                        <p class="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                          Min. {alloc.filled_slots} (current participants)
                        </p>
                      </Show>
                    </div>
                  </div>

                  <Show when={editUnlimited() || parseInt(editMaxSlots()) >= 2}>
                    <div>
                      <label class="label">Distribution</label>
                      <select class="input" value={editMode()} onChange={(e) => setEditMode(e.currentTarget.value)}>
                        <option value="equal">Equal</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                  </Show>

                  <div class="divider" />
                </div>
              }>
                {/* -- VIEW MODE -- */}
                <div class="flex items-start justify-between mb-4">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-semibold" style={{ color: "var(--cream)" }}>{alloc.label}</span>
                    </div>
                    <div class="flex items-center gap-3 mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      <span class="font-mono font-bold" style={{ color: "var(--gold)" }}>{bpsToPercent(alloc.total_bps)}</span>
                      <Show when={alloc.max_slots == null || alloc.max_slots >= 2}>
                        <span>{alloc.distribution_mode === "equal" ? "Equal" : "Custom"}</span>
                      </Show>
                      <span>{alloc.max_slots == null ? "Unlimited" : `${alloc.filled_slots}/${alloc.max_slots} slot${alloc.max_slots > 1 ? "s" : ""}`}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button class="btn-secondary text-xs" style={{ padding: "4px 10px" }} onClick={() => startEdit(alloc)}>
                      Edit
                    </button>
                    <button class="text-xs px-2 py-1 rounded-lg transition-colors"
                      style={{ color: "var(--accent)", background: "rgba(255,59,63,0.08)" }}
                      onClick={() => handleDelete(alloc.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </Show>

              {/* Join requests */}
              <Show when={requests().length > 0}>
                <div class="mb-3">
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-2 h-2 rounded-full" style={{ background: "var(--gold)" }} />
                    <span class="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--gold)" }}>
                      Requests ({requests().length})
                    </span>
                  </div>
                  <div class="space-y-2">
                    <For each={requests()}>
                      {(p) => (
                        <div class="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--noir-light)", border: "1px solid rgba(212,168,83,0.2)" }}>
                          <div class="flex items-center gap-2">
                            <Avatar url={getAvatar(p.user_id)} name={getName(p.user_id)} />
                            <span class="text-sm" style={{ color: "var(--cream)" }}>{getName(p.user_id)}</span>
                          </div>
                          <div class="flex gap-2">
                            <button class="text-xs px-3 py-1.5 rounded-lg font-medium"
                              style={{ background: "rgba(52,211,153,0.12)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.3)" }}
                              onClick={() => handleApprove(p.id)}>Accept</button>
                            <button class="btn-secondary text-xs" style={{ padding: "6px 12px" }}
                              onClick={() => handleRejectRequest(p.id)}>Reject</button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Participants */}
              <div class="space-y-2">
                <For each={active()} fallback={
                  <p class="text-xs py-3 text-center" style={{ color: "var(--text-muted)" }}>No participants</p>
                }>
                  {(p) => (
                    <div class="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--noir-light)" }}>
                      <div class="flex items-center gap-3">
                        <Avatar url={getAvatar(p.user_id)} name={getName(p.user_id)} />
                        <div>
                          <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>{getName(p.user_id)}</span>
                          <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-xs font-mono" style={{ color: "var(--gold)" }}>{alloc.total_bps > 0 ? bpsToPercent(Math.round(p.shares_bps / alloc.total_bps * 10000)) : "0%"}</span>
                            <span class="text-xs" style={{ color: "var(--text-muted)" }}>— {p.status}</span>
                          </div>
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Show when={alloc.distribution_mode === "custom"}>
                          <input class="input text-xs text-center" type="number" min="0" max="100" step="0.1"
                            style={{ width: "70px", padding: "4px 8px" }}
                            value={alloc.total_bps > 0 ? (p.shares_bps / alloc.total_bps * 100).toFixed(1) : "0"}
                            onChange={(e) => {
                              const relativePercent = parseFloat(e.currentTarget.value) || 0;
                              const absoluteBps = Math.round(relativePercent / 100 * alloc.total_bps);
                              handleUpdateShares(p.id, absoluteBps / 100);
                            }} />
                        </Show>
                        <button class="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors shrink-0"
                          style={{ color: "var(--accent)", background: "rgba(255,59,63,0.08)" }}
                          onClick={() => handleRemoveParticipant(p.id)} title="Remove" aria-label="Remove participant">&times;</button>
                      </div>
                    </div>
                  )}
                </For>
              </div>

              {/* Invite */}
              <Show when={!isFull()}>
                <div class="mt-3">
                  <Show when={isInviting()} fallback={
                    <button class="btn-secondary text-xs w-full" onClick={() => { setInvitingAllocId(alloc.id); setInviteSearch(""); setInviteSelected(null); setInviteFocused(false); }}>
                      + Invite a participant
                    </button>
                  }>
                    <div class="p-4 rounded-xl space-y-3" style={{ background: "var(--noir-light)", border: "1px solid var(--border)" }}>
                      <div class="relative">
                        <input class="input" placeholder="Search for a project member..."
                          value={inviteSearch()}
                          onInput={(e) => handleInviteSearch(e.currentTarget.value)}
                          onFocus={() => setInviteFocused(true)}
                          onBlur={() => setTimeout(() => setInviteFocused(false), 200)}
                          autofocus />
                        <Show when={inviteSelected()}>
                          <div class="mt-2 flex items-center gap-2 p-2 rounded-lg"
                            style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)" }}>
                            <Avatar url={inviteSelected()!.avatar_url || ""} name={inviteSelected()!.display_name} />
                            <span class="text-sm" style={{ color: "var(--cream)" }}>{inviteSelected()!.display_name}</span>
                          </div>
                        </Show>
                        <Show when={(inviteFocused() || inviteSearch().length > 0) && !inviteSelected() && filteredInviteResults().length > 0}>
                          <div class="absolute z-10 w-full mt-1 rounded-xl shadow-2xl max-h-48 overflow-y-auto"
                            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                            <For each={filteredInviteResults()}>
                              {(u) => (
                                <button class="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors hover:bg-white/5"
                                  onMouseDown={(e) => { e.preventDefault(); selectInviteUser(u); }}>
                                  <Avatar url={u.avatar_url || ""} name={u.display_name} />
                                  <div class="flex-1 min-w-0">
                                    <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>{u.display_name}</span>
                                    <Show when={u.role}>
                                      <span class="text-xs ml-2" style={{ color: "var(--text-muted)" }}>{u.role}</span>
                                    </Show>
                                  </div>
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                        <Show when={(inviteFocused() || inviteSearch().length > 0) && !inviteSelected() && filteredInviteResults().length === 0}>
                          <div class="absolute z-10 w-full mt-1 rounded-xl shadow-2xl px-4 py-3"
                            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                            <p class="text-xs" style={{ color: "var(--text-muted)" }}>
                              {eligibleMembers().length === 0
                                ? "All project members are already assigned."
                                : "No matching members found."}
                            </p>
                          </div>
                        </Show>
                      </div>
                      <Show when={alloc.distribution_mode === "custom"}>
                        <div>
                          <label class="label">Shares (%)</label>
                          <input class="input" type="number" min="0" max="100" step="0.1"
                            value={inviteShares()} onInput={(e) => setInviteShares(parseFloat(e.currentTarget.value) || 0)} />
                        </div>
                      </Show>
                      <div class="flex gap-2">
                        <button class="btn-gold flex-1 text-xs" onClick={() => handleInvite(alloc.id, alloc)}
                          disabled={!inviteSelected()}>Invite</button>
                        <button class="btn-secondary text-xs" onClick={() => { setInvitingAllocId(null); setInviteSearch(""); setInviteSelected(null); }}>
                          Cancel</button>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>

      {/* Creator share */}
      <div class="card" style={{ background: "rgba(212,168,83,0.15)", border: "1px solid rgba(212,168,83,0.3)" }}>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 rounded-sm" style={{ "background-color": "#d4a853" }} />
            <span class="font-semibold" style={{ color: "var(--gold)" }}>Your share (creator)</span>
          </div>
          <span class="text-lg font-bold font-mono" style={{ color: "var(--gold)" }}>{bpsToPercent(props.creatorSharesBps)}</span>
        </div>
        <p class="text-xs mt-2" style={{ color: "var(--gold)", opacity: 0.7 }}>
          The remainder after all shares is automatically allocated to you.
        </p>
      </div>

      {/* Validation */}
      <div class="card">
        <h3 class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
          Deployment validation
        </h3>
        <div class="space-y-2">
          <Show when={totalAllocBps() > 0}>
            <ValidationCheck ok={totalAllocBps() <= 10000} label={`Total: 100% (shares ${bpsToPercent(totalAllocBps())} + creator ${bpsToPercent(10000 - totalAllocBps())})`} />
          </Show>
          <For each={props.allocations}>
            {(alloc) => {
              const activeP = alloc.participants.filter(p => p.status !== "rejected" && p.status !== "requested");
              const allAccepted = activeP.every(p => p.status === "accepted");
              return (
                <>
                  <ValidationCheck ok={activeP.length > 0} label={`${alloc.label}: at least 1 participant`} />
                  <ValidationCheck ok={allAccepted} label={`${alloc.label}: all accepted`} />
                </>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}

function Avatar(props: { url: string; name: string }) {
  return props.url ? (
    <img src={sanitizeImageUrl(props.url)} alt={`${props.name} avatar`} class="w-8 h-8 rounded-lg object-cover" />
  ) : (
    <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
      style={{ background: "var(--surface-light)", color: "var(--gold)" }}>
      {props.name[0]?.toUpperCase() || "?"}
    </div>
  );
}

function ToggleSwitch(props: { checked: boolean; onChange: () => void }) {
  return (
    <button class="relative flex items-center h-7 rounded-full px-1 transition-colors shrink-0"
      style={{ width: "52px", background: props.checked ? "var(--gold)" : "var(--surface-light)" }}
      onClick={props.onChange} type="button">
      <div class="w-5 h-5 rounded-full transition-all"
        style={{ background: props.checked ? "var(--noir)" : "var(--cream-muted)", transform: props.checked ? "translateX(24px)" : "translateX(0)" }} />
    </button>
  );
}

function ValidationCheck(props: { ok: boolean; label: string }) {
  return (
    <div class="flex items-center gap-2 text-xs">
      <div class="w-2 h-2 rounded-full" style={{ background: props.ok ? "var(--emerald)" : "var(--accent)" }} />
      <span style={{ color: props.ok ? "var(--emerald)" : "var(--accent)" }}>{props.label}</span>
    </div>
  );
}
