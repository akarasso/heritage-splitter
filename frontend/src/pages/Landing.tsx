import { For } from "solid-js";
import { useAuth } from "~/hooks/createAuth";
import { useNavigate } from "@solidjs/router";
import { HeroIllustration, LogoMark } from "~/components/ui/Logo";

export default function Landing() {
  const { connect, isConnecting, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  async function handleConnect() {
    if (isAuthenticated()) {
      navigate("/dashboard");
      return;
    }
    try {
      const result = await connect();
      navigate(result?.user_exists ? "/dashboard" : "/onboarding");
    } catch (e) {
      if (import.meta.env.DEV) console.error("Connection failed:", e instanceof Error ? e.message : "Unknown error");
    }
  }

  return (
    <div class="gradient-bg min-h-screen overflow-hidden">
      <div class="relative z-10">
        {/* Hero */}
        <div class="max-w-7xl mx-auto px-6 pt-20 pb-28">
          <div class="grid md:grid-cols-2 gap-12 items-center">
            {/* Left - Text */}
            <div>
              <h1 class="font-display text-5xl md:text-7xl font-bold leading-[0.9] mb-8 tracking-tight animate-fade-in-up">
                <span style={{ color: "var(--cream)" }}>Art deserves</span>
                <br />
                <span class="text-gradient-accent">its rights.</span>
              </h1>

              <p class="text-lg leading-relaxed mb-10 max-w-xl animate-fade-in-up delay-200" style={{ color: "var(--cream)" }}>
                A platform where artists, producers and galleries deploy together
                royalty smart contracts — <em class="font-display font-bold" style={{ color: "var(--gold)" }}>compliant with French law</em>.
              </p>

              <div class="flex items-center gap-6 animate-fade-in-up delay-400">
                <button class="btn-gold text-sm" onClick={handleConnect} disabled={isConnecting()}>
                  {isConnecting() ? "Connecting..." : "Enter Heritage"}
                </button>
                <span class="text-sm" style={{ color: "var(--cream-muted)" }}>MetaMask wallet required</span>
              </div>
            </div>

            {/* Right - Illustration */}
            <div class="hidden md:block animate-fade-in-scale delay-300">
              <div class="animate-float">
                <HeroIllustration />
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div class="divider" />

        {/* Pillars */}
        <div class="max-w-6xl mx-auto px-6 py-24">
          <div class="grid md:grid-cols-3 gap-px rounded-2xl overflow-hidden animate-fade-in-up" style={{ background: "var(--border)" }}>
            {[
              {
                number: "01",
                title: "Legal",
                subtitle: "compliance",
                desc: "Primary phase: 100% to the producer. VAT 5.5%, social contributions, depreciation respected. Secondary phase: trustless split.",
                icon: () => (
                  <svg class="w-8 h-8 mb-4" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.97Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.97Z" />
                  </svg>
                ),
              },
              {
                number: "02",
                title: "Trusted",
                subtitle: "collaboration",
                desc: "Invite your collaborators, define shares freely. Each participant validates before deployment.",
                icon: () => (
                  <svg class="w-8 h-8 mb-4" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                  </svg>
                ),
              },
              {
                number: "03",
                title: "On-chain",
                subtitle: "Avalanche",
                desc: "One-click deployment. Fast transactions, low fees. Everything is verifiable, transparent, immutable.",
                icon: () => (
                  <svg class="w-8 h-8 mb-4" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                  </svg>
                ),
              },
            ].map((item) => (
              <div class="p-10 flex flex-col justify-between min-h-[300px]" style={{ background: "var(--surface)" }}>
                <div>
                  {item.icon()}
                  <span class="text-5xl font-display font-bold" style={{ color: "var(--border-light)" }}>{item.number}</span>
                </div>
                <div>
                  <h3 class="text-xl font-semibold mb-2" style={{ color: "var(--cream)" }}>
                    {item.title} <span class="font-display italic font-normal" style={{ color: "var(--gold)" }}>{item.subtitle}</span>
                  </h3>
                  <p class="text-sm leading-relaxed" style={{ color: "var(--cream-muted)" }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div class="max-w-6xl mx-auto px-6 pb-32">
          <h2 class="font-display text-4xl md:text-5xl font-bold mb-16 animate-fade-in-up" style={{ color: "var(--cream)" }}>
            How <span class="italic" style={{ color: "var(--gold)" }}>it works</span>
          </h2>

          <div class="grid md:grid-cols-5 gap-6 stagger">
            <For each={[
              { num: "1", title: "Connect", desc: "your wallet", icon: "M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" },
              { num: "2", title: "Create", desc: "a project", icon: "M12 4.5v15m7.5-7.5h-15" },
              { num: "3", title: "Invite", desc: "your collaborators", icon: "M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z" },
              { num: "4", title: "Deploy", desc: "on Avalanche", icon: "M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" },
              { num: "5", title: "Receive", desc: "your royalties", icon: "M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" },
            ]}>
              {(item) => (
                <div class="animate-fade-in text-center">
                  <div class="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <svg class="w-7 h-7" style={{ color: "var(--gold)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
                    </svg>
                  </div>
                  <div class="font-semibold text-sm mb-1" style={{ color: "var(--cream)" }}>{item.title}</div>
                  <div class="text-sm" style={{ color: "var(--cream-muted)" }}>{item.desc}</div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Footer */}
        <div class="divider" />
        <div class="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <LogoMark size={24} />
            <span class="text-sm" style={{ color: "var(--cream-muted)" }}>Heritage Splitter</span>
          </div>
          <span class="text-sm font-mono" style={{ color: "var(--text-muted)" }}>CPI L122-8</span>
        </div>
      </div>
    </div>
  );
}
