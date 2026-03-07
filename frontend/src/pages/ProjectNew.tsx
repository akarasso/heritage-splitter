import { createSignal, Show, onMount, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { api } from "~/lib/api-client";
import { resizeImage, typeText, generateAvatar, sanitizeImageUrl } from "~/lib/utils";

const THEMES = [
  "generative and algorithmic art",
  "nocturnal urban photography",
  "abstract contemporary sculpture",
  "digital expressionist painting",
  "minimal and geometric art",
  "contemporary street art and graffiti",
  "modern botanical illustration",
  "art deco revisited",
  "surrealist digital collage",
  "contemporary Asian calligraphy",
  "kinetic and optical art",
  "land art and digital nature",
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export default function ProjectNew() {
  const navigate = useNavigate();
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [logoUrl, setLogoUrl] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [autoFilling, setAutoFilling] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [generatingImage, setGeneratingImage] = createSignal(false);
  let logoInputRef: HTMLInputElement | undefined;
  let mounted = true;
  let autoFillTimeout: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { mounted = false; if (autoFillTimeout) clearTimeout(autoFillTimeout); });

  // Auto-fill via Claude AI on mount
  onMount(() => {
    autoFillTimeout = setTimeout(() => runAutoFill(), 600);
  });

  async function runAutoFill() {
    if (autoFilling() || !mounted) return;
    setAutoFilling(true);
    setName(""); setDescription(""); setLogoUrl("");

    const theme = pick(THEMES);
    const seed = Math.floor(Math.random() * 100000);

    try {
      // Step 1: Generate name + description via Claude
      const result = await api.aiGenerate(
        `You are a creative assistant for an art and NFT platform. ` +
        `Random seed: ${seed}. ` +
        `Generate an ORIGINAL and UNIQUE artistic project name on the theme "${theme}", ` +
        `and a short description (2-3 sentences, ~200 characters). ` +
        `Be inventive, poetic, surprising. Avoid generic names. ` +
        `Reply ONLY in the following format:\n` +
        `NAME: [project name]\nDESCRIPTION: [project description]`,
        150,
      );

      const text = result.text;
      const nameMatch = text.match(/NAME:\s*(.+)/);
      const descMatch = text.match(/DESCRIPTION:\s*(.+)/);

      const generatedName = nameMatch?.[1]?.trim() || "Ephemeral Collection";
      const generatedDesc = descMatch?.[1]?.trim() || "A unique artistic project blending tradition and digital innovation.";

      // Start image generation immediately (in parallel with typewriter)
      let imagePromise: Promise<void>;
      try {
        setGeneratingImage(true);
        imagePromise = api.aiGenerateImage(
          `A beautiful fine art piece for a project called "${generatedName}". ` +
          `Theme: ${theme}. ${generatedDesc} ` +
          `Style: museum-quality contemporary artwork, rich colors, dramatic lighting, ` +
          `highly detailed, professional gallery piece. No text, no watermarks.`,
          "256x256",
        ).then((imgResult) => {
          setLogoUrl(`data:image/png;base64,${imgResult.image_base64}`);
        }).catch(() => {
          setLogoUrl(generateAvatar(generatedName));
        }).finally(() => {
          setGeneratingImage(false);
        });
      } catch {
        setGeneratingImage(false);
        setLogoUrl(generateAvatar(generatedName));
        imagePromise = Promise.resolve();
      }

      // Typewriter animations run in parallel with image generation
      await typeText(generatedName, setName, 50);
      await new Promise((r) => setTimeout(r, 300));
      await typeText(generatedDesc, setDescription, 30);

      // Wait for image if not done yet
      await imagePromise;
    } catch {
      const fallbackName = "Ephemeral Collection";
      const fallbackDesc = "A unique artistic project blending tradition and digital innovation.";
      await typeText(fallbackName, setName, 50);
      await typeText(fallbackDesc, setDescription, 30);
      setLogoUrl(generateAvatar(fallbackName));
    } finally {
      setAutoFilling(false);
    }
  }

  async function handleLogoUpload(e: Event) {
    if (uploading()) return;
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await resizeImage(file, 512, 0.8);
      setLogoUrl(dataUrl);
    } catch {
      alert("Error resizing image");
    } finally {
      setUploading(false);
    }
  }

  async function handleCreate() {
    if (!name() || !logoUrl()) return;
    setLoading(true);
    try {
      const project = await api.createProject({
        name: name(),
        description: description(),
        logo_url: logoUrl(),
      });
      navigate(`/projects/${project.id}`);
    } catch (e) {
      console.error("Project creation failed:", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="max-w-2xl mx-auto px-6 py-12">
      {/* Header */}
      <div class="mb-10">
        <p class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
          Create
        </p>
        <h1 class="font-display text-4xl font-bold" style={{ color: "var(--cream)" }}>
          New <span class="italic" style={{ color: "var(--gold)" }}>project</span>
        </h1>
      </div>

      <div class="card space-y-6">
        {/* Logo upload — required */}
        <div>
          <label class="label">Project icon *</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleLogoUpload}
            ref={logoInputRef}
            style={{ display: "none" }}
          />
          <div
            class="flex items-center gap-4 p-4 rounded-xl cursor-pointer transition-all hover:opacity-80"
            style={{ background: "var(--surface-light)", border: "2px dashed var(--border-light)" }}
            onClick={() => logoInputRef?.click()}
          >
            <Show when={logoUrl()} fallback={
              <div
                class="w-16 h-16 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "var(--noir-light)", border: "1px solid var(--border)" }}
              >
                <Show when={autoFilling() || generatingImage()} fallback={
                  <svg class="w-6 h-6" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                  </svg>
                }>
                  <div
                    class="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ "border-color": "var(--gold)", "border-top-color": "transparent" }}
                  />
                </Show>
              </div>
            }>
              <img src={sanitizeImageUrl(logoUrl())} alt="Project logo" class="w-16 h-16 rounded-xl object-cover shrink-0" style={{ border: "2px solid var(--gold)" }} />
            </Show>
            <div>
              <p class="text-sm font-medium" style={{ color: "var(--cream)" }}>
                {generatingImage() ? "Generating image..." : autoFilling() ? "Generating..." : logoUrl() ? "Change image" : "Click to choose an image"}
              </p>
              <p class="text-xs mt-1" style={{ color: "var(--text-muted)" }}>PNG, JPG or WebP</p>
            </div>
          </div>
        </div>

        <div>
          <label class="label">Project name *</label>
          <input
            class="input"
            placeholder="e.g. Lights of Paris Collection"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            autofocus
          />
        </div>

        <div>
          <label class="label">Description</label>
          <textarea
            class="input min-h-[120px] resize-none"
            placeholder="Describe your artistic project..."
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
          />
        </div>

        <div class="divider" />

        <div class="flex gap-4">
          <button
            class="btn-gold flex-1"
            onClick={handleCreate}
            disabled={loading() || autoFilling() || uploading() || !name() || !logoUrl()}
          >
            {loading() ? "Creating..." : "Create project"}
          </button>
          <button class="btn-secondary" onClick={() => history.back()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
