import { CARD_VALUES, TOKENS_TO_WIN_BY_RULESET } from "./constants";
import { getLegalActions } from "./legalActions";
import { createNextRound } from "./setupRound";
import type { Card, GameState, PlayCardAction, PlayerAction, PlayerState } from "./types";

export function applyAction(state: GameState, action: PlayerAction): GameState {
  if (action.type === "start-next-round") {
    if (state.phase !== "round-over") {
      throw new Error("Cannot start the next round before the current round ends.");
    }

    return createNextRound(state);
  }

  if (state.phase !== "awaiting-card-play") {
    throw new Error(`Cannot apply ${action.type} during phase ${state.phase}.`);
  }

  if (action.playerId !== state.players[state.currentPlayerIndex]?.id) {
    throw new Error("Only the current player can act.");
  }

  if (!isLegalAction(state, action)) {
    throw new Error("Action is not legal in the current state.");
  }

  const actorIndex = state.currentPlayerIndex;
  const updatedPlayers = state.players.map((player, index) =>
    index === actorIndex
      ? {
          ...player,
          hand: removeCardFromHand(player.hand, action.card),
        }
      : player,
  );
  let nextState: GameState = {
    ...state,
    players: updatedPlayers,
    discardPile: [
      ...state.discardPile,
      { playerId: action.playerId, card: action.card, faceUp: true },
    ],
    log: [
      ...state.log,
      {
        type: "card-played" as const,
        playerId: action.playerId,
        card: action.card,
        targetId: action.targetId,
      },
    ],
  };

  nextState = updateKnownCardAfterPlay(nextState, action.playerId);
  nextState = resolveCardEffect(nextState, action);

  if (hasOneActivePlayer(nextState.players)) {
    return finishRound(nextState, getOnlyActivePlayer(nextState.players)!.id, "last-player-standing");
  }

  if (nextState.deck.length === 0) {
    const winner = determineDeckEmptyWinner(nextState.players, nextState.discardPile);
    return finishRound(nextState, winner.id, "deck-empty");
  }

  return advanceToNextTurn(nextState);
}

function isLegalAction(state: GameState, action: PlayCardAction) {
  return getLegalActions(state).some(
    (candidate) =>
      candidate.type === action.type &&
      candidate.playerId === action.playerId &&
      candidate.card === action.card &&
      candidate.targetId === action.targetId &&
      candidate.guess === action.guess,
  );
}

function removeCardFromHand(hand: Card[], card: Card) {
  const index = hand.indexOf(card);
  if (index === -1) {
    throw new Error(`Card ${card} is not in hand.`);
  }

  return [...hand.slice(0, index), ...hand.slice(index + 1)];
}

function resolveCardEffect(state: GameState, action: PlayCardAction): GameState {
  switch (action.card) {
    case "Guard":
      return resolveGuard(state, action);
    case "Priest":
      return resolvePriest(state, action);
    case "Baron":
      return resolveBaron(state, action);
    case "Handmaid":
      return updatePlayer(state, action.playerId, (player) => ({
        ...player,
        protected: true,
      }));
    case "Prince":
      return resolvePrince(state, action);
    case "King":
      return resolveKing(state, action);
    case "Countess":
      return state;
    case "Princess":
      return eliminatePlayer(state, action.playerId, "discarded-princess");
    default:
      return assertNever(action.card);
  }
}

function resolveGuard(state: GameState, action: PlayCardAction) {
  if (action.targetId === undefined || action.guess === undefined) {
    return state;
  }

  const target = getPlayerById(state, action.targetId);
  if (!target || target.eliminated || target.protected || target.hand.length === 0) {
    return state;
  }

  if (target.hand[0] !== action.guess) {
    return state;
  }

  return eliminatePlayer(state, target.id, "guard-correct-guess");
}

function resolvePriest(state: GameState, action: PlayCardAction) {
  if (action.targetId === undefined) {
    return state;
  }

  const target = getPlayerById(state, action.targetId);
  if (!target || target.eliminated || target.protected || target.hand.length === 0) {
    return state;
  }

  const viewer = getPlayerById(state, action.playerId);
  if (!viewer) {
    return state;
  }

  const players = state.players.map((player) =>
    player.id === action.playerId
      ? {
          ...player,
          seenCards: {
            ...player.seenCards,
            [target.id]: target.hand[0],
          },
        }
      : player,
  );

  return {
    ...state,
    players,
    log: [
      ...state.log,
      {
        type: "card-revealed",
        viewerId: viewer.id,
        targetId: target.id,
        card: target.hand[0],
      } as const,
    ],
  };
}

function resolveBaron(state: GameState, action: PlayCardAction) {
  if (action.targetId === undefined) {
    return state;
  }

  const actor = getPlayerById(state, action.playerId);
  const target = getPlayerById(state, action.targetId);
  if (!actor || !target || target.eliminated || target.protected) {
    return state;
  }

  const actorCard = actor.hand[0];
  const targetCard = target.hand[0];
  if (!actorCard || !targetCard) {
    return state;
  }

  const actorValue = CARD_VALUES[actorCard];
  const targetValue = CARD_VALUES[targetCard];

  if (actorValue === targetValue) {
    return state;
  }

  return actorValue > targetValue
    ? eliminatePlayer(state, target.id, "baron-lower-card")
    : eliminatePlayer(state, actor.id, "baron-lower-card");
}

function resolvePrince(state: GameState, action: PlayCardAction) {
  if (action.targetId === undefined) {
    return state;
  }

  const target = getPlayerById(state, action.targetId);
  if (!target || target.eliminated || target.hand.length === 0) {
    return state;
  }

  const discardedCard = target.hand[0];
  let nextState = updatePlayer(state, target.id, (player) => ({
    ...player,
    hand: [],
  }));
  nextState = clearKnownCard(nextState, target.id);
  nextState = {
    ...nextState,
    discardPile: [
      ...nextState.discardPile,
      { playerId: target.id, card: discardedCard, faceUp: true },
    ],
  };

  if (discardedCard === "Princess") {
    return eliminatePlayer(nextState, target.id, "discarded-princess");
  }

  const drawResult = drawReplacementCard(nextState);
  if (!drawResult.card) {
    return nextState;
  }

  return updatePlayer(drawResult.state, target.id, (player) => ({
    ...player,
    hand: [drawResult.card],
  }));
}

function resolveKing(state: GameState, action: PlayCardAction) {
  if (action.targetId === undefined) {
    return state;
  }

  const actor = getPlayerById(state, action.playerId);
  const target = getPlayerById(state, action.targetId);
  if (!actor || !target || target.eliminated || target.protected) {
    return state;
  }

  const actorHand = [...actor.hand];
  const targetHand = [...target.hand];

  let nextState: GameState = {
    ...state,
    players: state.players.map((player) => {
      if (player.id === actor.id) {
        return { ...player, hand: targetHand };
      }

      if (player.id === target.id) {
        return { ...player, hand: actorHand };
      }

      return player;
    }),
  };

  nextState = clearKnownCard(clearKnownCard(nextState, actor.id), target.id);

  return {
    ...nextState,
    players: nextState.players.map((player) => {
      if (player.id === actor.id && actorHand[0]) {
        return {
          ...player,
          seenCards: { ...player.seenCards, [target.id]: actorHand[0] },
        };
      }

      if (player.id === target.id && targetHand[0]) {
        return {
          ...player,
          seenCards: { ...player.seenCards, [actor.id]: targetHand[0] },
        };
      }

      return player;
    }),
  };
}

function drawReplacementCard(state: GameState) {
  if (state.deck.length > 0) {
    return {
      state: {
        ...state,
        deck: state.deck.slice(1),
      },
      card: state.deck[0],
    };
  }

  if (state.burnedCard) {
    return {
      state: {
        ...state,
        burnedCard: null,
      },
      card: state.burnedCard,
    };
  }

  return { state, card: null };
}

function eliminatePlayer(state: GameState, playerId: number, reason: string) {
  const player = getPlayerById(state, playerId);
  if (!player) {
    return state;
  }

  const revealedCards = player.hand.map((card) => ({
    playerId,
    card,
    faceUp: true as const,
  }));

  return {
    ...state,
    players: state.players.map((candidate) =>
      candidate.id === playerId
        ? { ...candidate, hand: [], eliminated: true, protected: false }
        : candidate,
    ),
    discardPile: [...state.discardPile, ...revealedCards],
    log: [
      ...state.log,
      { type: "player-eliminated" as const, playerId, reason },
    ],
  };
}

function finishRound(state: GameState, winnerId: number, reason: string): GameState {
  const players = state.players.map((player) =>
    player.id === winnerId
      ? { ...player, tokens: player.tokens + 1 }
      : player,
  );
  const winner = players.find((player) => player.id === winnerId);
  const tokensToWin = TOKENS_TO_WIN_BY_RULESET[state.ruleset];
  const gameWinnerId = winner && winner.tokens >= tokensToWin ? winnerId : null;

  return {
    ...state,
    players,
    roundWinnerId: winnerId,
    gameWinnerId,
    phase: gameWinnerId === null ? "round-over" : "game-over",
    pendingAction: null,
    log: [
      ...state.log,
      { type: "token-awarded" as const, playerId: winnerId },
      { type: "round-ended" as const, winnerId, reason },
    ],
  };
}

function advanceToNextTurn(state: GameState): GameState {
  const nextPlayerIndex = findNextActivePlayerIndex(state.players, state.currentPlayerIndex);

  return {
    ...state,
    currentPlayerIndex: nextPlayerIndex,
    phase: "awaiting-turn-draw",
    pendingAction: null,
    log: [
      ...state.log,
      { type: "turn-started" as const, playerId: state.players[nextPlayerIndex].id },
    ],
  };
}

function findNextActivePlayerIndex(players: PlayerState[], currentPlayerIndex: number) {
  for (let offset = 1; offset <= players.length; offset += 1) {
    const candidateIndex = (currentPlayerIndex + offset) % players.length;
    if (!players[candidateIndex]?.eliminated) {
      return candidateIndex;
    }
  }

  return currentPlayerIndex;
}

function hasOneActivePlayer(players: PlayerState[]) {
  return players.filter((player) => !player.eliminated).length === 1;
}

function getOnlyActivePlayer(players: PlayerState[]) {
  return players.find((player) => !player.eliminated) ?? null;
}

function determineDeckEmptyWinner(players: PlayerState[], discardPile: GameState["discardPile"]) {
  const activePlayers = players.filter((player) => !player.eliminated);
  if (activePlayers.length === 0) {
    throw new Error("Cannot determine a winner with no active players.");
  }

  return [...activePlayers].sort((left, right) => {
    const handValueDifference =
      CARD_VALUES[right.hand[0] ?? "Guard"] - CARD_VALUES[left.hand[0] ?? "Guard"];

    if (handValueDifference !== 0) {
      return handValueDifference;
    }

    return getDiscardValueTotal(discardPile, right.id) - getDiscardValueTotal(discardPile, left.id);
  })[0];
}

function getDiscardValueTotal(discardPile: GameState["discardPile"], playerId: number) {
  return discardPile
    .filter((entry) => entry.playerId === playerId)
    .reduce((total, entry) => total + CARD_VALUES[entry.card], 0);
}

function getPlayerById(state: GameState, playerId: number) {
  return state.players.find((player) => player.id === playerId) ?? null;
}

function updatePlayer(
  state: GameState,
  playerId: number,
  updater: (player: PlayerState) => PlayerState,
) {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId ? updater(player) : player,
    ),
  };
}

function updateKnownCardAfterPlay(state: GameState, playerId: number): GameState {
  const player = getPlayerById(state, playerId);
  if (!player) {
    return state;
  }

  return {
    ...state,
    players: state.players.map((observer) => {
      const knownCard = observer.seenCards[playerId];
      if (!knownCard || player.hand.includes(knownCard)) {
        return observer;
      }

      return {
        ...observer,
        seenCards: removeKnownCard(observer.seenCards, playerId),
      };
    }),
  };
}

function clearKnownCard(state: GameState, playerId: number): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      seenCards: removeKnownCard(player.seenCards, playerId),
    })),
  };
}

function removeKnownCard(
  seenCards: PlayerState["seenCards"],
  playerId: number,
) {
  const nextSeenCards = { ...seenCards };
  delete nextSeenCards[playerId];
  return nextSeenCards;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled card: ${String(value)}`);
}
