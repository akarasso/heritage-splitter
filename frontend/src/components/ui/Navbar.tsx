import { Show, createSignal, createEffect, onCleanup } from "solid-js";
import { A } from "@solidjs/router";
import { useAuth } from "~/hooks/createAuth";
import { shortenAddress, sanitizeImageUrl } from "~/lib/utils";
import { LogoMark } from "./Logo";
import { api } from "~/lib/api-client";
import { useWebSocket } from "~/hooks/createWebSocket";

export default function Navbar() {
  const { user, wallet, isAuthenticated, isConnecting, connect, disconnect } = useAuth();
  const [unreadCount, setUnreadCount] = createSignal(0);
  const [menuOpen, setMenuOpen] = createSignal(false);

  // Fetch unread count when authenticated
  createEffect(() => {
    if (isAuthenticated()) {
      api.getUnreadCount().then(r => setUnreadCount(r.count)).catch(() => { console.warn("Failed to fetch unread count"); });
    }
  });

  // WebSocket updates unread count — only on notification-related events
  useWebSocket((msg) => {
    const notifKinds = ["notification", "dm_received", "invitation_received", "thread_created", "message_posted", "approval_requested"];
    if (isAuthenticated() && notifKinds.includes(msg.kind)) {
      api.getUnreadCount().then(r => setUnreadCount(r.count)).catch(() => { console.warn("Failed to fetch unread count"); });
    }
  });

  // Close dropdown on outside click
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest("[data-user-menu]")) {
      setMenuOpen(false);
    }
  }
  createEffect(() => {
    if (menuOpen()) {
      document.addEventListener("click", handleClickOutside, true);
    } else {
      document.removeEventListener("click", handleClickOutside, true);
    }
  });
  onCleanup(() => document.removeEventListener("click", handleClickOutside, true));

  const snowtraceUrl = () => {
    const addr = wallet() || user()?.wallet_address;
    if (!addr) return "";
    return `https://testnet.snowtrace.io/address/${addr}`;
  };

  return (
    <nav class="sticky top-0 z-50 backdrop-blur-xl" style={{ "background": "rgba(8,8,12,0.85)", "border-bottom": "1px solid var(--border)" }}>
      <div class="max-w-7xl mx-auto px-6 lg:px-8">
        <div class="flex items-center justify-between h-18 py-4">
          {/* Logo */}
          <A href="/" class="flex items-center gap-3 group">
            <LogoMark size={34} />
            <div class="flex items-baseline gap-1.5">
              <span class="text-lg font-display font-bold tracking-tight" style={{ color: "var(--cream)" }}>Heritage</span>
              <span class="hidden sm:inline text-lg font-display font-light italic tracking-tight" style={{ color: "var(--gold)" }}>Splitter</span>
            </div>
          </A>

          {/* Nav links */}
          <Show when={isAuthenticated()}>
            <div class="hidden md:flex items-center gap-1">
              {[
                ...(user()?.role !== "producer" ? [{ href: "/dashboard", label: "Projects" }] : []),
                { href: "/showroom", label: "Showroom" },
                ...(user()?.role !== "producer" ? [{ href: "/projects/new", label: "Create" }] : []),
                { href: "/docs", label: "Documentation" },
              ].map((link) => (
                <A
                  href={link.href}
                  class="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                  style={{ color: "var(--cream-muted)" }}
                  activeClass="!text-white"
                  inactiveClass="hover:text-white hover:bg-white/5"
                >
                  {link.label}
                </A>
              ))}
              <A
                href="/activity"
                class="relative px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{ color: "var(--cream-muted)" }}
                activeClass="!text-white"
                inactiveClass="hover:text-white hover:bg-white/5"
              >
                Activity
                <Show when={unreadCount() > 0}>
                  <span
                    class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: "var(--accent)", color: "white" }}
                  >
                    {unreadCount() > 99 ? "99+" : unreadCount()}
                  </span>
                </Show>
              </A>
            </div>
          </Show>

          {/* Right side */}
          <div class="flex items-center gap-3">
            <Show
              when={isAuthenticated()}
              fallback={
                <button class="btn-primary text-xs" onClick={connect} disabled={isConnecting()}>
                  {isConnecting() ? "Connecting..." : "Connect Wallet"}
                </button>
              }
            >
              {/* User dropdown */}
              <div class="relative" data-user-menu>
                <button
                  class="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-white/5"
                  onClick={() => setMenuOpen(!menuOpen())}
                >
                  {user()?.avatar_url ? (
                    <img src={sanitizeImageUrl(user()!.avatar_url)} alt="User avatar" class="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ "background": "var(--surface-light)", color: "var(--gold)" }}>
                      {user()?.display_name?.[0]?.toUpperCase() || "?"}
                    </div>
                  )}
                  <span class="text-sm font-medium hidden sm:inline" style={{ color: "var(--cream-muted)" }}>
                    {user()?.display_name || shortenAddress(user()?.wallet_address || "")}
                  </span>
                  <svg class="w-3.5 h-3.5 transition-transform" style={{ color: "var(--text-muted)", transform: menuOpen() ? "rotate(180deg)" : "rotate(0)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                <Show when={menuOpen()}>
                  <div
                    class="absolute right-0 mt-2 w-56 rounded-xl overflow-hidden z-50"
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", "box-shadow": "0 8px 32px rgba(0,0,0,0.5)" }}
                  >
                    {/* Wallet address */}
                    <div style={{ padding: "10px 16px", "border-bottom": "1px solid var(--border)" }}>
                      <p class="text-[10px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Wallet</p>
                      <p class="text-xs font-mono" style={{ color: "var(--cream-muted)", "word-break": "break-all" }}>
                        {wallet() || user()?.wallet_address || ""}
                      </p>
                    </div>

                    {/* Menu items */}
                    <div style={{ padding: "4px" }}>
                      <A
                        href="/profile/edit"
                        class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-white/5"
                        style={{ color: "var(--cream-muted)" }}
                        onClick={() => setMenuOpen(false)}
                      >
                        <svg class="w-4 h-4" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                        </svg>
                        Profile
                      </A>

                      <Show when={snowtraceUrl()}>
                        <a
                          href={snowtraceUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-white/5"
                          style={{ color: "var(--cream-muted)" }}
                          onClick={() => setMenuOpen(false)}
                        >
                          <svg class="w-4 h-4" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                          View on Snowtrace
                        </a>
                      </Show>
                    </div>

                    {/* Logout */}
                    <div style={{ padding: "4px", "border-top": "1px solid var(--border)" }}>
                      <button
                        class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-white/5 w-full text-left"
                        style={{ color: "var(--accent)" }}
                        onClick={() => { setMenuOpen(false); disconnect(); }}
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                        </svg>
                        Log out
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </nav>
  );
}
