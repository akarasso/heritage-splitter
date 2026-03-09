import { Show, createResource, createSignal, createEffect } from "solid-js";
import { A } from "@solidjs/router";
import { useAuth } from "~/hooks/createAuth";
import { shortenAddress, sanitizeImageUrl } from "~/lib/utils";
import { LogoMark } from "./Logo";
import { api } from "~/lib/api-client";
import { useWebSocket } from "~/hooks/createWebSocket";

export default function Navbar() {
  const { user, isAuthenticated, isConnecting, connect, disconnect } = useAuth();
  const [unreadCount, setUnreadCount] = createSignal(0);

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
                { href: "/docs", label: "Docs" },
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
              <A href="/profile/edit" class="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-white/5">
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
              </A>
              <button
                class="text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
                onClick={disconnect}
              >
                Log out
              </button>
            </Show>
          </div>
        </div>
      </div>
    </nav>
  );
}
