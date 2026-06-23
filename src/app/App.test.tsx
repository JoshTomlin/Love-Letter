import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the clearer table heading", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /a clearer table for following every turn/i }),
    ).toBeInTheDocument();
  });
});
