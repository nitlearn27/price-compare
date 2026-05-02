export interface SourceTheme {
  accent: string;
  label: string;
  monogram: string;
}

const THEMES: Record<string, SourceTheme> = {
  Amazon: {
    accent: "#FF9900",
    label: "Amazon",
    monogram: "A",
  },
  Flipkart: {
    accent: "#2874F0",
    label: "Flipkart",
    monogram: "F",
  },
  Croma: {
    accent: "#27C14D",
    label: "Croma",
    monogram: "C",
  },
  "Reliance Digital": {
    accent: "#C8102E",
    label: "RD",
    monogram: "RD",
  },
};

export function getSourceTheme(source: string): SourceTheme {
  return (
    THEMES[source] ?? {
      accent: "#6B7280",
      label: source,
      monogram: source.charAt(0).toUpperCase(),
    }
  );
}

export const SUPPORTED_SOURCES = Object.keys(THEMES);
