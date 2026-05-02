import { getSourceTheme } from "../../lib/source-theme";

interface Props {
  source: string;
}

export function SourceBadge({ source }: Props) {
  const theme = getSourceTheme(source);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white whitespace-nowrap"
      style={{ backgroundColor: theme.accent }}
      aria-label={`Source: ${theme.label}`}
    >
      {theme.label}
    </span>
  );
}
