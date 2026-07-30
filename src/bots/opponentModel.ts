import type { Card } from "../engine/types";

export type OpponentModelId = "balanced" | "human-tendencies";

export type OpponentModel = {
  id: OpponentModelId;
  label: string;
  description: string;
  playWeights: Readonly<Record<Card, number>>;
  noise: number;
};

export const BALANCED_OPPONENT_MODEL: OpponentModel = {
  id: "balanced",
  label: "Balanced",
  description: "Assumes either legal card is about equally likely to be played.",
  playWeights: {
    Guard: 1,
    Priest: 1,
    Baron: 1,
    Handmaid: 1,
    Prince: 1,
    King: 1,
    Countess: 1,
    Princess: 0.01,
  },
  noise: 0.12,
};

export const HUMAN_TENDENCY_MODEL: OpponentModel = {
  id: "human-tendencies",
  label: "Human tendencies",
  description:
    "Expects frequent Handmaid plays and reluctant Baron plays, while allowing surprises.",
  playWeights: {
    Guard: 1,
    Priest: 0.9,
    Baron: 0.24,
    Handmaid: 2.6,
    Prince: 0.82,
    King: 0.55,
    Countess: 0.42,
    Princess: 0.01,
  },
  noise: 0.12,
};

export function getOpponentModel(id: string | undefined): OpponentModel {
  return id === BALANCED_OPPONENT_MODEL.id
    ? BALANCED_OPPONENT_MODEL
    : HUMAN_TENDENCY_MODEL;
}

export function retainedCardLikelihood(
  playedCard: Card,
  retainedCard: Card,
  model: OpponentModel,
) {
  if (playedCard === retainedCard) {
    return 1;
  }

  const forcedCountessPair =
    (playedCard === "Countess" &&
      (retainedCard === "King" || retainedCard === "Prince")) ||
    (retainedCard === "Countess" &&
      (playedCard === "King" || playedCard === "Prince"));

  if (forcedCountessPair) {
    return playedCard === "Countess" ? 0.995 : 0;
  }

  const playedWeight = model.playWeights[playedCard];
  const retainedWeight = model.playWeights[retainedCard];
  const modeledProbability = playedWeight / (playedWeight + retainedWeight);

  // Humans sometimes make unexpected choices. Mixing with a coin flip avoids
  // assigning zero posterior probability to an otherwise legal retained card.
  return modeledProbability * (1 - model.noise) + 0.5 * model.noise;
}
