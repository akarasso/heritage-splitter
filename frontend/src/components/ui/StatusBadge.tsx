import { STATUS_LABELS, STATUS_STYLES } from "~/lib/utils";

export default function StatusBadge(props: { status: string }) {
  const style = () => STATUS_STYLES[props.status] || STATUS_STYLES.draft;

  return (
    <span
      class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium tracking-wide uppercase"
      style={{
        background: style().bg,
        color: style().color,
        border: `1px solid ${style().border}`,
      }}
    >
      <span class="w-1.5 h-1.5 rounded-full mr-2" style={{ background: style().color }} />
      {STATUS_LABELS[props.status] || props.status}
    </span>
  );
}
