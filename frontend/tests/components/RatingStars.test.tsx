import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RatingStars } from "../../src/components/results/RatingStars";

describe("RatingStars", () => {
  it("renders dash for null rating", () => {
    render(<RatingStars rating={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders numeric value for valid rating", () => {
    render(<RatingStars rating="4.5" />);
    expect(screen.getByText("4.5")).toBeInTheDocument();
  });

  it("renders 5 star icons", () => {
    const { container } = render(<RatingStars rating="3.0" />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(5);
  });

  it("renders non-numeric string as text", () => {
    render(<RatingStars rating="N/A" />);
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });

  it("has accessible aria-label", () => {
    render(<RatingStars rating="4.0" />);
    expect(screen.getByLabelText(/4\.0 out of 5/i)).toBeInTheDocument();
  });
});
