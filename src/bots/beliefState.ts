import { CARD_VALUES, CLASSIC_DECK } from "../engine/constants";
import {
  HUMAN_TENDENCY_MODEL,
  retainedCardLikelihood,
} from "./opponentModel";
import type { OpponentModel } from "./opponentModel";
import type {
  Card,
  GameState,
  PlayCardAction,
  PlayerView,
  PublicGameEvent,
} from "../engine/types";

export type RangeCard = {
  card: Card;
  probability: number;
};

export type OpponentRange = {
  playerId: number;
  cards: RangeCard[];
  entropy: number;
  source: "known" | "inferred";
  evidence?: ActionRangeEvidence;
};

export type ActionRangeEvidence = {
  observedCard: Card;
  modelId: OpponentModel["id"];
  modelLabel: string;
  retainedCardLikelihoods: RangeCard[];
};

export type ActionRangeEvaluation = {
  targetId?: number;
  expectedTargetValue: number;
  hitProbability: number;
  winProbability: number;
  tieProbability: number;
  lossProbability: number;
  princessProbability: number;
};

type RandomSource = () => number;

export function inferOpponentRanges(
  view: PlayerView,
  opponentModel: OpponentModel = HUMAN_TENDENCY_MODEL,
): OpponentRange[] {
  return inferOpponentRangesFromView(view, true, opponentModel);
}

~export function updateOpponentRanges(
  previousView: PlayerView | null,
  previousRanges: OpponentRange[],
  currentView: PlayerView,
  lastOwnAction: PlayCardAction | null,
  opponentModel: OpponentModel = HUMAN_TENDENCY_MODEL,
): OpponentRange[] {
  const fallbackRanges = inferOpponentRanges(currentView, opponentModel);
  if (!previousView || previousView.roundNumber !== currentView.roundNumber) {
    return fallbackRanges;
  }

  const inventoryRanges = inferOpponentRangesFromView(
    currentView,
    false,
    opponentModel,
  );
  const newEvents = currentView.log.slice(previousView.log.length);

  return fallbackRanges.map((fallbackRange) => {
    if (fallbackRange.source === "known") {
      return fallbackRange;
    }

    const previousRange = previousRanges.find(
      (range) => range.playerId === fallbackRange.playerId,
    );
    const inventoryRange = inventoryRanges.find(
      (range) => range.playerId === fallbackRange.playerId,
    );
    const latestPlay = [...newEvents]
      .reverse()
      .find(
        (event): event is Extract<PublicGameEvent, { type: "card-played" }> =>
          event.type === "card-played" && event.playerId === fallbackRange.playerId,
      );

    if (
      !previousRange ||
      !inventoryRange ||
      !latestPlay ||
      actionReplacedHand(lastOwnAction, fallbackRange.playerId) ||
      latestPlay.card === "King" ||
      (latestPlay.card === "Prince" && latestPlay.targetId === fallbackRange.playerId)
    ) {
      return fallbackRange;
    }

    return transitionRange(
      previousRange,
      inventoryRange,
      latestPlay,
      currentView,
      opponentModel,
    );
  });
}

function inferOpponentRangesFromView(
  view: PlayerView,
  useActionEvidence: boolean,
  opponentModel: OpponentModel,
): OpponentRange[] {
  const myId = view.players[view.myIndex]?.id;
  const unseenCards = getUnseenCards(view);

  return view.players
    .filter((player) => player.id !== myId && !player.eliminated && player.handSize > 0)
    .map((player) => {
      const knownCard = view.knownCards[player.id];
      if (knownCard) {
        return {
          playerId: player.id,
          cards: [{ card: knownCard, probability: 1 }],
          entropy: 0,
          source: "known" as const,
        };
      }

      const cardsReservedForOthers = Object.entries(view.knownCards)
        .filter(([playerId]) => Number(playerId) !== player.id)
        .map(([, card]) => card)
        .filter((card): card is Card => card !== undefined);
      const availableCards = [...unseenCards];
      for (const card of cardsReservedForOthers) {
        removeOne(availableCards, card);
      }

      const lastPlay = useActionEvidence
        ? findLastRetainedCardPlay(view.log, player.id)
        : null;
      const weightedCards = uniqueCards(availableCards).map((card) => {
        const copies = availableCards.filter((candidate) => candidate === card).length;
        const actionLikelihood = lastPlay
          ? retainedCardLikelihood(lastPlay.card, card, opponentModel)
          : 1;

        return { card, weight: copies * actionLikelihood };
      });
      const totalWeight = weightedCards.reduce((total, entry) => total + entry.weight, 0);
      const cards = weightedCards
        .map(({ card, weight }) => ({
          card,
          probability: totalWeight > 0 ? weight / totalWeight : 0,
        }))
        .filter((entry) => entry.probability > 0)
        .sort((left, right) => right.probability - left.probability);

      return {
        playerId: player.id,
        cards,
        entropy: calculateEntropy(cards),
        source: "inferred" as const,
        evidence: lastPlay
          ? createActionEvidence(lastPlay.card, availableCards, opponentModel)
          : undefined,
      };
    });
}

export function getOpponentRange(
  view: PlayerView,
  playerId: number,
  opponentModel: OpponentModel = HUMAN_TENDENCY_MODEL,
): OpponentRange | null {
  return inferOpponentRanges(view, opponentModel)
    .find((range) => range.playerId === playerId) ?? null;
}

export function evaluateActionAgainstRange(
  view: PlayerView,
  action: PlayCardAction,
  ranges: OpponentRange[] = inferOpponentRanges(view),
): ActionRangeEvaluation {
  const range =
    action.targetId === undefined
      ? null
      : ranges.find((candidate) => candidate.playerId === action.targetId) ?? null;
  const retainedCard = getRetainedCard(view.myHand, action.card);
  const emptyEvaluation: ActionRangeEvaluation = {
    targetId: action.targetId,
    expectedTargetValue: 0,
    hitProbability: 0,
    winProbability: 0,
    tieProbability: 0,
    lossProbability: 0,
    princessProbability: 0,
  };

  if (!range || range.cards.length === 0) {
    return emptyEvaluation;
  }

  const expectedTargetValue = range.cards.reduce(
    (total, entry) => total + CARD_VALUES[entry.card] * entry.probability,
    0,
  );
  const princessProbability = probabilityOf(range, "Princess");

  if (action.card === "Guard" && action.guess) {
    return {
      ...emptyEvaluation,
      expectedTargetValue,
      princessProbability,
      hitProbability: probabilityOf(range, action.guess),
    };
  }

  if (action.card === "Baron" && retainedCard) {
    const retainedValue = CARD_VALUES[retainedCard];

    return {
      ...emptyEvaluation,
      expectedTargetValue,
      princessProbability,
      winProbability: range.cards
        .filter((entry) => retainedValue > CARD_VALUES[entry.card])
        .reduce((total, entry) => total + entry.probability, 0),
      tieProbability: range.cards
        .filter((entry) => retainedValue === CARD_VALUES[entry.card])
        .reduce((total, entry) => total + entry.probability, 0),
      lossProbability: range.cards
        .filter((entry) => retainedValue < CARD_VALUES[entry.card])
        .reduce((total, entry) => total + entry.probability, 0),
    };
  }

  return {
    ...emptyEvaluation,
    expectedTargetValue,
    princessProbability,
  };
}

export function sampleConsistentStates(
  view: PlayerView,
  count: number,
  nextRandom: RandomSource,
  ranges: OpponentRange[] = inferOpponentRanges(view),
): GameState[] {
  const states: GameState[] = [];

  for (let index = 0; index < count; index += 1) {
    const state = sampleConsistentState(view, ranges, nextRandom, index);
    if (state) {
      states.push(state);
    }
  }

  return states;
}

function sampleConsistentState(
  view: PlayerView,
  ranges: OpponentRange[],
  nextRandom: RandomSource,
  sampleIndex: number,
): GameState | null {
  const myPlayer = view.players[view.myIndex];
  if (!myPlayer) {
    return null;
  }

  const remainingCards = getUnseenCards(view);
  const sampledHands = new Map<number, Card[]>();
  sampledHands.set(myPlayer.id, [...view.myHand]);

  const opponents = view.players.filter((player) => player.id !== myPlayer.id);
  const knownOpponents = opponents.filter((player) => view.knownCards[player.id]);
  const unknownOpponents = opponents.filter((player) => !view.knownCards[player.id]);

  for (const player of [...knownOpponents, ...unknownOpponents]) {
    const hand: Card[] = [];
    const range = ranges.find((candidate) => candidate.playerId === player.id);

    for (let handIndex = 0; handIndex < player.handSize; handIndex += 1) {
      const knownCard = handIndex === 0 ? view.knownCards[player.id] : undefined;
      const card = knownCard ?? pickRangeCard(range, remainingCards, nextRandom);
      if (!card || !removeOne(remainingCards, card)) {
        return null;
      }
      hand.push(card);
    }

    sampledHands.set(player.id, hand);
  }

  const hiddenBurnCount = remainingCards.length - view.cardsRemaining;
  if (hiddenBurnCount < 0 || hiddenBurnCount > 1) {
    return null;
  }

  const burnedCard = hiddenBurnCount === 1
    ? removeAt(remainingCards, Math.floor(nextRandom() * remainingCards.length))
    : null;
  shuffleInPlace(remainingCards, nextRandom);
  if (remainingCards.length !== view.cardsRemaining) {
    return null;
  }

  return {
    players: view.players.map((player) => ({
      id: player.id,
      name: player.name,
      hand: sampledHands.get(player.id) ?? [],
      protected: player.protected,
      eliminated: player.eliminated,
      tokens: player.tokens,
      seenCards: player.id === myPlayer.id ? { ...view.knownCards } : {},
    })),
    currentPlayerIndex: view.currentPlayerIndex,
    deck: remainingCards,
    burnedCard,
    visibleBurnedCards: [...view.visibleBurnedCards],
    discardPile: view.publicDiscardPile.map((entry) => ({ ...entry })),
    phase: view.phase,
    roundNumber: view.roundNumber,
    roundWinnerId: null,
    gameWinnerId: null,
    ruleset: view.ruleset,
    pendingAction: null,
    log: view.log.map((event) => ({ ...event })),
    seed: sampleIndex + 1,
  };
}

function getUnseenCards(view: PlayerView) {
  const cards = [...CLASSIC_DECK];
  for (const card of [
    ...view.myHand,
    ...view.visibleBurnedCards,
    ...view.publicDiscardPile.map((entry) => entry.card),
  ]) {
    removeOne(cards, card);
  }
  return cards;
}

function findLastRetainedCardPlay(
  log: PublicGameEvent[],
  playerId: number,
) {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const event = log[index];
    if (!event || event.type !== "card-played") {
      continue;
    }

    if (
      (event.card === "King" &&
        (event.playerId === playerId || event.targetId === playerId)) ||
      (event.card === "Prince" && event.targetId === playerId)
    ) {
      return null;
    }

    if (event.playerId === playerId) {
      return event;
    }
  }

  return null;
}

function transitionRange(
  previousRange: OpponentRange,
  inventoryRange: OpponentRange,
  action: Extract<PublicGameEvent, { type: "card-played" }>,
  currentView: PlayerView,
  opponentModel: OpponentModel,
): OpponentRange {
  const previousProbabilities = new Map(
    previousRange.cards.map((entry) => [entry.card, entry.probability]),
  );
  const currentInventory = getUnseenCards(currentView);
  const playedPrior = previousProbabilities.get(action.card) ?? 0;
  const playedDrawWeight =
    currentInventory.filter((card) => card === action.card).length + 1;
  const weightedCards = inventoryRange.cards.map((entry) => {
    const retainedPrior = previousProbabilities.get(entry.card) ?? 0;
    const retainedDrawWeight = currentInventory.filter(
      (card) => card === entry.card,
    ).length;
    const transitionWeight =
      retainedPrior * playedDrawWeight + playedPrior * retainedDrawWeight;
    const modelWeight =
      transitionWeight *
      retainedCardLikelihood(action.card, entry.card, opponentModel);

    return {
      card: entry.card,
      // Keep a small inventory prior so surprising legal plays cannot make the
      // correct card permanently unreachable.
      weight: modelWeight * 0.9 + entry.probability * 0.1,
    };
  });
  const totalWeight = weightedCards.reduce((total, entry) => total + entry.weight, 0);
  const cards = weightedCards
    .map((entry) => ({
      card: entry.card,
      probability:
        totalWeight > 0 ? entry.weight / totalWeight : entry.weight,
    }))
    .filter((entry) => entry.probability > 0)
    .sort((left, right) => right.probability - left.probability);

  return {
    playerId: inventoryRange.playerId,
    cards,
    entropy: calculateEntropy(cards),
    source: "inferred",
    evidence: createActionEvidence(
      action.card,
      inventoryRange.cards.map((entry) => entry.card),
      opponentModel,
    ),
  };
}

function createActionEvidence(
  observedCard: Card,
  availableCards: Card[],
  opponentModel: OpponentModel,
): ActionRangeEvidence {
  return {
    observedCard,
    modelId: opponentModel.id,
    modelLabel: opponentModel.label,
    retainedCardLikelihoods: uniqueCards(availableCards)
      .map((card) => ({
        card,
        probability: retainedCardLikelihood(observedCard, card, opponentModel),
      }))
      .sort((left, right) => right.probability - left.probability),
  };
}

function actionReplacedHand(
  action: PlayCardAction | null,
  opponentId: number,
) {
  return Boolean(
    action &&
      action.targetId === opponentId &&
      (action.card === "Prince" || action.card === "King"),
  );
}

function pickRangeCard(
  range: OpponentRange | undefined,
  availableCards: Card[],
  nextRandom: RandomSource,
) {
  const candidates = (range?.cards ?? uniqueCards(availableCards))
    .map((entry) =>
      typeof entry === "string"
        ? { card: entry, probability: 1 }
        : entry,
    )
    .filter((entry) => availableCards.includes(entry.card));

  if (candidates.length === 0) {
    return undefined;
  }

  const totalWeight = candidates.reduce(
    (total, entry) => total + entry.probability,
    0,
  );
  let threshold = nextRandom() * totalWeight;

  for (const entry of candidates) {
    threshold -= entry.probability;
    if (threshold <= 0) {
      return entry.card;
    }
  }

  return candidates[candidates.length - 1]?.card;
}

function getRetainedCard(hand: Card[], playedCard: Card) {
  const remainingHand = [...hand];
  removeOne(remainingHand, playedCard);
  return remainingHand[0];
}

function probabilityOf(range: OpponentRange, card: Card) {
  return range.cards.find((entry) => entry.card === card)?.probability ?? 0;
}

function calculateEntropy(cards: RangeCard[]) {
  return cards.reduce(
    (entropy, entry) =>
      entry.probability > 0
        ? entropy - entry.probability * Math.log2(entry.probability)
        : entropy,
    0,
  );
}

function uniqueCards(cards: Card[]) {
  return [...new Set(cards)];
}

function removeOne(cards: Card[], card: Card) {
  const index = cards.indexOf(card);
  if (index < 0) {
    return false;
  }

  cards.splice(index, 1);
  return true;
}

function removeAt(cards: Card[], index: number) {
  if (index < 0 || index >= cards.length) {
    return null;
  }

  return cards.splice(index, 1)[0] ?? null;
}

function shuffleInPlace(cards: Card[], nextRandom: RandomSource) {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
}
