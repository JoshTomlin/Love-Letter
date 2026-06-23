import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the phone-first duel table heading", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /phone-first duel table/i }),
    ).toBeInTheDocument();
  });
});
