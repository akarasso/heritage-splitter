import { createSignal } from "solid-js";
import { api } from "~/lib/api-client";
import { onboard } from "~/config/wallet";
import { disconnectWebSocket } from "~/hooks/createWebSocket";
import type { User } from "~/lib/api-client";

const [wallet, setWallet] = createSignal<string | null>(null);
const [user, setUser] = createSignal<User | null>(null);
const [isConnecting, setIsConnecting] = createSignal(false);
const [isAuthenticated, setIsAuthenticated] = createSignal(false);
const [isLoading, setIsLoading] = createSignal(true);

// Try restoring session on load — cookie or localStorage token
// With HttpOnly cookies, the session cookie is sent automatically via credentials: "include".
// We still check localStorage token as fallback for non-cookie environments.
{
  const hasLocalToken = !!api.getToken();
  // Always attempt getMe(): even without a localStorage token, the HttpOnly cookie may be present
  api.getMe().then(async (u) => {
    setUser(u);
    setIsAuthenticated(true);
    // Silently reconnect wallet so it's available for signing
    try {
      const wallets = await onboard.connectWallet({
        autoSelect: { label: "MetaMask", disableModals: true },
      });
      if (wallets.length > 0) {
        setWallet(wallets[0].accounts[0].address.toLowerCase());
      }
    } catch {
      // Wallet reconnect failed silently — user can reconnect manually
    }
  }).catch((err) => {
    // Only clear token on auth errors (401), not on network failures
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("expired")) {
      api.clearToken();
    }
    // Network errors: keep token, user can retry after connectivity is restored
  }).finally(() => {
    setIsLoading(false);
  });
}

function isProfileComplete(): boolean {
  const u = user();
  if (!u) return false;
  return !!(u.display_name && u.avatar_url && u.bio);
}

export function useAuth() {
  async function connect() {
    setIsConnecting(true);
    try {
      const wallets = await onboard.connectWallet();
      if (wallets.length === 0) return;

      const address = wallets[0].accounts[0].address.toLowerCase();
      setWallet(address);

      // Get nonce
      const { nonce } = await api.getNonce(address);

      // Sign message
      const provider = wallets[0].provider;
      const message = `Heritage Splitter Authentication\n\nWallet: ${address}\nNonce: ${nonce}`;
      const signature = await provider.request({
        method: "personal_sign",
        params: [message, address],
      }) as string;

      // Verify & get JWT
      const { token, user_exists } = await api.verify(address, signature, message);
      api.setToken(token);
      setIsAuthenticated(true);

      // Fetch user profile
      const userData = await api.getMe();
      setUser(userData);

      return { user_exists };
    } catch (err) {
      if (import.meta.env.DEV) console.error("Auth failed:", err instanceof Error ? err.message : "Unknown error");
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }

  async function disconnect() {
    disconnectWebSocket();
    onboard.disconnectWallet({ label: "MetaMask" }).catch(() => {});
    // Clear HttpOnly session cookie server-side, then clear localStorage fallback
    await api.logout().catch(() => {});
    setWallet(null);
    setUser(null);
    setIsAuthenticated(false);
  }

  async function refreshUser() {
    try {
      const userData = await api.getMe();
      setUser(userData);
    } catch {
      disconnect();
    }
  }

  return {
    wallet,
    user,
    isConnecting,
    isAuthenticated,
    isLoading,
    isProfileComplete,
    connect,
    disconnect,
    refreshUser,
  };
}
