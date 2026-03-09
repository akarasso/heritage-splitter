import { createSignal, For, onCleanup } from "solid-js";

interface ToastItem {
  id: number;
  message: string;
  type: "error" | "success" | "info";
}

const [toasts, setToasts] = createSignal<ToastItem[]>([]);
let nextId = 0;

export function showToast(message: string, type: "error" | "success" | "info" = "error") {
  const id = nextId++;
  setToasts((prev) => [...prev, { id, message, type }]);
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, 5000);
}

export function ToastContainer() {
  return (
    <div style={{
      position: "fixed",
      top: "1rem",
      right: "1rem",
      "z-index": "10000",
      display: "flex",
      "flex-direction": "column",
      gap: "0.5rem",
      "max-width": "400px",
    }}>
      <For each={toasts()}>
        {(toast) => {
          const bg = toast.type === "error" ? "#dc2626" : toast.type === "success" ? "#16a34a" : "#2563eb";
          return (
            <div
              style={{
                background: bg,
                color: "white",
                padding: "0.75rem 1rem",
                "border-radius": "0.5rem",
                "box-shadow": "0 4px 12px rgba(0,0,0,0.3)",
                "font-size": "0.875rem",
                "line-height": "1.4",
                cursor: "pointer",
                animation: "fadeIn 0.2s ease-out",
              }}
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            >
              {toast.message}
            </div>
          );
        }}
      </For>
    </div>
  );
}
