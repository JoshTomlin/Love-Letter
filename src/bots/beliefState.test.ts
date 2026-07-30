import { describe, expect, it } from "vitest";
import {
  evaluateActionAgainstRange,
  getOpponentRange,
  sampleConsistentStates,
  updateOpponentRanges,
} from "./beliefState";
import { createBeliefBot } from "./randomBot";
import {
  BALANCED_OPPONENT_MODEL,
  HUMAN_TENDENCY_MODEL,
  retainedCardLikelihood,
} from "./opponentModel";
import { CLASSIC_DECK } from "../engine/constants";
import { applyAction } from "../engine/applyAction";
import { getLegalActions } from "../engine/legalActions";
import { getPlayerView } from "../engine/playerView";
import { createSeededRandom } from "../engine/random";
import { createInitialGame } from "../engine/setupRound";
import { drawCardForCurrentPlayer } from "../engine/turnFlow";
import { createPlayer, createTestState } from "../engine/tests/testUtils";
import type { Card } from "../engine/types";

describe("opponent belief ranges", () => {
  it("collapses to private knowledge from Priest or King", () => {
    const state = createTestState({
      currentPlayerIndex: 1,
      players: [
        createPlayer(0, "You", ["Princess"]),
        createPlayer(1, "Bot", ["Guard", "Priest"], {
          seenCards: { 0: "Princess" },
        }),
      ],
    });

    const range = getOpponentRange(getPlayerView(state, 1), 0);

    expect(range).toMatchObject({
      playerId: 0,
      source: "known",
      entropy: 0,
      cards: [{ card: "Princess", probability: 1 }],
    });
  });

  it("treats a Countess play as evidence for a retained King or Prince", () => {
    const state = createTestState({
      currentPlayerIndex: 1,
      players: [
        createPlayer(0, "You", ["King"]),
        createPlayer(1, "Bot", ["Guard", "Priest"]),
      ],
    });
    state.discardPile = [
      { playerId: 0, card: "Countess", faceUp: true },
    ];
    state.log = [
      { type: "card-played", playerId: 0, card: "Countess" },
    ];

    const range = getOpponentRange(getPlayerView(state, 1), 0);
    const royalProbability = range?.cards
      .filter((entry) => entry.card === "King" || entry.card === "Prince")
      .reduce((total, entry) => total + entry.probability, 0);
    const guardProbability = range?.cards.find((entry) => entry.card === "Guard")?.probability;

    expect(royalProbability).toBeGreaterThan(0.4);
    expect(royalProbability).toBeGreaterThan(guardProbability ?? 0);
  });

  it("computes exact Guard and Baron outcomes against a known card", () => {
    const state = createTestState({
      currentPlayerIndex: 1,
      players: [
        createPlayer(0, "You", ["Princess"]),
        createPlayer(1, "Bot", ["Guard", "King"], {
          seenCards: { 0: "Princess" },
        }),
      ],
    });
    const view = getPlayerView(state, 1);

    const guard = evaluateActionAgainstRange(view, {
      type: "play-card",
      playerId: 1,
      card: "Guard",
      targetId: 0,
      guess: "Princess",
    });
    const baron = evaluateActionAgainstRange(
      { ...view, myHand: ["Baron", "King"] },
      { type: "play-card", playerId: 1, card: "Baron", targetId: 0 },
    );

    expect(guard.hitProbability).toBe(1);
    expect(baron.lossProbability).toBe(1);
    expect(baron.winProbability).toBe(0);
  });

  it("carries a soft retained-card range into the opponent's next turn", () => {
    const previousState = createTestState({
      currentPlayerIndex: 1,
      players: [
        createPlayer(0, "You", ["Princess"]),
        createPlayer(1, "Bot", ["Priest", "Baron"]),
      ],
    });
    const currentState = createTestState({
      currentPlayerIndex: 1,
      players: [
        createPlayer(0, "You", ["Princess"]),
        createPlayer(1, "Bot", ["Priest", "Baron"]),
      ],
    });
    currentState.discardPile = [
      { playerId: 0, card: "Guard", faceUp: true },
    ];
    currentState.log = [
      {
        type: "card-played",
        playerId: 0,
        card: "Guard",
        targetId: 1,
        guess: "Prince",
      },
    ];
    const previousView = getPlayerView(previousState, 1);
    const currentView = getPlayerView(currentState, 1);
    const previousRanges = [
      {
        playerId: 0,
        cards: [
          { card: "Princess" as const, probability: 0.9 },
          { card: "Guard" as const, probability: 0.1 },
        ],
        entropy: 0.47,
        source: "inferred" as const,
      },
    ];

    const updated = updateOpponentRanges(
      previousView,
      previousRanges,
      currentView,
      null,
    )[0];
    const stateless = getOpponentRange(currentView, 0);
    const updatedPrincess = updated.cards.find(
      (entry) => entry.card === "Princess",
    )?.probability;
    const statelessPrincess = stateless?.cards.find(
      (entry) => entry.card === "Princess",
    )?.probability;

    expect(updatedPrincess).toBeGreaterThan(statelessPrincess ?? 0);
  });

  it("uses skipped Handmaid and Baron plays as Bayesian range evidence", () => {
    const previousState = createTestState({
      currentPlayerIndex: 1,
      players: [
        createPlayer(0, "You", ["Baron"]),
        createPlayer(1, "Bot", ["Priest", "King"]),
      ],
    });
    const currentState = createTestState({
      currentPlayerIndex: 1,
      players: [
        createPlayer(0, "You", ["Baron"]),
        createPlayer(1, "Bot", ["Priest", "King"]),
      ],
    });
    currentState.discardPile = [{ playerId: 0, card: "Guard", faceUp: true }];
    currentState.log = [
      {
        type: "card-played",
        playerId: 0,
        card: "Guard",
        targetId: 1,
        guess: "Prince",
      },
    ];

    const prior = [{
      playerId: 0,
      cards: [
        { card: "Handmaid" as const, probability: 0.5 },
        { card: "Baron" as const, probability: 0.5 },
      ],
      entropy: 1,
      source: "inferred" as const,
    }];
    const previousView = getPlayerView(previousState, 1);
    const currentView = getPlayerView(currentState, 1);
    const humanRange = updateOpponentRanges(
      previousView,
      prior,
      currentView,
      null,
      HUMAN_TENDENCY_MODEL,
    )[0];
    const balancedRange = updateOpponentRanges(
      previousView,
      prior,
      currentView,
      null,
      BALANCED_OPPONENT_MODEL,
    )[0];
    const probability = (range: typeof humanRange, card: Card) =>
      range.cards.find((entry) => entry.card === card)?.probability ?? 0;

    expect(probability(humanRange, "Handmaid")).toBeLessThan(
      probability(balancedRange, "Handmaid"),
    );
    expect(probability(humanRange, "Baron")).toBeGreaterThan(
      probability(balancedRange, "Baron"),
    );
    expect(humanRange.evidence).toMatchObject({
      observedCard: "Guard",
      modelId: "human-tendencies",
    });
  });

  it("models a skipped Handmaid as less likely than a skipped Baron", () => {
    const heldHandmaid = retainedCardLikelihood(
      "Guard",
      "Handmaid",
      HUMAN_TENDENCY_MODEL,
    );
    const heldBaron = retainedCardLikelihood(
      "Guard",
      "Baron",
      HUMAN_TENDENCY_MODEL,
    );

    expect(heldHandmaid).toBeLessThan(0.4);
    expect(heldBaron).toBeGreaterThan(0.7);
  });
});

describe("hidden-world sampling", () => {
  it("only creates worlds consistent with the visible card inventory", () => {
    const state = drawCardForCurrentPlayer(
      createInitialGame({ playerNames: ["You", "Bot"], seed: 19 }),
    );
    const view = getPlayerView(state, 0);
    const samples = sampleConsistentStates(view, 64, createSeededRandom(31));
    const expectedDeck = sortCards([...CLASSIC_DECK]);

    expect(samples).toHaveLength(64);
    for (const sample of samples) {
      const sampledDeck = sortCards([
        ...sample.players.flatMap((player) => player.hand),
        ...sample.deck,
        ...(sample.burnedCard ? [sample.burnedCard] : []),
        ...sample.visibleBurnedCards,
        ...sample.discardPile.map((entry) => entry.card),
      ]);

      expect(sampledDeck).toEqual(expectedDeck);
      expect(sample.players[0].hand).toEqual(view.myHand);
      expect(sample.deck).toHaveLength(view.cardsRemaining);
    }
  });

  it("feeds consistent worlds into the Monte Carlo bot", () => {
    const opening = createInitialGame({
      playerNames: ["You", "Bot"],
      seed: 23,
    });
    opening.currentPlayerIndex = 1;
    const state = drawCardForCurrentPlayer(opening);
    const view = getPlayerView(state, 1);
    const legalActions = getLegalActions(state);
    const bot = createBeliefBot(7, {
      rolloutBudget: 64,
      minSamplesPerAction: 16,
      maxSamplesPerAction: 16,
    });

    const action = bot.chooseAction(view, legalActions);
    const analysis = bot.getLastAnalysis();

    expect(legalActions).toContainEqual(action);
    expect(analysis?.sampledWorlds).toBe(16);
    expect(analysis?.ranges).toHaveLength(1);
    expect(
      analysis?.ranges[0].cards.reduce(
        (total, entry) => total + entry.probability,
        0,
      ),
    ).toBeCloseTo(1);
    expect(
      analysis?.actions.reduce(
        (total, entry) => total + entry.strategyProbability,
        0,
      ),
    ).toBeCloseTo(1);
  });

  it("plays complete sampled rounds without reading hidden state", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      let state = createInitialGame({ playerNames: ["You", "Bot"], seed });
      const bot = createBeliefBot(seed * 13, {
        rolloutBudget: 64,
        minSamplesPerAction: 16,
        maxSamplesPerAction: 16,
      });
      const humanRandom = createSeededRandom(seed * 29);

      for (let step = 0; step < 80 && state.phase !== "round-over"; step += 1) {
        if (state.phase === "awaiting-turn-draw") {
          state = drawCardForCurrentPlayer(state);
          continue;
        }

        const actions = getLegalActions(state);
        const action = state.currentPlayerIndex === 1
          ? bot.chooseAction(getPlayerView(state, 1), actions)
          : actions[Math.floor(humanRandom() * actions.length)] ?? actions[0];
        state = applyAction(state, action);
      }

      expect(state.phase).toBe("round-over");
      expect(state.roundWinnerId).not.toBeNull();
    }
  });
});

function sortCards(cards: Card[]) {
  return cards.sort((left, right) => left.localeCompare(right));
}
