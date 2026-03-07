import { createSignal } from "solid-js";

export type ModalVariant = "default" | "danger";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ModalVariant;
  onConfirm: () => void | Promise<void>;
}

export interface AlertOptions {
  title: string;
  message?: string;
  buttonLabel?: string;
}

type ModalState =
  | { type: "confirm"; options: ConfirmOptions }
  | { type: "alert"; options: AlertOptions }
  | null;

const [modal, setModal] = createSignal<ModalState>(null);

export { modal };

export function showConfirm(options: ConfirmOptions) {
  setModal({ type: "confirm", options });
}

export function showAlert(options: AlertOptions) {
  setModal({ type: "alert", options });
}

export function closeModal() {
  setModal(null);
}
