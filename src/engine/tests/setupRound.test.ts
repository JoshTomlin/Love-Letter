import { describe, expect, it } from "vitest";
import { createInitialGame } from "../setupRound";

describe("createInitialGame", () => {
  it("prepares the classic 2-player setup with visible burned cards", () => {
    const state = createInitialGame({
      playerNames: ["A", "B"],
      seed: 7,
    });

    expect(state.ruleset).toBe("classic-2p");
    expect(state.visibleBurnedCards).toHaveLength(3);
    expect(state.players).toHaveLength(2);
    expect(state.players.every((player) => player.hand.length === 1)).toBe(true);
    expect(state.deck).toHaveLength(10);
    expect(
      state.deck.length +
        state.visibleBurnedCards.length +
        state.players.reduce((total, player) => total + player.hand.length, 0) +
        (state.burnedCard ? 1 : 0),
    ).toBe(16);
    expect(state.phase).toBe("awaiting-turn-draw");
  });
});
