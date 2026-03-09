import { createSignal, Show, onMount, onCleanup, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { api } from "~/lib/api-client";
import { useAuth } from "~/hooks/createAuth";
import { shortenAddress, typeText, generateAvatar, sanitizeImageUrl } from "~/lib/utils";
import { showToast } from "~/components/ui/Toast";
import flatpickr from "flatpickr";
import "flatpickr/dist/flatpickr.min.css";

const RANDOM_BIOS = [
  "Passionate about contemporary art and new forms of digital expression.",
  "Multidisciplinary artist, bridging tradition and technological innovation.",
  "Creator and collector, driven by blockchain transparency.",
  "Art world professional, committed to better artwork traceability.",
  "Art enthusiast and entrepreneur, at the crossroads of culture and Web3.",
  "Specialist in artistic production, always seeking new talents.",
  "Independent curator, passionate about limited editions and generative art.",
  "Gallery owner and producer, helping artists maximize the value of their work.",
];

const RANDOM_NAMES = [
  "Claire Beaumont", "Thomas Lefebvre", "Isabelle Morel", "Antoine Garnier",
  "Camille Rousseau", "Julien Marchand", "Elise Fontaine", "Nicolas Berger",
  "Sophie Lambert", "Mathieu Chevalier", "Aurelie Dupuis", "Romain Blanchard",
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function randomDate(): string {
  const y = 1960 + Math.floor(Math.random() * 35);
  const m = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const d = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function randomDocNumber(): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function randomArtistNumber(): string {
  const prefix = ["MDA", "SIR", "AGS", "BNA"][Math.floor(Math.random() * 4)];
  let digits = "";
  for (let i = 0; i < 8; i++) digits += Math.floor(Math.random() * 10);
  return `${prefix}-${digits}`;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { wallet, refreshUser } = useAuth();

  const [step, setStep] = createSignal(1);
  // Step 1: Role
  const [role, setRole] = createSignal<"artist" | "producer" | null>(null);
  // Step 2: KYC
  const [legalName, setLegalName] = createSignal("");
  const [birthDate, setBirthDate] = createSignal("");
  const [documentNumber, setDocumentNumber] = createSignal("");
  const [artistNumber, setArtistNumber] = createSignal("");
  const [kycVerifying, setKycVerifying] = createSignal(false);
  const [kycVerified, setKycVerified] = createSignal(false);
  const [demoRunning, setDemoRunning] = createSignal(false);
  // Step 3: Profile
  const [displayName, setDisplayName] = createSignal("");
  const [bio, setBio] = createSignal("");
  const [avatarUrl, setAvatarUrl] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  let kycMounted = true;
  let kycTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let dateInputRef: HTMLInputElement | undefined;
  let fpInstance: flatpickr.Instance | undefined;
  onCleanup(() => {
    kycMounted = false;
    if (kycTimeoutId) clearTimeout(kycTimeoutId);
    if (fpInstance) fpInstance.destroy();
  });

  // Init flatpickr when step 2 is shown
  createEffect(() => {
    if (step() === 2 && dateInputRef && !fpInstance) {
      fpInstance = flatpickr(dateInputRef, {
        dateFormat: "Y-m-d",
        maxDate: "today",
        defaultDate: birthDate() || undefined,
        onChange: (_dates, dateStr) => setBirthDate(dateStr),
      });
    }
  });

  // Sync programmatic changes (demo auto-fill) to flatpickr
  createEffect(() => {
    const d = birthDate();
    if (fpInstance && d) {
      fpInstance.setDate(d, false);
    }
  });

  // Auto-pilot demo: type all KYC fields then submit
  async function runDemo() {
    if (demoRunning()) return;
    setDemoRunning(true);
    setLegalName(""); setBirthDate(""); setDocumentNumber(""); setArtistNumber("");

    const name = pick(RANDOM_NAMES);
    const date = randomDate();
    const doc = randomDocNumber();

    await typeText(name, setLegalName, 50);
    await new Promise((r) => setTimeout(r, 300));
    setBirthDate(date);
    await new Promise((r) => setTimeout(r, 400));
    await typeText(doc, setDocumentNumber, 40);

    if (role() === "artist") {
      await new Promise((r) => setTimeout(r, 300));
      await typeText(randomArtistNumber(), setArtistNumber, 40);
    }

    setDemoRunning(false);
  }

  function handleKycSubmit() {
    if (!legalName().trim() || !birthDate() || !documentNumber().trim()) return;
    if (role() === "artist" && !artistNumber().trim()) return;
    setKycVerifying(true);

    const avatar = generateAvatar(legalName().trim());

    kycTimeoutId = setTimeout(async () => {
      if (!kycMounted) return;
      const generatedBio = pick(RANDOM_BIOS);
      if (!kycMounted) return;
      setKycVerifying(false);
      setKycVerified(true);
      setDisplayName(legalName().trim());
      setBio(generatedBio);
      setAvatarUrl(avatar);
      kycTimeoutId = setTimeout(() => { if (kycMounted) { setStep(3); setKycVerified(false); } }, 800);
    }, 2500);
  }

  async function handleAvatarUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const result = await api.uploadImage(file, "avatar");
      setAvatarUrl(result.key);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error uploading image");
    }
  }

  async function handleFinish() {
    if (!displayName() || !avatarUrl() || !bio().trim() || !role()) return;
    setSaving(true);
    try {
      await api.updateMe({
        display_name: displayName(),
        bio: bio(),
        avatar_url: avatarUrl(),
        role: role()!,
        artist_number: artistNumber(),
      });
      await refreshUser();
      navigate(role() === "producer" ? "/showroom" : "/dashboard");
    } catch (e) {
      if (import.meta.env.DEV) console.error("Profile save failed:", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="gradient-bg noise-bg min-h-screen flex items-center justify-center">
      <div class="relative z-10 max-w-lg w-full mx-4">
        {/* Progress dots */}
        <div class="flex items-center gap-3 mb-10 justify-center">
          <div class="w-3 h-3 rounded-full transition-all" style={{ background: step() >= 1 ? "var(--gold)" : "var(--border)" }} />
          <div class="w-16 h-px transition-all" style={{ background: step() >= 2 ? "var(--gold)" : "var(--border)" }} />
          <div class="w-3 h-3 rounded-full transition-all" style={{ background: step() >= 2 ? "var(--gold)" : "var(--border)" }} />
          <div class="w-16 h-px transition-all" style={{ background: step() >= 3 ? "var(--gold)" : "var(--border)" }} />
          <div class="w-3 h-3 rounded-full transition-all" style={{ background: step() >= 3 ? "var(--gold)" : "var(--border)" }} />
        </div>

        {/* ── Step 1: Role Selection ── */}
        {step() === 1 && (
          <div class="card animate-fade-in">
            <div class="flex items-center gap-3 mb-6">
              <div
                class="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(212,168,83,0.12)", border: "1px solid rgba(212,168,83,0.3)" }}
              >
                <svg class="w-5 h-5" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                </svg>
              </div>
              <div>
                <h1 class="font-display text-2xl font-bold" style={{ color: "var(--cream)" }}>
                  Welcome to <span class="italic" style={{ color: "var(--gold)" }}>Heritage</span>
                </h1>
                <p class="text-xs" style={{ color: "var(--text-muted)" }}>
                  Wallet: <code class="font-mono">{shortenAddress(wallet() || "")}</code>
                </p>
              </div>
            </div>

            <p class="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
              How will you use the platform?
            </p>

            <div class="grid grid-cols-2 gap-4 mb-8">
              <button
                type="button"
                class="p-6 rounded-xl text-center transition-all"
                style={{
                  background: role() === "artist" ? "rgba(212,168,83,0.15)" : "var(--surface-light)",
                  border: `2px solid ${role() === "artist" ? "var(--gold)" : "var(--border)"}`,
                }}
                onClick={() => setRole("artist")}
              >
                <div class="text-3xl mb-2">🎨</div>
                <div class="font-semibold text-sm" style={{ color: role() === "artist" ? "var(--gold)" : "var(--cream)" }}>Artist</div>
                <p class="text-xs mt-2" style={{ color: "var(--text-muted)" }}>I create artworks and manage collections</p>
              </button>
              <button
                type="button"
                class="p-6 rounded-xl text-center transition-all"
                style={{
                  background: role() === "producer" ? "rgba(212,168,83,0.15)" : "var(--surface-light)",
                  border: `2px solid ${role() === "producer" ? "var(--gold)" : "var(--border)"}`,
                }}
                onClick={() => setRole("producer")}
              >
                <div class="text-3xl mb-2">🎬</div>
                <div class="font-semibold text-sm" style={{ color: role() === "producer" ? "var(--gold)" : "var(--cream)" }}>Producer</div>
                <p class="text-xs mt-2" style={{ color: "var(--text-muted)" }}>I curate and sell artworks in showrooms</p>
              </button>
            </div>

            <button
              class="btn-gold w-full"
              disabled={!role()}
              onClick={() => { setStep(2); setTimeout(() => runDemo(), 600); }}
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Step 2: KYC Verification ── */}
        {step() === 2 && (
          <div class="card animate-fade-in">
            <Show when={!kycVerifying() && !kycVerified()}>
              <div class="flex items-center gap-3 mb-6">
                <div
                  class="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(212,168,83,0.12)", border: "1px solid rgba(212,168,83,0.3)" }}
                >
                  <svg class="w-5 h-5" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                  </svg>
                </div>
                <div>
                  <h1 class="font-display text-2xl font-bold" style={{ color: "var(--cream)" }}>
                    Identity <span class="italic" style={{ color: "var(--gold)" }}>verification</span>
                  </h1>
                  <p class="text-xs" style={{ color: "var(--text-muted)" }}>KYC — Know Your Customer</p>
                </div>
              </div>

              <p class="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
                Please fill in your identity information to access the platform.
              </p>

              <div class="space-y-4 mb-8">
                <div>
                  <label class="label">Full legal name *</label>
                  <input
                    class="input"
                    placeholder="Ex: Jean Dupont"
                    value={legalName()}
                    onInput={(e) => setLegalName(e.currentTarget.value)}
                    maxLength={100}
                    autofocus
                  />
                </div>

                <div>
                  <label class="label">Date of birth *</label>
                  <input
                    type="text"
                    class="input"
                    placeholder="YYYY-MM-DD"
                    ref={dateInputRef}
                    readOnly
                  />
                </div>

                <div>
                  <label class="label">ID document number *</label>
                  <input
                    class="input"
                    placeholder="Ex: 123456789012"
                    value={documentNumber()}
                    onInput={(e) => setDocumentNumber(e.currentTarget.value)}
                    maxLength={30}
                  />
                </div>

                <Show when={role() === "artist"}>
                  <div>
                    <label class="label">Artist registration number *</label>
                    <input
                      class="input"
                      placeholder="Ex: MDA-12345678"
                      value={artistNumber()}
                      onInput={(e) => setArtistNumber(e.currentTarget.value)}
                      maxLength={50}
                    />
                    <p class="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      Your official artist registration number (Maison des Artistes, SIRET, etc.)
                    </p>
                  </div>
                </Show>
              </div>

              <div class="flex gap-3">
                <button class="btn-secondary flex-1" onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  class="btn-gold flex-1"
                  disabled={!legalName().trim() || !birthDate() || !documentNumber().trim() || (role() === "artist" && !artistNumber().trim())}
                  onClick={handleKycSubmit}
                >
                  Verify my identity
                </button>
              </div>

              <p class="text-xs mt-4 text-center" style={{ color: "var(--text-muted)" }}>
                Your data is processed securely in compliance with GDPR.
              </p>
            </Show>

            {/* Verifying animation */}
            <Show when={kycVerifying()}>
              <div class="flex flex-col items-center justify-center py-12">
                <div class="relative mb-6">
                  <div
                    class="w-16 h-16 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ "border-color": "var(--gold)", "border-top-color": "transparent" }}
                  />
                  <div class="absolute inset-0 flex items-center justify-center">
                    <svg class="w-6 h-6" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                    </svg>
                  </div>
                </div>
                <h2 class="font-display text-xl font-bold mb-2" style={{ color: "var(--cream)" }}>
                  Verifying...
                </h2>
                <p class="text-sm" style={{ color: "var(--text-muted)" }}>
                  Validating your identity documents
                </p>
              </div>
            </Show>

            {/* Verified success */}
            <Show when={kycVerified()}>
              <div class="flex flex-col items-center justify-center py-12">
                <div
                  class="w-16 h-16 rounded-full flex items-center justify-center mb-6"
                  style={{ background: "rgba(52,211,153,0.12)", border: "2px solid var(--emerald)" }}
                >
                  <svg class="w-8 h-8" style={{ color: "var(--emerald)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <h2 class="font-display text-xl font-bold mb-2" style={{ color: "var(--cream)" }}>
                  Identity verified
                </h2>
                <p class="text-sm" style={{ color: "var(--text-muted)" }}>
                  Welcome, {legalName().split(" ")[0]}
                </p>
              </div>
            </Show>
          </div>
        )}

        {/* ── Step 3: Profile ── */}
        {step() === 3 && (
          <div class="card animate-fade-in">
            <h1 class="font-display text-3xl font-bold mb-2" style={{ color: "var(--cream)" }}>
              Your <span class="italic" style={{ color: "var(--gold)" }}>{role() === "artist" ? "artist" : "producer"} profile</span>
            </h1>
            <p class="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
              {role() === "artist"
                ? "Other users will be able to find you and invite you to their projects."
                : "Artists will see your profile when you invite them to your showrooms."}
            </p>

            <div class="space-y-5 mb-8">
              {/* Avatar upload */}
              <div>
                <label class="label">Profile picture *</label>
                <div class="flex items-center gap-4">
                  <Show when={avatarUrl()} fallback={
                    <div
                      class="w-16 h-16 rounded-full flex items-center justify-center"
                      style={{ background: "var(--surface-light)", border: "2px dashed var(--border-light)" }}
                    >
                      <svg class="w-6 h-6" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                      </svg>
                    </div>
                  }>
                    <img src={sanitizeImageUrl(avatarUrl())} alt="Profile avatar" class="w-16 h-16 rounded-full object-cover" style={{ border: "2px solid var(--gold)" }} />
                  </Show>
                  <div>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload}
                      class="text-sm" style={{ color: "var(--cream-muted)" }} />
                    <p class="text-xs mt-1" style={{ color: "var(--text-muted)" }}>PNG, JPG or WebP</p>
                  </div>
                </div>
              </div>

              <div>
                <label class="label">{role() === "artist" ? "Artist name" : "Producer name"} *</label>
                <input
                  class="input"
                  placeholder={role() === "artist" ? "e.g. John Doe" : "e.g. Studio XYZ"}
                  value={displayName()}
                  onInput={(e) => setDisplayName(e.currentTarget.value)}
                  maxLength={100}
                  autofocus
                />
              </div>

              <div>
                <label class="label">Bio *</label>
                <textarea
                  class="input min-h-[100px] resize-none"
                  placeholder="A few words about you or your work..."
                  value={bio()}
                  onInput={(e) => setBio(e.currentTarget.value)}
                  maxLength={500}
                />
              </div>
            </div>

            <div class="flex gap-3">
              <button class="btn-secondary flex-1" onClick={() => setStep(2)}>
                Back
              </button>
              <button
                class="btn-gold flex-1"
                disabled={!displayName() || !avatarUrl() || !bio().trim() || saving()}
                onClick={handleFinish}
              >
                {saving() ? "Saving..." : "Let's go"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
