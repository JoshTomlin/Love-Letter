import { describe, expect, it } from "vitest";
import { getLegalActions } from "../legalActions";
import type { GameState } from "../types";

function createState(hand: GameState["players"][number]["hand"]): GameState {
  return {
    players: [
      {
        id: 0,
        name: "You",
        hand,
        protected: false,
        eliminated: false,
        tokens: 0,
        seenCards: {},
      },
      {
        id: 1,
        name: "Bot",
        hand: ["Guard"],
        protected: false,
        eliminated: false,
        tokens: 0,
        seenCards: {},
      },
    ],
    currentPlayerIndex: 0,
    deck: ["Priest"],
    burnedCard: null,
    visibleBurnedCards: [],
    discardPile: [],
    phase: "awaiting-card-play",
    roundNumber: 1,
    roundWinnerId: null,
    ruleset: "classic-2p",
    pendingAction: null,
    log: [],
    seed: 1,
  };
}

describe("getLegalActions", () => {
  it("forces Countess when paired with King", () => {
    const state = createState(["Countess", "King"]);

    const actions = getLegalActions(state);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "play-card", card: "Countess" });
  });

  it("does not allow Guard to guess Guard", () => {
    const state = createState(["Guard", "Priest"]);

    const actions = getLegalActions(state).filter(
      (action) => action.type === "play-card" && action.card === "Guard",
    );

    expect(actions).toHaveLength(7);
  });
});
