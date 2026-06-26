import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the game table", () => {
    render(<App />);

    expect(screen.getByText("Love Letter")).toBeInTheDocument();
    expect(screen.getByLabelText("Your hand")).toBeInTheDocument();
  });
});
