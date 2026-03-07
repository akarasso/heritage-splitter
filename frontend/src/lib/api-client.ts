const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const REQUEST_TIMEOUT_MS = 30_000;

class ApiClient {
  private token: string | null = null;
  private inflightMutations = new Map<string, Promise<any>>();

  // Dedup key intentionally includes the full body string. If two requests have
  // different timestamps in their body, they are considered distinct requests and
  // will NOT be deduplicated — this is by design since the payloads differ.
  private dedupKey(method: string, path: string, body?: string): string {
    return `${method}:${path}:${body || ""}`;
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem("heritage_token", token);
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem("heritage_token");
    }
    return this.token;
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem("heritage_token");
  }

  private async executeRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(options.headers as Record<string, string>),
    };

    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: "include",
        signal: controller.signal,
      });

      if (!res.ok) {
        // Only log status code to avoid leaking sensitive data from response body
        console.warn("API error:", res.status);
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || res.statusText || `Request failed (${res.status})`);
      }

      return res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = (options.method || "GET").toUpperCase();

    // GET/HEAD pass through directly — no dedup needed
    if (method === "GET" || method === "HEAD") {
      return this.executeRequest<T>(path, options);
    }

    // Mutations: deduplicate identical in-flight requests
    const key = this.dedupKey(method, path, options.body as string | undefined);
    const inflight = this.inflightMutations.get(key);
    if (inflight) return inflight as Promise<T>;

    const promise = this.executeRequest<T>(path, options).finally(() => {
      this.inflightMutations.delete(key);
    });
    this.inflightMutations.set(key, promise);
    return promise;
  }

  // Auth
  private validateWalletAddress(wallet: string): void {
    if (!wallet.match(/^0x[0-9a-fA-F]{40}$/)) throw new Error("Invalid wallet address");
  }

  async getNonce(walletAddress: string) {
    this.validateWalletAddress(walletAddress);
    return this.request<{ nonce: string }>("/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ wallet_address: walletAddress }),
    });
  }

  async verify(walletAddress: string, signature: string, message: string) {
    this.validateWalletAddress(walletAddress);
    return this.request<{ token: string; user_exists: boolean }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ wallet_address: walletAddress, signature, message }),
    });
  }

  async logout() {
    await this.request<void>("/auth/logout", { method: "POST" });
    this.clearToken();
  }

  // Users
  async getMe() {
    return this.request<User>("/me");
  }

  async updateMe(data: Partial<User>) {
    return this.request<User>("/me", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async listUsers() {
    return this.request<PublicUser[]>("/users");
  }

  async searchUsers(query: string, role?: string) {
    const params = new URLSearchParams({ q: query });
    if (role) params.set("role", role);
    return this.request<PublicUser[]>(`/users?${params.toString()}`);
  }

  // Projects
  async createProject(data: { name: string; description?: string; royalty_bps?: number; logo_url?: string }) {
    return this.request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async listMyProjects() {
    return this.request<Project[]>("/projects");
  }

  async getProject(id: string) {
    return this.request<ProjectDetail>(`/projects/${id}`);
  }

  async updateProject(id: string, data: Partial<Project>) {
    return this.request<Project>(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async closeProject(id: string) {
    return this.request<Project>(`/projects/${id}/close`, { method: "POST" });
  }

  async reopenProject(id: string) {
    return this.request<Project>(`/projects/${id}/reopen`, { method: "POST" });
  }

  // Allocations
  async createAllocation(projectId: string, data: CreateAllocationInput) {
    return this.request<Allocation>(`/projects/${projectId}/allocations`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateAllocation(allocationId: string, data: Partial<CreateAllocationInput>) {
    return this.request<Allocation>(`/allocations/${allocationId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteAllocation(allocationId: string) {
    return this.request<{ deleted: boolean }>(`/allocations/${allocationId}`, {
      method: "DELETE",
    });
  }

  // Participants
  async addParticipant(projectId: string, data: { wallet_address?: string; user_id?: string; role: string; shares_bps: number; allocation_id?: string }) {
    return this.request<Participant>(`/projects/${projectId}/participants`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async acceptInvitation(participantId: string) {
    return this.request<Participant>(`/participants/${participantId}/accept`, { method: "PUT" });
  }

  async rejectInvitation(participantId: string) {
    return this.request<Participant>(`/participants/${participantId}/reject`, { method: "PUT" });
  }

  // Threads & Messages
  async listThreads(projectId: string, workId?: string) {
    const params = workId ? `?work_id=${encodeURIComponent(workId)}` : "";
    return this.request<ThreadDetail[]>(`/projects/${projectId}/threads${params}`);
  }

  async createThread(projectId: string, data: { title: string; content: string; work_id?: string }) {
    return this.request<ThreadDetail>(`/projects/${projectId}/threads`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async resolveThread(threadId: string, conclusion: string) {
    return this.request<ThreadDetail>(`/threads/${threadId}/resolve`, {
      method: "PUT",
      body: JSON.stringify({ conclusion }),
    });
  }

  async reopenThread(threadId: string) {
    return this.request<ThreadDetail>(`/threads/${threadId}/reopen`, {
      method: "PUT",
    });
  }

  async listMessages(threadId: string, since?: string) {
    const params = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request<MessageDetail[]>(`/threads/${threadId}/messages${params}`);
  }

  async createMessage(threadId: string, content: string) {
    return this.request<MessageDetail>(`/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  // Notifications
  async listNotifications(unread?: boolean) {
    const params = unread ? "?unread=true" : "";
    return this.request<Notification[]>(`/notifications${params}`);
  }

  async getUnreadCount() {
    return this.request<{ count: number }>("/notifications/unread-count");
  }

  async markNotificationRead(id: string) {
    return this.request<Notification>(`/notifications/${id}/read`, { method: "PUT" });
  }

  async markAllNotificationsRead() {
    return this.request<{ success: boolean }>("/notifications/read-all", { method: "PUT" });
  }

  async getProjectActivity(projectId: string) {
    return this.request<ActivityItem[]>(`/projects/${projectId}/activity`);
  }

  // Direct messages
  async listConversations() {
    return this.request<Conversation[]>("/dm/conversations");
  }

  async getConversation(userId: string, before?: string, limit?: number): Promise<{ messages: DirectMessageDetail[]; has_more: boolean }> {
    const params = new URLSearchParams();
    if (before) params.set("before", before);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return this.request(`/dm/${userId}${qs ? `?${qs}` : ""}`);
  }

  async sendDirectMessage(userId: string, content: string) {
    return this.request<DirectMessageDetail>(`/dm/${userId}`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  // Update participant
  async updateParticipant(participantId: string, body: { role?: string; shares_bps?: number }) {
    return this.request<Participant>(`/participants/${participantId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // Kick participant
  async kickParticipant(participantId: string) {
    return this.request<Participant>(`/participants/${participantId}/kick`, { method: "PUT" });
  }

  // AI
  async aiGenerate(prompt: string, maxTokens?: number) {
    return this.request<{ text: string }>("/ai/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, max_tokens: maxTokens }),
    });
  }

  async aiGenerateImage(prompt: string, size?: string) {
    return this.request<{ image_base64: string }>("/ai/generate-image", {
      method: "POST",
      body: JSON.stringify({ prompt, size }),
    });
  }

  // Documents
  async uploadDocument(projectId: string, file: File) {
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    const ALLOWED_TYPES = [
      "application/pdf", "image/png", "image/jpeg", "image/webp",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain", "application/json",
    ];
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
    }
    if (!file.type || !ALLOWED_TYPES.includes(file.type)) {
      throw new Error(`File type "${file.type || "(empty)"}" is not allowed`);
    }

    // Deduplicate identical in-flight uploads
    const key = this.dedupKey("UPLOAD", projectId, file.name);
    const inflight = this.inflightMutations.get(key);
    if (inflight) return inflight as Promise<DocumentInfo>;

    const promise = (async (): Promise<DocumentInfo> => {
      const formData = new FormData();
      formData.append("file", file);

      const token = this.getToken();
      const headers: Record<string, string> = { "X-Requested-With": "XMLHttpRequest" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);

      try {
        const res = await fetch(`${API_BASE}/projects/${projectId}/documents`, {
          method: "POST",
          headers,
          credentials: "include",
          body: formData,
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || res.statusText || `Request failed (${res.status})`);
        }

        return res.json() as Promise<DocumentInfo>;
      } finally {
        clearTimeout(timeoutId);
      }
    })().finally(() => {
      this.inflightMutations.delete(key);
    });

    this.inflightMutations.set(key, promise);
    return promise;
  }

  async listDocuments(projectId: string) {
    return this.request<DocumentInfo[]>(`/projects/${projectId}/documents`);
  }

  async downloadDocument(docId: string): Promise<Blob> {
    const token = this.getToken();
    const headers: Record<string, string> = { "X-Requested-With": "XMLHttpRequest" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE}/documents/${docId}/download`, {
        headers,
        credentials: "include",
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || res.statusText || `Request failed (${res.status})`);
      }

      return res.blob();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async certifyDocument(docId: string, data?: { signature: string; deadline: number }) {
    return this.request<DocumentInfo>(`/documents/${docId}/certify`, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async getCertifierNonce(wallet: string) {
    return this.request<{ nonce: number }>(`/documents/nonce/${wallet}`);
  }

  async shareDocument(docId: string, userIds: string[]) {
    return this.request<DocumentAccess[]>(`/documents/${docId}/share`, {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    });
  }

  async verifyDocument(sha256Hash: string) {
    return this.request<VerifyDocumentResult>(`/public/verify-document/${sha256Hash}`);
  }

  // Works
  async createWork(projectId: string, data: { name: string; description?: string; work_type?: string; royalty_bps?: number }) {
    return this.request<Work>(`/projects/${projectId}/works`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async listWorks(projectId: string) {
    return this.request<Work[]>(`/projects/${projectId}/works`);
  }

  async getWork(workId: string) {
    return this.request<WorkDetail>(`/works/${workId}`);
  }

  async updateWork(workId: string, data: Partial<{ name: string; description: string; royalty_bps: number }>) {
    return this.request<Work>(`/works/${workId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async submitWorkForApproval(workId: string) {
    return this.request<Work>(`/works/${workId}/submit-for-approval`, { method: "POST" });
  }

  async validateApproval(workId: string) {
    return this.request<Work>(`/works/${workId}/validate-approval`, { method: "POST" });
  }

  async deployWork(workId: string) {
    return this.request<Work>(`/works/${workId}/deploy`, { method: "POST" });
  }

  async createWorkAllocation(workId: string, data: CreateAllocationInput) {
    return this.request<Allocation>(`/works/${workId}/allocations`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async mintWorkNft(workId: string, data: { title: string; metadata_uri: string }) {
    return this.request<Nft>(`/works/${workId}/mint`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Draft NFTs
  async createDraftNft(workId: string, data: CreateDraftNft) {
    return this.request<DraftNft>(`/works/${workId}/draft-nfts`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDraftNft(id: string, data: UpdateDraftNft) {
    return this.request<DraftNft>(`/draft-nfts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteDraftNft(id: string) {
    return this.request<{ deleted: boolean }>(`/draft-nfts/${id}`, {
      method: "DELETE",
    });
  }

  async submitForMintApproval(workId: string) {
    return this.request<Work>(`/works/${workId}/submit-for-mint-approval`, { method: "POST" });
  }

  async publishWork(workId: string) {
    return this.request<Work>(`/works/${workId}/publish`, { method: "POST" });
  }

  async unpublishWork(workId: string) {
    return this.request<Work>(`/works/${workId}/unpublish`, { method: "POST" });
  }

  // Public
  async verifyNft(contract: string, tokenId: number) {
    return this.request<{ nft: Nft; project: Project; participants: Participant[] }>(
      `/public/verify/${contract}/${tokenId}`
    );
  }

  async getWorkHistory(workId: string) {
    return this.request<WorkHistory>(`/public/works/${workId}/history`);
  }

  async getPublicCollection(slug: string): Promise<PublicCollection> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/public/collections/${slug}`, { credentials: "include", signal: controller.signal });
      if (!res.ok) throw new Error('Collection not found');
      return res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Types
export interface User {
  id: string;
  wallet_address: string;
  display_name: string;
  role: string;
  bio: string;
  avatar_url: string;
  artist_number: string;
  created_at: string;
}

/** Public user — wallet_address not exposed */
export interface PublicUser {
  id: string;
  display_name: string;
  role: string;
  bio: string;
  avatar_url: string;
  artist_number: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  creator_id: string;
  royalty_bps: number;
  contract_nft_address: string | null;
  contract_splitter_address: string | null;
  logo_url: string;
  max_participants: number | null;
  completed_at: string | null;
  created_at: string;
}

export interface Allocation {
  id: string;
  project_id: string;
  role: string;
  label: string;
  total_bps: number;
  max_slots: number | null;
  distribution_mode: string;
  sort_order: number;
  receives_primary: boolean;
  created_at: string;
}

export interface AllocationDetail extends Allocation {
  participants: Participant[];
  filled_slots: number;
  open_slots: number | null;
}

export interface CreateAllocationInput {
  role?: string;
  label: string;
  total_bps: number;
  max_slots?: number | null;
  distribution_mode?: string;
  sort_order?: number;
  receives_primary?: boolean;
}

export interface ProjectDetail extends Project {
  participants: Participant[];
  allocations: AllocationDetail[];
  creator_shares_bps: number;
}

export interface Participant {
  id: string;
  project_id: string;
  user_id: string | null;
  wallet_address: string;
  role: string;
  shares_bps: number;
  status: string;
  allocation_id: string | null;
  invited_at: string;
  accepted_at: string | null;
  approved_at: string | null;
}

export interface ThreadDetail {
  id: string;
  project_id: string;
  author_id: string;
  title: string;
  status: string;
  conclusion: string | null;
  concluded_by: string | null;
  work_id: string | null;
  created_at: string;
  author_name: string;
  author_avatar: string;
  concluded_by_name: string | null;
  message_count: number;
}

export interface MessageDetail {
  id: string;
  project_id: string;
  thread_id: string;
  user_id: string;
  content: string;
  created_at: string;
  display_name: string;
  avatar_url: string;
}

export interface Work {
  id: string;
  project_id: string;
  name: string;
  description: string;
  work_type: string;
  status: string;
  royalty_bps: number;
  contract_nft_address: string | null;
  contract_splitter_address: string | null;
  contract_vault_address?: string | null;
  public_slug?: string | null;
  is_public?: boolean;
  completed_at: string | null;
  created_at: string;
}

export interface WorkDetail extends Work {
  allocations: AllocationDetail[];
  nfts: Nft[];
  draft_nfts: DraftNft[];
  creator_shares_bps: number;
}

export interface Nft {
  id: string;
  project_id: string;
  token_id: number;
  metadata_uri: string;
  title: string;
  artist_name: string;
  description: string;
  image_url: string;
  price: string;
  attributes: string;
  phase: string;
  minted_at: string;
}

export interface DraftNft {
  id: string;
  work_id: string;
  title: string;
  description: string;
  artist_name: string;
  price: string;
  image_url: string;
  metadata_uri: string;
  attributes: string;
  created_at: string;
}

export interface CreateDraftNft {
  title: string;
  description?: string;
  artist_name?: string;
  price?: string;
  image_url?: string;
  metadata_uri?: string;
  attributes?: string;
}

export interface UpdateDraftNft {
  title?: string;
  description?: string;
  artist_name?: string;
  price?: string;
  image_url?: string;
  metadata_uri?: string;
  attributes?: string;
}

export interface Notification {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  project_id: string | null;
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface ActivityItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface DirectMessageDetail {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  sender_name: string;
  sender_avatar: string;
}

export interface Conversation {
  user_id: string;
  display_name: string;
  avatar_url: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
}

export interface DocumentInfo {
  id: string;
  project_id: string;
  uploader_id: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  sha256_hash: string;
  tx_hash: string | null;
  certified_at: string | null;
  certified_by: string | null;
  original_project_id?: string | null;
  original_project_name?: string | null;
  original_certified_by?: string | null;
  created_at: string;
}

export interface DocumentAccess {
  id: string;
  document_id: string;
  user_id: string;
  granted_by: string;
  granted_at: string;
}

export interface VerifyDocumentResult {
  certified: boolean;
  timestamp: number;
  tx_hash: string | null;
  document_name: string | null;
  certified_at: string | null;
}

export interface TokenTransferEvent {
  from: string;
  to: string;
  token_id: number;
  block_number: number;
  tx_hash: string;
}

export interface PurchaseEvent {
  token_id: number;
  buyer: string;
  price_wei: string;
  block_number: number;
  tx_hash: string;
}

export interface PaymentEvent {
  beneficiary: string;
  amount_wei: string;
  block_number: number;
  tx_hash: string;
}

export interface WorkHistory {
  transfers: TokenTransferEvent[];
  purchases: PurchaseEvent[];
  payments: PaymentEvent[];
  total_revenue_wei: string;
}

export interface PublicNft {
  token_id: number;
  title: string;
  description: string;
  image_url: string;
  price: string;
  attributes: string;
  metadata_uri: string;
}

export interface PublicBeneficiary {
  wallet: string;
  role: string;
  label: string;
  shares_bps: number;
}

export interface PublicCollection {
  name: string;
  description: string;
  work_type: string;
  contract_nft_address: string | null;
  contract_splitter_address: string | null;
  contract_vault_address: string | null;
  nfts: PublicNft[];
  total_nft_count: number;
  beneficiaries: PublicBeneficiary[];
}

export const api = new ApiClient();
