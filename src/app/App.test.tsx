import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the playable prototype heading", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /playable engine-first prototype/i }),
    ).toBeInTheDocument();
  });
});
