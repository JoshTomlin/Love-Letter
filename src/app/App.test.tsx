import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimpleBot } from "../bots/randomBot";
import { getLegalActions } from "../engine/legalActions";
import { getPlayerView } from "../engine/playerView";
import { createPlayer, createTestState } from "../engine/tests/testUtils";
import type { Card } from "../engine/types";
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
    expect(screen.getByLabelText("Bot hand").querySelectorAll(".card-back")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open bot discard history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open your discard history" })).toBeInTheDocument();
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

describe("simple bot", () => {
  it("never plays Princess when another card is legal", () => {
    const action = chooseBotAction(["Princess", "Guard"], ["Priest"]);

    expect(action).toMatchObject({ type: "play-card", card: "Guard" });
  });

  it("uses a Guard to guess a Princess seen with Priest", () => {
    const action = chooseBotAction(["Guard", "Priest"], ["Princess"], "Princess");

    expect(action).toMatchObject({
      type: "play-card",
      card: "Guard",
      targetId: 0,
      guess: "Princess",
    });
  });

  it("uses Prince instead of losing a Baron comparison against a known Princess", () => {
    const action = chooseBotAction(["Prince", "Baron"], ["Princess"], "Princess");

    expect(action).toMatchObject({ type: "play-card", card: "Prince", targetId: 0 });
  });

  it("uses the remaining-card range for an unknown Guard guess", () => {
    const removedCards: Card[] = [
      "Priest",
      "Priest",
      "Baron",
      "Baron",
      "Handmaid",
      "Prince",
      "Prince",
      "King",
      "Countess",
    ];
    const action = chooseBotAction(
      ["Guard", "Handmaid"],
      ["Princess"],
      undefined,
      removedCards,
    );

    expect(action).toMatchObject({
      type: "play-card",
      card: "Guard",
      guess: "Princess",
    });
  });
});

function chooseBotAction(
  botHand: Card[],
  humanHand: Card[],
  knownCard?: Card,
  discardedCards: Card[] = [],
) {
  const state = createTestState({
    currentPlayerIndex: 1,
    players: [
      createPlayer(0, "You", humanHand),
      createPlayer(1, "Bot", botHand, {
        seenCards: knownCard ? { 0: knownCard } : {},
      }),
    ],
  });
  state.discardPile = discardedCards.map((card) => ({
    playerId: 0,
    card,
    faceUp: true,
  }));
  const bot = createSimpleBot(7);

  return bot.chooseAction(getPlayerView(state, 1), getLegalActions(state));
}
