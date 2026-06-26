import type { Card, Ruleset } from "./types";

export const CLASSIC_DECK: ReadonlyArray<Card> = [
  "Guard",
  "Guard",
  "Guard",
  "Guard",
  "Guard",
  "Priest",
  "Priest",
  "Baron",
  "Baron",
  "Handmaid",
  "Handmaid",
  "Prince",
  "Prince",
  "King",
  "Countess",
  "Princess",
];

export const CARD_VALUES: Record<Card, number> = {
  Guard: 1,
  Priest: 2,
  Baron: 3,
  Handmaid: 4,
  Prince: 5,
  King: 6,
  Countess: 7,
  Princess: 8,
};

export const RULESET_BY_PLAYER_COUNT: Record<number, Ruleset> = {
  2: "classic-2p",
  3: "classic-3p",
  4: "classic-4p",
};

export const TOKENS_TO_WIN_BY_RULESET: Record<Ruleset, number> = {
  "classic-2p": 7,
  "classic-3p": 5,
  "classic-4p": 4,
};
