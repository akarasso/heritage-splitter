export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending",
  approved: "Approved",
  ready_to_deploy: "Ready to deploy",
  deployed: "Deployed",
  pending_mint_approval: "Mint pending",
  mint_ready: "Ready to mint",
  active: "Active",
};

export const STATUS_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  draft: { bg: "var(--surface-light)", color: "var(--text-muted)", border: "var(--border)" },
  pending_approval: { bg: "rgba(212,168,83,0.12)", color: "var(--gold)", border: "rgba(212,168,83,0.3)" },
  approved: { bg: "rgba(52,211,153,0.12)", color: "var(--emerald)", border: "rgba(52,211,153,0.3)" },
  ready_to_deploy: { bg: "rgba(59,130,246,0.12)", color: "var(--blue, #3b82f6)", border: "rgba(59,130,246,0.3)" },
  deployed: { bg: "rgba(167,139,250,0.12)", color: "var(--violet)", border: "rgba(167,139,250,0.3)" },
  pending_mint_approval: { bg: "rgba(251,191,36,0.12)", color: "var(--gold)", border: "rgba(251,191,36,0.3)" },
  mint_ready: { bg: "rgba(34,197,94,0.12)", color: "var(--emerald)", border: "rgba(34,197,94,0.3)" },
  active: { bg: "rgba(255,59,63,0.12)", color: "var(--accent)", border: "rgba(255,59,63,0.3)" },
};

export const ROLE_LABELS: Record<string, string> = {
  artist: "Artist",
  producer: "Producer",
};

export const ROLE_ICONS: Record<string, string> = {
  artist: "A",
  producer: "P",
};

/** Type text into a setter, character by character */
export function typeText(text: string, setter: (v: string) => void, charDelay = 45): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setter(text.slice(0, i));
      if (i >= text.length) { clearInterval(interval); resolve(); }
    }, charDelay);
  });
}

/** Generate an avatar on canvas with initials + gradient background */
export function generateAvatar(name: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  // Hash name to get consistent but varied colors (FNV-1a inspired, fast for short strings)
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) | 0;

  const hue1 = Math.abs(hash % 360);
  const hue2 = (hue1 + 40 + Math.abs((hash >> 8) % 30)) % 360;

  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, `hsl(${hue1}, 65%, 45%)`);
  grad.addColorStop(1, `hsl(${hue2}, 55%, 35%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  // Subtle pattern overlay
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 6; i++) {
    const x = Math.abs((hash >> (i * 4)) % 256);
    const y = Math.abs((hash >> (i * 4 + 2)) % 256);
    const r = 40 + Math.abs((hash >> (i * 3)) % 80);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Initials
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "bold 96px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials, 128, 136);

  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Validate image URL: only allow MinIO storage keys, safe data:image/ URIs (png/jpeg/gif/webp), or /api/ paths.
 *  Storage keys (e.g. "nft/uuid.png") are converted to API proxy URLs. Everything else returns empty string. */
export function sanitizeImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url === "") return "";
  // Allow paths served from our own API
  if (url.startsWith("/api/")) return url;
  // Legacy minio:// prefix — strip and convert to API URL
  if (url.startsWith("minio://")) return `/api/images/storage/${url.slice(8)}`;
  // Whitelist safe raster image types — reject SVG (can contain JavaScript)
  const SAFE_DATA_PREFIXES = [
    "data:image/png",
    "data:image/jpeg",
    "data:image/gif",
    "data:image/webp",
  ];
  if (url.startsWith("data:image/")) {
    if (SAFE_DATA_PREFIXES.some((prefix) => url.startsWith(prefix))) return url;
    return "";
  }
  // MinIO storage key (e.g. "nft/uuid.png", "avatar/uuid.jpg")
  if (/^(nft|avatar|logo)\/[\w.-]+$/.test(url)) return `/api/images/storage/${url}`;
  return "";
}

/** Resize an image file to max dimensions, returns a data URL (JPEG). */
export function resizeImage(file: File, maxSize = 512, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timeoutId = setTimeout(() => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Image load timed out after 10 seconds"));
    }, 10_000);
    img.onload = () => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(img.src);
      let w = img.width;
      let h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(file);
  });
}
