import { type RouteSectionProps, useLocation, useNavigate } from "@solidjs/router";
import { createEffect, ErrorBoundary, Show } from "solid-js";
import Navbar from "~/components/ui/Navbar";
import ModalRoot from "~/components/ui/ModalRoot";
import { ToastContainer } from "~/components/ui/Toast";
import { useAuth } from "~/hooks/createAuth";
import { isPublicDomain, getMainAppUrl } from "~/lib/domains";

const PUBLIC_PATHS = ["/", "/onboarding", "/verify"];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return true;
  if (path.startsWith("/verify/")) return true;
  if (path.startsWith("/sale/")) return true;
  if (path.startsWith("/showroom/sale/")) return true;
  return false;
}

export default function App(props: RouteSectionProps) {
  const { isAuthenticated, isLoading, isProfileComplete } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  createEffect(() => {
    if (isLoading()) return;

    const path = location.pathname;

    // On public domain, only allow /sale/* pages — redirect everything else to main domain
    if (isPublicDomain()) {
      if (!path.startsWith("/sale/")) {
        window.location.href = getMainAppUrl(path);
      }
      return;
    }

    if (!isAuthenticated()) {
      // Not authenticated — only allow public pages
      if (!isPublicPath(path)) {
        navigate("/", { replace: true });
      }
      return;
    }

    // Authenticated but profile incomplete — force onboarding
    if (!isProfileComplete()) {
      if (path !== "/onboarding") {
        navigate("/onboarding", { replace: true });
      }
      return;
    }

    // Authenticated + complete profile — redirect away from landing/onboarding
    if (path === "/" || path === "/onboarding") {
      navigate("/dashboard", { replace: true });
    }
  });

  const isSalePage = () => location.pathname.startsWith("/sale/") || location.pathname.startsWith("/showroom/sale/");

  return (
    <Show when={!isLoading()} fallback={
      <div class="min-h-screen gradient-bg flex items-center justify-center">
        <div class="flex items-center gap-3">
          <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--gold)" }} />
          <span class="text-sm" style={{ color: "var(--cream-muted)" }}>Chargement...</span>
        </div>
      </div>
    }>
      <ErrorBoundary fallback={(err, reset) => (
        <div class="min-h-screen gradient-bg flex items-center justify-center">
          <div class="card max-w-md text-center space-y-4">
            <div class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(255,59,63,0.1)", border: "1px solid rgba(255,59,63,0.2)" }}>
              <svg class="w-8 h-8" style={{ color: "var(--accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126Z" />
              </svg>
            </div>
            <h2 class="text-lg font-bold" style={{ color: "var(--cream)" }}>Something went wrong</h2>
            <p class="text-sm" style={{ color: "var(--text-muted)" }}>{(() => { if (import.meta.env.DEV) console.error("ErrorBoundary:", err); return "An unexpected error occurred."; })()}</p>
            <button class="btn-gold" onClick={reset}>Try again</button>
          </div>
        </div>
      )}>
        <Show when={!isSalePage()} fallback={props.children}>
          <div class="min-h-screen gradient-bg">
            <Navbar />
            <div class="animate-fade-in-scale" style={{ "animation-duration": "0.4s" }}>
              {props.children}
            </div>
            <ModalRoot />
            <ToastContainer />
          </div>
        </Show>
      </ErrorBoundary>
    </Show>
  );
}
