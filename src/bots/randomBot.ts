import type { Bot } from "./botTypes";
import { CARD_VALUES, CLASSIC_DECK } from "../engine/constants";
import { createSeededRandom } from "../engine/random";
import type {
  Card,
  PlayCardAction,
  PlayerAction,
  PlayerView,
} from "../engine/types";

export function createSimpleBot(seed: number): Bot {
  const nextRandom = createSeededRandom(seed);

  return {
    id: "simple-bot",
    chooseAction(view, legalActions) {
      if (legalActions.length === 0) {
        throw new Error("Simple bot received no legal actions.");
      }

      const playActions = legalActions.filter(
        (action): action is PlayCardAction => action.type === "play-card",
      );
      if (playActions.length === 0) {
        return legalActions[0];
      }

      const safeActions = playActions.filter((action) => action.card !== "Princess");
      const candidates = safeActions.length > 0 ? safeActions : playActions;
      const scoredActions = candidates.map((action) => ({
        action,
        score: scoreAction(view, action),
      }));
      const highestScore = Math.max(...scoredActions.map(({ score }) => score));
      const bestActions = scoredActions.filter(({ score }) => score === highestScore);

      return pickRandomAction(
        bestActions.map(({ action }) => action),
        nextRandom(),
      );
    },
  };
}

// Kept as a compatibility alias for callers outside the app.
export function createRandomBot(seed: number): Bot {
  return createSimpleBot(seed);
}

function scoreAction(view: PlayerView, action: PlayCardAction) {
  const me = view.players[view.myIndex];
  const target = view.players.find((player) => player.id === action.targetId);
  const retainedCard = getRetainedCard(view.myHand, action.card);
  const range = target ? getCardRange(view, target.id) : [];
  const knownCard = target ? view.knownCards[target.id] : undefined;

  switch (action.card) {
    case "Guard": {
      if (!action.guess || !target) {
        return 4;
      }

      if (knownCard) {
        return action.guess === knownCard ? 1_000 : -100;
      }

      return 18 + probabilityOf(range, action.guess) * 100;
    }
    case "Priest":
      return target && !knownCard ? 55 : 8;
    case "Baron": {
      if (!target || !retainedCard || range.length === 0) {
        return 6;
      }

      const retainedValue = CARD_VALUES[retainedCard];
      const wins = range.filter((card) => retainedValue > CARD_VALUES[card]).length;
      const losses = range.filter((card) => retainedValue < CARD_VALUES[card]).length;
      const ties = range.length - wins - losses;

      return ((wins - losses) / range.length) * 90 + (ties / range.length) * 10;
    }
    case "Handmaid":
      return 34;
    case "Prince": {
      if (!target || target.id === me?.id) {
        return retainedCard === "Princess" ? -1_000 : 3;
      }

      if (knownCard === "Princess") {
        return 950;
      }

      return 30 + probabilityOf(range, "Princess") * 150;
    }
    case "King": {
      if (!target || !retainedCard || range.length === 0) {
        return 5;
      }

      const expectedTargetValue = averageValue(range);
      const princessEscape = retainedCard === "Princess" ? 70 : 0;
      return 18 + (expectedTargetValue - CARD_VALUES[retainedCard]) * 7 + princessEscape;
    }
    case "Countess":
      return 12;
    case "Princess":
      return -10_000;
  }
}

function getRetainedCard(hand: Card[], playedCard: Card) {
  const remainingHand = [...hand];
  const playedIndex = remainingHand.indexOf(playedCard);
  if (playedIndex >= 0) {
    remainingHand.splice(playedIndex, 1);
  }

  return remainingHand[0];
}

function getCardRange(view: PlayerView, targetId: number): Card[] {
  const knownCard = view.knownCards[targetId];
  if (knownCard) {
    return [knownCard];
  }

  const unseenCards = [...CLASSIC_DECK];
  for (const card of [
    ...view.myHand,
    ...view.visibleBurnedCards,
    ...view.publicDiscardPile.map((entry) => entry.card),
  ]) {
    removeOne(unseenCards, card);
  }

  return unseenCards;
}

function removeOne(cards: Card[], card: Card) {
  const index = cards.indexOf(card);
  if (index >= 0) {
    cards.splice(index, 1);
  }
}

function probabilityOf(cards: Card[], card: Card) {
  if (cards.length === 0) {
    return 0;
  }

  return cards.filter((candidate) => candidate === card).length / cards.length;
}

function averageValue(cards: Card[]) {
  if (cards.length === 0) {
    return 0;
  }

  return cards.reduce((total, card) => total + CARD_VALUES[card], 0) / cards.length;
}

function pickRandomAction(actions: PlayerAction[], randomValue: number) {
  const index = Math.floor(randomValue * actions.length);
  return actions[index] ?? actions[0];
}
