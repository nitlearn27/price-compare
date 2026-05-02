import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SourceBadge } from "../../src/components/results/SourceBadge";
import { SUPPORTED_SOURCES, getSourceTheme } from "../../src/lib/source-theme";

describe("SourceBadge", () => {
  it("renders the source label", () => {
    render(<SourceBadge source="Amazon" />);
    expect(screen.getByText("Amazon")).toBeInTheDocument();
  });

  it("renders Flipkart with correct label", () => {
    render(<SourceBadge source="Flipkart" />);
    expect(screen.getByText("Flipkart")).toBeInTheDocument();
  });

  it("renders Reliance Digital with RD monogram", () => {
    render(<SourceBadge source="Reliance Digital" />);
    expect(screen.getByText("RD")).toBeInTheDocument();
  });

  it("renders unknown source with its name", () => {
    render(<SourceBadge source="Unknown Store" />);
    expect(screen.getByText("Unknown Store")).toBeInTheDocument();
  });

  it.each(SUPPORTED_SOURCES)("source %s resolves to correct accent color", (source) => {
    const theme = getSourceTheme(source);
    const { container } = render(<SourceBadge source={source} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.style.backgroundColor).toBeTruthy();
    expect(theme.accent).toBeTruthy();
  });
});

describe("source-theme contract", () => {
  it("Amazon has orange accent", () => {
    expect(getSourceTheme("Amazon").accent).toBe("#FF9900");
  });

  it("Flipkart has blue accent", () => {
    expect(getSourceTheme("Flipkart").accent).toBe("#2874F0");
  });

  it("Croma has green accent", () => {
    expect(getSourceTheme("Croma").accent).toBe("#27C14D");
  });

  it("Reliance Digital has red accent", () => {
    expect(getSourceTheme("Reliance Digital").accent).toBe("#C8102E");
  });

  it("unknown source gets gray accent", () => {
    expect(getSourceTheme("SomeNewStore").accent).toBe("#6B7280");
  });

  it("unknown source gets first letter as monogram", () => {
    expect(getSourceTheme("ZStore").monogram).toBe("Z");
  });
});
