import { describe, expect, it } from "vitest";
import { applyAction } from "../applyAction";
import { drawCardForCurrentPlayer } from "../turnFlow";
import { createTestState, createPlayer } from "./testUtils";

describe("applyAction", () => {
  it("eliminates a target on a correct Guard guess", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Guard", "Priest"]),
        createPlayer(1, "Bot", ["Baron"]),
      ],
      deck: ["King"],
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Guard",
      targetId: 1,
      guess: "Baron",
    });

    expect(nextState.phase).toBe("round-over");
    expect(nextState.roundWinnerId).toBe(0);
    expect(nextState.players[1].eliminated).toBe(true);
    expect(nextState.players[0].tokens).toBe(1);
  });

  it("records a private reveal for Priest", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Priest", "Guard"]),
        createPlayer(1, "Bot", ["King"]),
      ],
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Priest",
      targetId: 1,
    });

    expect(nextState.players[0].seenCards[1]).toBe("King");
    expect(nextState.log).toContainEqual({
      type: "card-revealed",
      viewerId: 0,
      targetId: 1,
      card: "King",
    });
    expect(nextState.currentPlayerIndex).toBe(1);
  });

  it("eliminates the lower hand on Baron", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Baron", "King"]),
        createPlayer(1, "Bot", ["Prince"]),
      ],
      deck: ["Guard"],
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Baron",
      targetId: 1,
    });

    expect(nextState.phase).toBe("round-over");
    expect(nextState.roundWinnerId).toBe(0);
    expect(nextState.players[1].eliminated).toBe(true);
  });

  it("applies Handmaid protection until the player's next draw", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Handmaid", "Guard"]),
        createPlayer(1, "Bot", ["Priest"]),
      ],
      deck: ["Baron", "Prince"],
    });

    const afterHandmaid = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Handmaid",
    });

    expect(afterHandmaid.players[0].protected).toBe(true);
    expect(afterHandmaid.currentPlayerIndex).toBe(1);

    const backToPlayerZero = {
      ...afterHandmaid,
      currentPlayerIndex: 0,
      phase: "awaiting-turn-draw" as const,
    };

    const afterDraw = drawCardForCurrentPlayer(backToPlayerZero);

    expect(afterDraw.players[0].protected).toBe(false);
  });

  it("makes Prince discard Princess and eliminate the target", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Prince", "Guard"]),
        createPlayer(1, "Bot", ["Princess"]),
      ],
      deck: ["Guard"],
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Prince",
      targetId: 1,
    });

    expect(nextState.phase).toBe("round-over");
    expect(nextState.players[1].eliminated).toBe(true);
    expect(nextState.discardPile).toContainEqual({
      playerId: 1,
      card: "Princess",
      faceUp: true,
    });
  });

  it("makes Prince discard and replace the player's hand when the opponent is protected", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Prince", "King"]),
        createPlayer(1, "Bot", ["Guard"], {
          protected: true,
          seenCards: { 0: "King" },
        }),
      ],
      deck: ["Priest", "Baron"],
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Prince",
      targetId: 0,
    });

    expect(nextState.players[0].hand).toEqual(["Priest"]);
    expect(nextState.players[1].hand).toEqual(["Guard"]);
    expect(nextState.players[1].seenCards[0]).toBeUndefined();
    expect(nextState.discardPile).toContainEqual({
      playerId: 0,
      card: "King",
      faceUp: true,
    });
  });

  it("eliminates a player who plays Princess", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Princess", "Guard"]),
        createPlayer(1, "Bot", ["Priest"]),
      ],
      deck: ["King"],
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Princess",
    });

    expect(nextState.phase).toBe("round-over");
    expect(nextState.roundWinnerId).toBe(1);
    expect(nextState.players[0].eliminated).toBe(true);
    expect(nextState.players[1].tokens).toBe(1);
  });

  it("uses the burned card when Prince forces a draw and the deck is empty", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Prince", "Guard"]),
        createPlayer(1, "Bot", ["Priest"]),
      ],
      deck: [],
      burnedCard: "King",
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Prince",
      targetId: 1,
    });

    expect(nextState.phase).toBe("round-over");
    expect(nextState.players[1].hand).toEqual(["King"]);
    expect(nextState.roundWinnerId).toBe(1);
  });

  it("swaps hands with King", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["King", "Guard"]),
        createPlayer(1, "Bot", ["Princess"]),
      ],
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "King",
      targetId: 1,
    });

    expect(nextState.players[0].hand).toEqual(["Princess"]);
    expect(nextState.players[1].hand).toEqual(["Guard"]);
    expect(nextState.players[0].seenCards[1]).toBe("Guard");
    expect(nextState.players[1].seenCards[0]).toBe("Princess");
  });

  it("does not swap hands with a protected player", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["King", "Guard"]),
        createPlayer(1, "Bot", ["Princess"], { protected: true }),
      ],
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "King",
    });

    expect(nextState.players[0].hand).toEqual(["Guard"]);
    expect(nextState.players[1].hand).toEqual(["Princess"]);
    expect(nextState.currentPlayerIndex).toBe(1);
  });

  it("ends the round on deck exhaustion using discard total as a tiebreaker", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Guard", "Countess"]),
        createPlayer(1, "Bot", ["Guard"]),
      ],
      deck: [],
      burnedCard: "Princess",
    });
    state.discardPile = [
      { playerId: 0, card: "Priest", faceUp: true },
      { playerId: 1, card: "Handmaid", faceUp: true },
    ];

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Countess",
    });

    expect(nextState.phase).toBe("round-over");
    expect(nextState.roundWinnerId).toBe(0);
    expect(nextState.players[0].tokens).toBe(1);
  });

  it("starts the next round with the previous winner and preserved tokens", () => {
    const roundOverState = createTestState({
      phase: "round-over",
      currentPlayerIndex: 1,
      players: [
        createPlayer(0, "You", ["Guard"], { tokens: 1 }),
        createPlayer(1, "Bot", ["King"], { tokens: 2 }),
      ],
    });
    roundOverState.roundWinnerId = 1;

    const nextRound = applyAction(roundOverState, {
      type: "start-next-round",
    });

    expect(nextRound.roundNumber).toBe(2);
    expect(nextRound.currentPlayerIndex).toBe(1);
    expect(nextRound.players[0].tokens).toBe(1);
    expect(nextRound.players[1].tokens).toBe(2);
    expect(nextRound.phase).toBe("awaiting-turn-draw");
  });

  it("ends the game when a 2-player winner reaches 7 tokens", () => {
    const state = createTestState({
      players: [
        createPlayer(0, "You", ["Guard", "Priest"], { tokens: 6 }),
        createPlayer(1, "Bot", ["Baron"]),
      ],
      deck: ["King"],
    });

    const nextState = applyAction(state, {
      type: "play-card",
      playerId: 0,
      card: "Guard",
      targetId: 1,
      guess: "Baron",
    });

    expect(nextState.phase).toBe("game-over");
    expect(nextState.roundWinnerId).toBe(0);
    expect(nextState.gameWinnerId).toBe(0);
    expect(nextState.players[0].tokens).toBe(7);
  });
});
