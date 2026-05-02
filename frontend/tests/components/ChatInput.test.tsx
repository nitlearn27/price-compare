import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatInput } from "../../src/components/chat/ChatInput";

describe("ChatInput", () => {
  const defaultProps = {
    value: "",
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    disabled: false,
  };

  it("renders textarea and send button", () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByLabelText(/send/i)).toBeInTheDocument();
  });

  it("disables textarea and button when disabled=true", () => {
    render(<ChatInput {...defaultProps} disabled={true} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByLabelText(/send/i)).toBeDisabled();
  });

  it("calls onChange when user types", () => {
    const onChange = vi.fn();
    render(<ChatInput {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("calls onSubmit when Enter pressed with text", () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...defaultProps} value="hello" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: false });
    expect(onSubmit).toHaveBeenCalled();
  });

  it("does not call onSubmit on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...defaultProps} value="hello" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not call onSubmit when value is empty string", () => {
    const onSubmit = vi.fn();
    render(<ChatInput {...defaultProps} value="" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
