import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { api } from "~/lib/api-client";

export default function ShowroomNew() {
  const navigate = useNavigate();
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!name().trim()) return;
    setSaving(true);
    setError("");
    try {
      const sr = await api.createShowroom({ name: name().trim(), description: description().trim() });
      navigate(`/showroom/${sr.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create showroom");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="max-w-xl mx-auto px-6 py-12">
      <p class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
        Showroom
      </p>
      <h1 class="font-display text-3xl font-bold mb-8" style={{ color: "var(--cream)" }}>
        New Showroom
      </h1>

      <form onSubmit={handleSubmit} class="card" style={{ padding: "24px" }}>
        <div class="space-y-5">
          <div>
            <label class="block text-xs font-medium mb-1.5" style={{ color: "var(--cream-muted)" }}>Name</label>
            <input
              type="text"
              class="input w-full"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="My Showroom"
              required
            />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1.5" style={{ color: "var(--cream-muted)" }}>Description</label>
            <textarea
              class="input w-full"
              rows={3}
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
              placeholder="Curated selection of artworks..."
            />
          </div>
        </div>

        {error() && (
          <p class="text-xs mt-4" style={{ color: "var(--accent)" }}>{error()}</p>
        )}

        <div class="flex justify-end gap-3 mt-6">
          <button type="button" class="btn-secondary text-sm" onClick={() => history.back()}>Cancel</button>
          <button type="submit" class="btn-gold text-sm" disabled={saving() || !name().trim()}>
            {saving() ? "Creating..." : "Create Showroom"}
          </button>
        </div>
      </form>
    </div>
  );
}
