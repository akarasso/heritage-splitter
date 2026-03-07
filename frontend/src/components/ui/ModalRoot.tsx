import { Show, onCleanup, createEffect, createSignal } from "solid-js";
import { modal, closeModal } from "~/lib/modal-store";

export default function ModalRoot() {
  const [loading, setLoading] = createSignal(false);
  let dialogRef: HTMLDivElement | undefined;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && !loading()) {
      closeModal();
      return;
    }
    // Focus trap: cycle Tab within modal
    if (e.key === "Tab" && dialogRef) {
      const focusable = dialogRef.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  }

  createEffect(() => {
    if (modal()) {
      // Remove before adding to prevent duplicate listeners on re-execution
      document.removeEventListener("keydown", onKeyDown);
      document.addEventListener("keydown", onKeyDown);
      setLoading(false);
      // Auto-focus first button in modal
      requestAnimationFrame(() => {
        dialogRef?.querySelector<HTMLElement>("button")?.focus();
      });
    } else {
      document.removeEventListener("keydown", onKeyDown);
    }
  });

  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  const m = () => modal();

  const title = () => {
    const s = m();
    if (!s) return "";
    return s.options.title;
  };

  const message = () => {
    const s = m();
    if (!s) return "";
    return s.options.message || "";
  };

  const isConfirm = () => m()?.type === "confirm";
  const isDanger = () => {
    const s = m();
    return s?.type === "confirm" && s.options.variant === "danger";
  };

  const confirmLabel = () => {
    const s = m();
    if (s?.type === "confirm") return s.options.confirmLabel || "Confirm";
    return "";
  };

  const cancelLabel = () => {
    const s = m();
    if (s?.type === "confirm") return s.options.cancelLabel || "Cancel";
    return "";
  };

  const alertButtonLabel = () => {
    const s = m();
    if (s?.type === "alert") return s.options.buttonLabel || "OK";
    return "OK";
  };

  async function handleConfirm() {
    const s = m();
    if (s?.type === "confirm") {
      setLoading(true);
      try {
        await s.options.onConfirm();
      } catch (err) {
        console.error("Modal confirm error:", err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
        return; // Don't close modal on error
      }
      setLoading(false);
    }
    closeModal();
  }

  return (
    <Show when={m()}>
      {/* Overlay */}
      <div
        class="fixed inset-0 z-50 flex items-center justify-center animate-modal-overlay"
        style={{ background: "rgba(8,8,12,0.7)", "backdrop-filter": "blur(4px)" }}
        onClick={(e) => { if (e.target === e.currentTarget && !loading()) closeModal(); }}
      >
        {/* Card */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={title()}
          class="animate-modal-card w-full max-w-md mx-4 rounded-2xl overflow-hidden"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            "box-shadow": "0 24px 80px rgba(0,0,0,0.6), 0 0 40px var(--gold-glow)",
          }}
        >
          {/* Gold top border */}
          <div style={{ height: "3px", background: "linear-gradient(90deg, var(--gold), #c49340, var(--gold))" }} />

          <div class="p-6 space-y-4">
            {/* Title */}
            <h3 class="text-sm font-medium tracking-widest uppercase" style={{ color: "var(--cream)" }}>
              <span style={{ color: "var(--gold)" }}>.</span> {title()}
            </h3>

            {/* Message */}
            <Show when={message()}>
              <p class="text-sm leading-relaxed" style={{ color: "var(--cream-muted)" }}>
                {message()}
              </p>
            </Show>

            {/* Buttons */}
            <div class="flex justify-end gap-3 pt-2">
              <Show when={isConfirm()} fallback={
                <button class="btn-gold text-xs" onClick={() => closeModal()}>
                  {alertButtonLabel()}
                </button>
              }>
                <button class="btn-secondary text-xs" onClick={() => closeModal()} disabled={loading()}>
                  {cancelLabel()}
                </button>
                <button
                  class={isDanger() ? "btn-primary text-xs" : "btn-gold text-xs"}
                  style={{ display: "flex", "align-items": "center", gap: "6px" }}
                  onClick={handleConfirm}
                  disabled={loading()}
                >
                  <Show when={loading()}>
                    <span
                      class="inline-block w-3.5 h-3.5 rounded-full border-2 animate-spin"
                      style={{ "border-color": "transparent", "border-top-color": "currentColor" }}
                    />
                  </Show>
                  {loading() ? "Processing..." : confirmLabel()}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
