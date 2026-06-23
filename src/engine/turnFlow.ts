import type { Card, GameState } from "./types";

export function drawCardForCurrentPlayer(state: GameState): GameState {
  if (state.phase !== "awaiting-turn-draw") {
    throw new Error(`Cannot draw during phase ${state.phase}.`);
  }

  const activePlayer = state.players[state.currentPlayerIndex];
  if (!activePlayer || activePlayer.eliminated) {
    throw new Error("Current player is invalid or eliminated.");
  }

  let drawnCard: Card | null = state.deck[0] ?? null;
  let nextDeck = state.deck.slice(1);

  if (!drawnCard) {
    drawnCard = state.burnedCard;
    nextDeck = [];
  }

  if (!drawnCard) {
    throw new Error("No card available to draw.");
  }

  const players = state.players.map((player, index) =>
    index === state.currentPlayerIndex
      ? { ...player, protected: false, hand: [...player.hand, drawnCard] }
      : player,
  );

  return {
    ...state,
    players,
    deck: nextDeck,
    burnedCard: state.deck.length === 0 ? null : state.burnedCard,
    phase: "awaiting-card-play",
    log: [...state.log, { type: "card-drawn", playerId: activePlayer.id, card: drawnCard }],
  };
}
