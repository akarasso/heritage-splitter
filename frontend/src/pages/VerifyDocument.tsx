import { Show, createSignal } from "solid-js";
import { api } from "~/lib/api-client";
import type { VerifyDocumentResult } from "~/lib/api-client";
import { formatDate } from "~/lib/utils";

async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function VerifyDocument() {
  const [dragOver, setDragOver] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  const [fileName, setFileName] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<VerifyDocumentResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function verify(file: File) {
    setChecking(true);
    setResult(null);
    setError(null);
    setFileName(file.name);
    try {
      const hash = await computeSha256(file);
      const res = await api.verifyDocument(hash);
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) verify(file);
  }

  function onFileInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) verify(file);
  }

  return (
    <div class="gradient-bg noise-bg min-h-screen">
      <div class="relative z-10 max-w-2xl mx-auto px-6 py-16">
        {/* Header */}
        <div class="text-center mb-12">
          <div
            class="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" }}
          >
            <svg class="w-10 h-10" style={{ color: "var(--emerald)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
          </div>
          <h1 class="font-display text-4xl font-bold mb-2" style={{ color: "var(--cream)" }}>
            Verify <span class="italic" style={{ color: "var(--emerald)" }}>Document</span>
          </h1>
          <p class="text-sm" style={{ color: "var(--text-muted)" }}>
            Verify the authenticity of an on-chain certified document
          </p>
        </div>

        {/* Drop zone */}
        <div
          class="card transition-all cursor-pointer mb-8"
          style={{
            border: dragOver()
              ? "2px dashed var(--emerald)"
              : "2px dashed var(--border)",
            background: dragOver() ? "rgba(52,211,153,0.05)" : undefined,
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById("verify-file-input")?.click()}
        >
          <div class="flex flex-col items-center justify-center py-10 gap-3">
            <svg
              class="w-12 h-12"
              style={{ color: "var(--text-muted)" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
              />
            </svg>
            <p class="text-sm" style={{ color: "var(--cream-muted)" }}>
              {checking()
                ? "Verifying..."
                : "Drop a file here to verify its authenticity"}
            </p>
            <p class="text-xs" style={{ color: "var(--text-muted)" }}>
              The file is not uploaded — only its SHA-256 hash is computed
            </p>
          </div>
          <input
            id="verify-file-input"
            type="file"
            class="hidden"
            onChange={onFileInput}
          />
        </div>

        {/* Loading */}
        <Show when={checking()}>
          <div class="flex items-center justify-center gap-3 py-8">
            <div class="w-2 h-2 rounded-full animate-glow" style={{ background: "var(--accent)" }} />
            <span class="text-sm" style={{ color: "var(--text-muted)" }}>On-chain verification in progress...</span>
          </div>
        </Show>

        {/* Error */}
        <Show when={error()}>
          <div class="card" style={{ background: "rgba(255,59,63,0.05)", border: "1px solid rgba(255,59,63,0.3)" }}>
            <p class="text-sm" style={{ color: "var(--accent)" }}>Error: {error()}</p>
          </div>
        </Show>

        {/* Result — Certified */}
        <Show when={result() && result()!.certified}>
          <div class="space-y-6 animate-fade-in-up">
            <div class="card">
              <div class="flex items-center gap-3 mb-6">
                <div
                  class="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)" }}
                >
                  <svg class="w-6 h-6" style={{ color: "var(--emerald)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <div>
                  <h3 class="font-display text-xl font-bold" style={{ color: "var(--emerald)" }}>Document certified</h3>
                  <p class="text-sm" style={{ color: "var(--cream-muted)" }}>{fileName()}</p>
                </div>
              </div>

              <div class="space-y-3">
                <Show when={result()!.certified_at}>
                  <div class="flex items-center justify-between py-2" style={{ "border-bottom": "1px solid var(--border)" }}>
                    <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Certified on</span>
                    <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>
                      {formatDate(result()!.certified_at!)}
                    </span>
                  </div>
                </Show>
                <Show when={!result()!.certified_at && result()!.timestamp > 0}>
                  <div class="flex items-center justify-between py-2" style={{ "border-bottom": "1px solid var(--border)" }}>
                    <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Certified on</span>
                    <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>
                      {formatDate(new Date(result()!.timestamp * 1000).toISOString())}
                    </span>
                  </div>
                </Show>
                <Show when={result()!.tx_hash}>
                  <div class="flex items-center justify-between py-2" style={{ "border-bottom": "1px solid var(--border)" }}>
                    <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Transaction</span>
                    <a
                      href={`https://testnet.snowtrace.io/tx/${result()!.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-sm font-mono hover:opacity-80 transition-opacity"
                      style={{ color: "var(--emerald)" }}
                    >
                      {result()!.tx_hash!.slice(0, 10)}...{result()!.tx_hash!.slice(-6)}
                    </a>
                  </div>
                </Show>
                <Show when={result()!.document_name}>
                  <div class="flex items-center justify-between py-2" style={{ "border-bottom": "1px solid var(--border)" }}>
                    <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Original name</span>
                    <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>{result()!.document_name}</span>
                  </div>
                </Show>
                <div class="flex items-center justify-between py-2">
                  <span class="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Registry</span>
                  {(() => {
                    const registryAddr = import.meta.env.VITE_DOCUMENT_REGISTRY_ADDRESS;
                    return (
                      <a
                        href={`https://testnet.snowtrace.io/address/${registryAddr}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-sm font-mono hover:opacity-80 transition-opacity"
                        style={{ color: "var(--cream-muted)" }}
                      >
                        {registryAddr.slice(0, 6)}...{registryAddr.slice(-3)}
                      </a>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* Result — Not certified */}
        <Show when={result() && !result()!.certified}>
          <div class="card animate-fade-in-up">
            <div class="flex items-center gap-3">
              <div
                class="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(255,59,63,0.1)", border: "1px solid rgba(255,59,63,0.3)" }}
              >
                <svg class="w-6 h-6" style={{ color: "var(--accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <h3 class="font-display text-xl font-bold" style={{ color: "var(--accent)" }}>Document not certified</h3>
                <p class="text-sm" style={{ color: "var(--cream-muted)" }}>
                  This document is not registered on the blockchain.
                </p>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
