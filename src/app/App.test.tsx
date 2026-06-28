import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("App", () => {
  it("renders the game table", () => {
    render(<App />);

    expect(screen.getByText("Love Letter")).toBeInTheDocument();
    expect(screen.getByLabelText("Your hand")).toBeInTheDocument();
    expect(screen.getByLabelText("Bot hand").querySelectorAll(".card-back")).toHaveLength(2);
  });

  it("finishes the opening draw when Strict Mode replays effects", async () => {
    vi.useFakeTimers();

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText("Your move")).toBeInTheDocument();
    expect(screen.getByLabelText("Your hand").querySelectorAll(".card-face")).toHaveLength(2);
  });
});
