export const CARD_NAMES = [
  "Guard",
  "Priest",
  "Baron",
  "Handmaid",
  "Prince",
  "King",
  "Countess",
  "Princess",
] as const;

export type Card = (typeof CARD_NAMES)[number];

export type Ruleset = "classic-2p" | "classic-3p" | "classic-4p";

export type RoundPhase =
  | "round-start"
  | "awaiting-turn-draw"
  | "awaiting-card-play"
  | "resolving-action"
  | "round-over"
  | "game-over";

export type PlayerState = {
  id: number;
  name: string;
  hand: Card[];
  protected: boolean;
  eliminated: boolean;
  tokens: number;
  seenCards: Partial<Record<number, Card>>;
};

export type DiscardEntry = {
  playerId: number;
  card: Card;
  faceUp: boolean;
};

export type PublicPlayerState = {
  id: number;
  name: string;
  eliminated: boolean;
  protected: boolean;
  discardPile: Card[];
  handSize: number;
  tokens: number;
};

export type PublicGameEvent =
  | { type: "turn-started"; playerId: number }
  | { type: "card-played"; playerId: number; card: Card; targetId?: number }
  | { type: "player-eliminated"; playerId: number; reason: string }
  | { type: "token-awarded"; playerId: number }
  | { type: "round-ended"; winnerId: number; reason: string };

export type GameEvent =
  | PublicGameEvent
  | { type: "card-revealed"; viewerId: number; targetId: number; card: Card }
  | { type: "card-drawn"; playerId: number; card: Card };

export type PendingAction =
  | null
  | {
      type: "play-card";
      playerId: number;
      card: Card;
      targetId?: number;
      guess?: Exclude<Card, "Guard">;
    };

export type GameState = {
  players: PlayerState[];
  currentPlayerIndex: number;
  deck: Card[];
  burnedCard: Card | null;
  visibleBurnedCards: Card[];
  discardPile: DiscardEntry[];
  phase: RoundPhase;
  roundNumber: number;
  roundWinnerId: number | null;
  gameWinnerId: number | null;
  ruleset: Ruleset;
  pendingAction: PendingAction;
  log: GameEvent[];
  seed: number;
};

export type PlayCardAction = {
  type: "play-card";
  playerId: number;
  card: Card;
  targetId?: number;
  guess?: Exclude<Card, "Guard">;
};

export type StartNextRoundAction = {
  type: "start-next-round";
};

export type PlayerAction = PlayCardAction | StartNextRoundAction;

export type PlayerView = {
  myIndex: number;
  myHand: Card[];
  players: PublicPlayerState[];
  publicDiscardPile: DiscardEntry[];
  cardsRemaining: number;
  currentPlayerIndex: number;
  phase: RoundPhase;
  log: PublicGameEvent[];
};

export type CreateInitialGameOptions = {
  playerNames: string[];
  seed?: number;
};
