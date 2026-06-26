import { CLASSIC_DECK, RULESET_BY_PLAYER_COUNT } from "./constants";
import { shuffleWithSeed } from "./random";
import type { Card, CreateInitialGameOptions, GameState, Ruleset } from "./types";

function inferRuleset(playerCount: number): Ruleset {
  const ruleset = RULESET_BY_PLAYER_COUNT[playerCount];

  if (!ruleset) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }

  return ruleset;
}

export function createInitialGame(options: CreateInitialGameOptions): GameState {
  const seed = options.seed ?? 1;
  return createRoundState({
    playerNames: options.playerNames,
    playerTokens: options.playerNames.map(() => 0),
    roundNumber: 1,
    seed,
    startingPlayerIndex: 0,
    ruleset: inferRuleset(options.playerNames.length),
  });
}

type CreateRoundStateOptions = {
  playerNames: string[];
  playerTokens: number[];
  roundNumber: number;
  seed: number;
  startingPlayerIndex: number;
  ruleset: Ruleset;
};

function createRoundState(options: CreateRoundStateOptions): GameState {
  const shuffledDeck = shuffleWithSeed(CLASSIC_DECK, options.seed);
  const deck = [...shuffledDeck];
  const burnedCard = deck.shift() ?? null;
  const visibleBurnedCards: Card[] = [];

  if (options.ruleset === "classic-2p") {
    for (let index = 0; index < 3; index += 1) {
      const visibleCard = deck.shift();
      if (!visibleCard) {
        throw new Error("Deck underflow while preparing 2-player round.");
      }
      visibleBurnedCards.push(visibleCard);
    }
  }

  const players = options.playerNames.map((name, id) => {
    const openingCard = deck.shift();
    if (!openingCard) {
      throw new Error("Deck underflow while dealing opening hands.");
    }

    return {
      id,
      name,
      hand: [openingCard],
      protected: false,
      eliminated: false,
      tokens: options.playerTokens[id] ?? 0,
      seenCards: {},
    };
  });

  return {
    players,
    currentPlayerIndex: options.startingPlayerIndex,
    deck,
    burnedCard,
    visibleBurnedCards,
    discardPile: [],
    phase: "awaiting-turn-draw",
    roundNumber: options.roundNumber,
    roundWinnerId: null,
    gameWinnerId: null,
    ruleset: options.ruleset,
    pendingAction: null,
    log: [{ type: "turn-started", playerId: options.startingPlayerIndex }],
    seed: options.seed,
  };
}

export function createNextRound(previousState: GameState): GameState {
  const winnerId = previousState.roundWinnerId;
  const startingPlayerIndex =
    winnerId === null
      ? previousState.currentPlayerIndex
      : previousState.players.findIndex((player) => player.id === winnerId);

  return createRoundState({
    playerNames: previousState.players.map((player) => player.name),
    playerTokens: previousState.players.map((player) => player.tokens),
    roundNumber: previousState.roundNumber + 1,
    seed: previousState.seed + 1,
    startingPlayerIndex:
      startingPlayerIndex >= 0 ? startingPlayerIndex : previousState.currentPlayerIndex,
    ruleset: previousState.ruleset,
  });
}
