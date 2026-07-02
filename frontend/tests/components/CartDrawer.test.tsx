import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CartProvider, useCart } from "../../src/hooks/useCart";
import { CartDrawer } from "../../src/components/cart/CartDrawer";
import { api } from "../../src/lib/api";

/** Helper that seeds the cart, then renders the drawer open. */
function Seeded({ names }: { names: string[] }) {
  const { add } = useCart();
  return (
    <>
      <button onClick={() => names.forEach((n) => add({ id: n, name: n, source: "Flipkart" }))}>
        seed
      </button>
      <CartDrawer open onClose={() => {}} />
    </>
  );
}

/** Like Seeded, but lets the test observe the drawer's onClose. */
function SeededWithClose({ names, onClose }: { names: string[]; onClose: () => void }) {
  const { add } = useCart();
  return (
    <>
      <button onClick={() => names.forEach((n) => add({ id: n, name: n, source: "Flipkart" }))}>
        seed
      </button>
      <CartDrawer open onClose={onClose} />
    </>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("CartDrawer", () => {
  it("shows the empty state when the cart is empty", () => {
    render(
      <CartProvider>
        <CartDrawer open onClose={() => {}} />
      </CartProvider>,
    );
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
  });

  it("disables Submit Order when the cart is empty", () => {
    render(
      <CartProvider>
        <CartDrawer open onClose={() => {}} />
      </CartProvider>,
    );
    expect(screen.getByRole("button", { name: /submit order/i })).toBeDisabled();
  });

  it("lists items and removes them", () => {
    render(
      <CartProvider>
        <Seeded names={["Amul Gold Milk", "Tata Salt 1kg"]} />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("seed"));
    expect(screen.getByText("Amul Gold Milk")).toBeInTheDocument();
    expect(screen.getByText("Tata Salt 1kg")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/remove from cart: Amul Gold Milk/i));
    expect(screen.queryByText("Amul Gold Milk")).not.toBeInTheDocument();
  });

  it("shows the busy/error message and keeps the cart when checkout fails", async () => {
    const busyMsg =
      "An order is already being processed. Please wait a few seconds and submit again.";
    vi.spyOn(api, "checkoutCart").mockRejectedValue(new Error(busyMsg));
    render(
      <CartProvider>
        <Seeded names={["Amul Gold Milk"]} />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("seed"));
    fireEvent.click(screen.getByRole("button", { name: /submit order/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(busyMsg));
    // cart is preserved so the user can retry
    expect(screen.getByText("Amul Gold Milk")).toBeInTheDocument();
  });

  it("submits the order and shows the confirmation", async () => {
    vi.spyOn(api, "checkoutCart").mockResolvedValue({
      submitted: 1,
      detail: "Submitted 1 item(s) to Flipkart.",
    });
    render(
      <CartProvider>
        <Seeded names={["Amul Gold Milk"]} />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("seed"));
    fireEvent.click(screen.getByRole("button", { name: /submit order/i }));

    await waitFor(() =>
      expect(screen.getByText(/submitted 1 item/i)).toBeInTheDocument(),
    );
    expect(api.checkoutCart).toHaveBeenCalledWith({
      products: [{ name: "Amul Gold Milk", source: "Flipkart" }],
    });
  });

  it("clears the cart and closes the drawer after a successful submit", async () => {
    vi.spyOn(api, "checkoutCart").mockResolvedValue({
      submitted: 1,
      detail: "Submitted 1 item(s) to Flipkart.",
    });
    const onClose = vi.fn();
    render(
      <CartProvider>
        <SeededWithClose names={["Amul Gold Milk"]} onClose={onClose} />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("seed"));
    fireEvent.click(screen.getByRole("button", { name: /submit order/i }));

    // cart empties on success
    await waitFor(() => expect(screen.queryByText("Amul Gold Milk")).not.toBeInTheDocument());
    // and the drawer auto-closes shortly after
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 });
  });
});
