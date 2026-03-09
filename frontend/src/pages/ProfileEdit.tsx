import { createSignal, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { api } from "~/lib/api-client";
import { useAuth } from "~/hooks/createAuth";
import { sanitizeImageUrl } from "~/lib/utils";
import { showToast } from "~/components/ui/Toast";

export default function ProfileEdit() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();

  const [displayName, setDisplayName] = createSignal("");
  const [bio, setBio] = createSignal("");
  const [avatarUrl, setAvatarUrl] = createSignal("");
  const [avatarPreview, setAvatarPreview] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [uploadingAvatar, setUploadingAvatar] = createSignal(false);
  let fileInputRef!: HTMLInputElement;

  onMount(() => {
    if (user()) {
      setDisplayName(user()!.display_name);
      setBio(user()!.bio);
      setAvatarUrl(sanitizeImageUrl(user()!.avatar_url));
      setAvatarPreview(sanitizeImageUrl(user()!.avatar_url));
    }
  });

  async function handleFileSelect(e: Event) {
    if (uploadingAvatar()) return;
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const result = await api.uploadImage(file, "avatar");
      setAvatarUrl(result.key);
      setAvatarPreview(sanitizeImageUrl(result.key));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error uploading image");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateMe({
        display_name: displayName(),
        bio: bio(),
        avatar_url: avatarUrl(),
      });
      await refreshUser();
      navigate("/dashboard");
    } catch (e) {
      if (import.meta.env.DEV) console.error("Profile save failed:", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="max-w-2xl mx-auto px-6 py-12">
      {/* Header */}
      <div class="mb-10">
        <p class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
          Settings
        </p>
        <h1 class="font-display text-4xl font-bold" style={{ color: "var(--cream)" }}>
          My <span class="italic" style={{ color: "var(--gold)" }}>profile</span>
        </h1>
      </div>

      <div class="card space-y-6">
        {/* Avatar */}
        <div>
          <label class="label">Profile picture *</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          <div class="flex items-center gap-5">
            <div
              class="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 cursor-pointer transition-all hover:opacity-80"
              style={{ background: "var(--surface-light)", border: "1px solid var(--border)" }}
              onClick={() => fileInputRef.click()}
            >
              <Show
                when={avatarPreview()}
                fallback={
                  <span class="font-display text-2xl font-bold" style={{ color: "var(--gold)" }}>
                    {displayName()?.[0]?.toUpperCase() || "?"}
                  </span>
                }
              >
                <img
                  src={avatarPreview()}
                  alt="Avatar"
                  class="w-full h-full object-cover"
                />
              </Show>
            </div>
            <div>
              <button class="btn-secondary text-xs" onClick={() => fileInputRef.click()}>
                Choose an image
              </button>
              <p class="text-xs mt-2" style={{ color: "var(--text-muted)" }}>PNG, JPG or WebP</p>
            </div>
          </div>
        </div>

        <div>
          <label class="label">Display name *</label>
          <input
            class="input"
            placeholder="Your name"
            value={displayName()}
            onInput={(e) => setDisplayName(e.currentTarget.value)}
          />
        </div>

        <div>
          <label class="label">Bio *</label>
          <textarea
            class="input min-h-[120px] resize-none"
            placeholder="Tell us about yourself..."
            value={bio()}
            onInput={(e) => setBio(e.currentTarget.value)}
          />
        </div>

        <div class="divider" />

        <button class="btn-gold w-full" onClick={handleSave} disabled={saving() || !displayName() || !avatarUrl() || !bio().trim()}>
          {saving() ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
