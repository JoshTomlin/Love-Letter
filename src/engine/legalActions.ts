import { CARD_NAMES } from "./types";
import type { Card, GameState, PlayCardAction, PlayerAction } from "./types";

function getOpponents(state: GameState, playerId: number) {
  return state.players.filter(
    (player) => player.id !== playerId && !player.eliminated && !player.protected,
  );
}

function requiresForcedCountess(hand: Card[]) {
  return (
    hand.includes("Countess") &&
    (hand.includes("King") || hand.includes("Prince"))
  );
}

export function getLegalActions(state: GameState): PlayerAction[] {
  if (state.phase === "round-over") {
    return [{ type: "start-next-round" }];
  }

  if (state.phase !== "awaiting-card-play") {
    return [];
  }

  const activePlayer = state.players[state.currentPlayerIndex];
  if (!activePlayer || activePlayer.eliminated) {
    return [];
  }

  const hand = activePlayer.hand;
  const playableCards = requiresForcedCountess(hand)
    ? hand.filter((card) => card === "Countess")
    : hand;

  return playableCards.flatMap((card) =>
    expandCardActions(state, activePlayer.id, card),
  );
}

function expandCardActions(
  state: GameState,
  playerId: number,
  card: Card,
): PlayCardAction[] {
  const opponents = getOpponents(state, playerId);

  if (card === "Guard") {
    if (opponents.length === 0) {
      return [{ type: "play-card", playerId, card }];
    }

    return opponents.flatMap((target) =>
      CARD_NAMES.filter((candidate) => candidate !== "Guard").map((guess) => ({
        type: "play-card" as const,
        playerId,
        card,
        targetId: target.id,
        guess,
      })),
    );
  }

  if (card === "Priest" || card === "Baron" || card === "King") {
    if (opponents.length === 0) {
      return [{ type: "play-card", playerId, card }];
    }

    return opponents.map((target) => ({
      type: "play-card",
      playerId,
      card,
      targetId: target.id,
    }));
  }

  if (card === "Prince") {
    return state.players
      .filter((player) => !player.eliminated && (player.id === playerId || !player.protected))
      .map((target) => ({
        type: "play-card",
        playerId,
        card,
        targetId: target.id,
      }));
  }

  return [{ type: "play-card", playerId, card }];
}
