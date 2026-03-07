import { A } from "@solidjs/router";
import { Show } from "solid-js";
import type { Project } from "~/lib/api-client";
import StatusBadge from "~/components/ui/StatusBadge";
import { formatDate, sanitizeImageUrl } from "~/lib/utils";

interface Props {
  project: Project;
  participantCount?: number;
}

export default function ProjectCard(props: Props) {
  const isCompleted = () => ["deployed", "active"].includes(props.project.status);

  return (
    <A href={`/projects/${props.project.id}`} class="card-glow block animate-fade-in">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center gap-3">
          {props.project.logo_url ? (
            <img src={sanitizeImageUrl(props.project.logo_url)} alt={`${props.project.name} logo`} class="w-10 h-10 rounded-lg object-cover shrink-0" />
          ) : (
            <div
              class="w-10 h-10 rounded-lg flex items-center justify-center font-display text-lg font-bold shrink-0"
              style={{ background: "var(--surface-light)", color: "var(--gold)" }}
            >
              {props.project.name[0]?.toUpperCase() || "P"}
            </div>
          )}
          <h3 class="font-display text-xl font-bold" style={{ color: "var(--cream)" }}>
            {props.project.name}
          </h3>
        </div>
        <StatusBadge status={props.project.status} />
      </div>
      <p class="text-sm leading-relaxed mb-6 line-clamp-2" style={{ color: "var(--cream-muted)" }}>
        {props.project.description || "No description"}
      </p>
      <div class="divider mb-4" />
      <div class="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
        <div class="flex items-center gap-3">
          <Show when={props.project.max_participants}>
            <span class="font-mono">
              {props.participantCount ?? "?"}/{props.project.max_participants} participants
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <Show when={isCompleted() && props.project.completed_at}>
            <span style={{ color: "var(--emerald)" }}>Deployed</span>
            <span style={{ color: "var(--border-light)" }}>|</span>
          </Show>
          <span>{formatDate(props.project.created_at)}</span>
        </div>
      </div>
    </A>
  );
}
