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
    expect(state.phase).toBe("awaiting-turn-draw");
  });
});
