import { For } from "solid-js";
import { A } from "@solidjs/router";

interface Crumb {
  label: string;
  href?: string;
}

export default function Breadcrumb(props: { items: Crumb[] }) {
  return (
    <nav class="flex items-center gap-2 text-sm mb-8">
      <For each={props.items}>
        {(item, i) => (
          <>
            {i() > 0 && (
              <span style={{ color: "var(--border-light)" }}>/</span>
            )}
            {item.href ? (
              <A
                href={item.href}
                class="transition-colors hover:underline"
                style={{ color: "var(--text-muted)" }}
              >
                {item.label}
              </A>
            ) : (
              <span style={{ color: "var(--cream)" }}>{item.label}</span>
            )}
          </>
        )}
      </For>
    </nav>
  );
}
