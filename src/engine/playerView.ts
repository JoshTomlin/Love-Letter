import type { GameState, PlayerView, PublicGameEvent } from "./types";

function isPublicEvent(event: GameState["log"][number]): event is PublicGameEvent {
  return event.type !== "card-drawn" && event.type !== "card-revealed";
}

export function getPlayerView(state: GameState, playerIndex: number): PlayerView {
  const me = state.players[playerIndex];
  if (!me) {
    throw new Error(`No player exists at index ${playerIndex}.`);
  }

  return {
    myIndex: playerIndex,
    myHand: [...me.hand],
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      eliminated: player.eliminated,
      protected: player.protected,
      discardPile: state.discardPile
        .filter((entry) => entry.playerId === player.id && entry.faceUp)
        .map((entry) => entry.card),
      handSize: player.id === me.id ? player.hand.length : player.hand.length > 0 ? 1 : 0,
      tokens: player.tokens,
    })),
    publicDiscardPile: state.discardPile.filter((entry) => entry.faceUp),
    cardsRemaining: state.deck.length,
    currentPlayerIndex: state.currentPlayerIndex,
    phase: state.phase,
    log: state.log.filter(isPublicEvent),
  };
}
