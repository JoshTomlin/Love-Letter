import type { Card, GameState, PlayerState, RoundPhase, Ruleset } from "../types";

type CreateTestStateOptions = {
  currentPlayerIndex?: number;
  deck?: Card[];
  burnedCard?: Card | null;
  phase?: RoundPhase;
  ruleset?: Ruleset;
  players?: PlayerState[];
};

export function createTestState(options: CreateTestStateOptions = {}): GameState {
  return {
    players:
      options.players ??
      [
        createPlayer(0, "You", ["Guard", "Priest"]),
        createPlayer(1, "Bot", ["Baron"]),
      ],
    currentPlayerIndex: options.currentPlayerIndex ?? 0,
    deck: options.deck ?? ["Prince", "King"],
    burnedCard: options.burnedCard ?? "Princess",
    visibleBurnedCards: [],
    discardPile: [],
    phase: options.phase ?? "awaiting-card-play",
    roundNumber: 1,
    roundWinnerId: null,
    gameWinnerId: null,
    ruleset: options.ruleset ?? "classic-2p",
    pendingAction: null,
    log: [],
    seed: 1,
  };
}

export function createPlayer(
  id: number,
  name: string,
  hand: Card[],
  overrides: Partial<PlayerState> = {},
): PlayerState {
  return {
    id,
    name,
    hand,
    protected: false,
    eliminated: false,
    tokens: 0,
    seenCards: {},
    ...overrides,
  };
}
