export function LogoMark(props: { size?: number; class?: string }) {
  const s = props.size || 40;
  return (
    <svg width={s} height={s} viewBox="0 0 120 120" fill="none" class={props.class}>
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--gold)" />
          <stop offset="100%" stop-color="#c49340" />
        </linearGradient>
        <linearGradient id="logo-accent" x1="60" y1="0" x2="60" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--accent)" />
          <stop offset="100%" stop-color="var(--accent-warm)" />
        </linearGradient>
      </defs>
      {/* Outer frame */}
      <rect x="4" y="4" width="112" height="112" rx="24" stroke="url(#logo-grad)" stroke-width="3" fill="none" />
      {/* H letterform - elegant serif style */}
      <path
        d="M36 30 L36 90 M36 30 C36 30 38 28 42 28 C46 28 48 30 48 30 L48 54 M48 54 L72 54 M72 54 L72 30 C72 30 74 28 78 28 C82 28 84 30 84 30 L84 90"
        stroke="url(#logo-grad)"
        stroke-width="5"
        stroke-linecap="round"
        fill="none"
      />
      {/* Serifs */}
      <path d="M30 90 L54 90" stroke="url(#logo-grad)" stroke-width="4" stroke-linecap="round" />
      <path d="M66 90 L90 90" stroke="url(#logo-grad)" stroke-width="4" stroke-linecap="round" />
      <path d="M30 30 L48 30" stroke="url(#logo-grad)" stroke-width="3" stroke-linecap="round" />
      <path d="M72 30 L90 30" stroke="url(#logo-grad)" stroke-width="3" stroke-linecap="round" />
      {/* Accent dot */}
      <circle cx="60" cy="104" r="4" fill="url(#logo-accent)" />
    </svg>
  );
}

export function LogoFull(props: { class?: string }) {
  return (
    <div class={`flex items-center gap-3 ${props.class || ""}`}>
      <LogoMark size={36} />
      <div class="flex items-baseline gap-1.5">
        <span class="font-display text-xl font-bold tracking-tight" style={{ color: "var(--cream)" }}>Heritage</span>
        <span class="font-display text-xl font-light italic tracking-tight" style={{ color: "var(--gold)" }}>Splitter</span>
      </div>
    </div>
  );
}

export function HeroIllustration() {
  return (
    <svg viewBox="0 0 600 500" fill="none" class="w-full h-full" style={{ opacity: 0.9 }}>
      <defs>
        <linearGradient id="ill-gold" x1="0" y1="0" x2="600" y2="500" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--gold)" stop-opacity="0.6" />
          <stop offset="100%" stop-color="#c49340" stop-opacity="0.2" />
        </linearGradient>
        <linearGradient id="ill-accent" x1="300" y1="0" x2="300" y2="500" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.4" />
          <stop offset="100%" stop-color="var(--accent-warm)" stop-opacity="0.1" />
        </linearGradient>
        <linearGradient id="ill-cream" x1="0" y1="250" x2="600" y2="250" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--cream)" stop-opacity="0.08" />
          <stop offset="100%" stop-color="var(--cream)" stop-opacity="0.02" />
        </linearGradient>
      </defs>

      {/* Abstract canvas frame */}
      <rect x="80" y="40" width="440" height="340" rx="8" stroke="url(#ill-gold)" stroke-width="1.5" fill="none" />
      <rect x="95" y="55" width="410" height="310" rx="4" stroke="var(--border)" stroke-width="0.5" fill="url(#ill-cream)" />

      {/* Abstract art composition inside the frame */}
      {/* Large geometric shape */}
      <path d="M160 320 L300 100 L440 320 Z" fill="none" stroke="url(#ill-gold)" stroke-width="1.5" />
      <path d="M200 300 L300 140 L400 300 Z" fill="var(--gold)" fill-opacity="0.06" stroke="none" />

      {/* Circles - artistic composition */}
      <circle cx="300" cy="200" r="80" stroke="url(#ill-accent)" stroke-width="1" fill="var(--accent)" fill-opacity="0.03" />
      <circle cx="250" cy="240" r="50" stroke="var(--gold)" stroke-width="0.8" fill="var(--gold)" fill-opacity="0.04" stroke-opacity="0.5" />
      <circle cx="370" cy="180" r="35" stroke="var(--emerald)" stroke-width="0.8" fill="var(--emerald)" fill-opacity="0.04" stroke-opacity="0.4" />

      {/* Horizontal lines - like a musical staff / contract lines */}
      <line x1="130" y1="180" x2="470" y2="180" stroke="var(--border-light)" stroke-width="0.5" stroke-opacity="0.5" />
      <line x1="130" y1="220" x2="470" y2="220" stroke="var(--border-light)" stroke-width="0.5" stroke-opacity="0.4" />
      <line x1="130" y1="260" x2="470" y2="260" stroke="var(--border-light)" stroke-width="0.5" stroke-opacity="0.3" />

      {/* Signature-like curve at bottom */}
      <path d="M180 310 C220 280 260 330 300 295 C340 260 380 320 420 290" stroke="url(#ill-gold)" stroke-width="1.5" fill="none" stroke-linecap="round" />

      {/* Small accent dots - like paint splashes */}
      <circle cx="200" cy="160" r="3" fill="var(--accent)" fill-opacity="0.6" />
      <circle cx="380" cy="140" r="2.5" fill="var(--gold)" fill-opacity="0.7" />
      <circle cx="420" cy="260" r="2" fill="var(--emerald)" fill-opacity="0.5" />
      <circle cx="160" cy="280" r="2" fill="var(--violet)" fill-opacity="0.5" />
      <circle cx="340" cy="300" r="3" fill="var(--accent-warm)" fill-opacity="0.4" />

      {/* Blockchain nodes / connection lines below frame */}
      <circle cx="150" cy="440" r="12" stroke="var(--gold)" stroke-width="1" fill="var(--surface)" />
      <circle cx="250" cy="440" r="12" stroke="var(--accent)" stroke-width="1" fill="var(--surface)" />
      <circle cx="350" cy="440" r="12" stroke="var(--emerald)" stroke-width="1" fill="var(--surface)" />
      <circle cx="450" cy="440" r="12" stroke="var(--violet)" stroke-width="1" fill="var(--surface)" />
      <line x1="162" y1="440" x2="238" y2="440" stroke="var(--border-light)" stroke-width="1" />
      <line x1="262" y1="440" x2="338" y2="440" stroke="var(--border-light)" stroke-width="1" />
      <line x1="362" y1="440" x2="438" y2="440" stroke="var(--border-light)" stroke-width="1" />

      {/* Labels under nodes */}
      <text x="150" y="468" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="var(--font-body)">Artiste</text>
      <text x="250" y="468" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="var(--font-body)">Producteur</text>
      <text x="350" y="468" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="var(--font-body)">Galerie</text>
      <text x="450" y="468" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="var(--font-body)">Royalties</text>

      {/* Node icons */}
      <text x="150" y="444" text-anchor="middle" fill="var(--gold)" font-size="11" font-family="var(--font-display)" font-weight="bold">A</text>
      <text x="250" y="444" text-anchor="middle" fill="var(--accent)" font-size="11" font-family="var(--font-display)" font-weight="bold">P</text>
      <text x="350" y="444" text-anchor="middle" fill="var(--emerald)" font-size="11" font-family="var(--font-display)" font-weight="bold">G</text>
      <text x="450" y="444" text-anchor="middle" fill="var(--violet)" font-size="11" font-family="var(--font-display)" font-weight="bold">%</text>
    </svg>
  );
}
