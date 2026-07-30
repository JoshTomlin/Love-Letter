import type { Bot } from "./botTypes";
import {
  evaluateActionAgainstRange,
  inferOpponentRanges,
  sampleConsistentStates,
  updateOpponentRanges,
} from "./beliefState";
import type { ActionRangeEvaluation, OpponentRange } from "./beliefState";
import { HUMAN_TENDENCY_MODEL } from "./opponentModel";
import type { OpponentModel } from "./opponentModel";
import { CARD_VALUES } from "../engine/constants";
import { applyAction } from "../engine/applyAction";
import { getLegalActions } from "../engine/legalActions";
import { getPlayerView } from "../engine/playerView";
import { createSeededRandom } from "../engine/random";
import { drawCardForCurrentPlayer } from "../engine/turnFlow";
import type {
  Card,
  GameState,
  PlayCardAction,
  PlayerView,
} from "../engine/types";

export type BeliefBotOptions = {
  rolloutBudget?: number;
  minSamplesPerAction?: number;
  maxSamplesPerAction?: number;
  opponentModel?: OpponentModel;
  mixingTemperature?: number;
};

export type BotActionScore = {
  action: PlayCardAction;
  heuristicValue: number;
  rolloutValue: number;
  totalValue: number;
  strategyProbability: number;
  rangeEvaluation: ActionRangeEvaluation;
};

export type BotAnalysis = {
  ranges: OpponentRange[];
  sampledWorlds: number;
  decisionMilliseconds: number;
  actions: BotActionScore[];
  opponentModel: Pick<OpponentModel, "id" | "label">;
  chosenAction?: PlayCardAction;
};

export type BeliefBot = Bot & {
  getLastAnalysis(): BotAnalysis | null;
};

const DEFAULT_ROLLOUT_BUDGET = 1_024;
const DEFAULT_MIN_SAMPLES = 32;
const DEFAULT_MAX_SAMPLES = 128;
const DEFAULT_MIXING_TEMPERATURE = 0.35;
const MAX_ROLLOUT_TURNS = 80;

export function createBeliefBot(
  seed: number,
  options: BeliefBotOptions = {},
): BeliefBot {
  const nextDecisionRandom = createSeededRandom(seed);
  const opponentModel = options.opponentModel ?? HUMAN_TENDENCY_MODEL;
  let lastAnalysis: BotAnalysis | null = null;
  let previousView: PlayerView | null = null;
  let previousRanges: OpponentRange[] = [];
  let lastOwnAction: PlayCardAction | null = null;

  return {
    id: "belief-bot",
    chooseAction(view, legalActions) {
      const startedAt = performance.now();
      if (legalActions.length === 0) {
        throw new Error("Belief bot received no legal actions.");
      }

      const ranges = updateOpponentRanges(
        previousView,
        previousRanges,
        view,
        lastOwnAction,
        opponentModel,
      );

      const playActions = deduplicateActions(
        legalActions.filter(
          (action): action is PlayCardAction => action.type === "play-card",
        ),
      );
      if (playActions.length === 0) {
        lastAnalysis = {
          ranges,
          sampledWorlds: 0,
          decisionMilliseconds: performance.now() - startedAt,
          actions: [],
          opponentModel,
        };
        return legalActions[0];
      }

      const safeActions = playActions.filter((action) => action.card !== "Princess");
      const candidates = safeActions.length > 0 ? safeActions : playActions;
      const decisionSeed = Math.floor(nextDecisionRandom() * 4_294_967_296) >>> 0;
      const sampleCount = clamp(
        Math.floor(
          (options.rolloutBudget ?? DEFAULT_ROLLOUT_BUDGET) /
            Math.max(1, candidates.length),
        ),
        options.minSamplesPerAction ?? DEFAULT_MIN_SAMPLES,
        options.maxSamplesPerAction ?? DEFAULT_MAX_SAMPLES,
      );
      const sampledStates = sampleConsistentStates(
        view,
        sampleCount,
        createSeededRandom(decisionSeed ^ 0x9e3779b9),
        ranges,
      );
      const rawActionScores = candidates.map((action) => {
        const rangeEvaluation = evaluateActionAgainstRange(view, action, ranges);
        const heuristicValue = scoreAction(view, action, ranges, rangeEvaluation);
        const rolloutValue = sampledStates.length > 0
          ? evaluateWithRollouts(
              sampledStates,
              action,
              view.players[view.myIndex]?.id ?? action.playerId,
              createSeededRandom(decisionSeed ^ hashAction(action)),
            )
          : 0;

        return {
          action,
          heuristicValue,
          rolloutValue,
          totalValue: rolloutValue * 100 + heuristicValue * 0.12,
          strategyProbability: 0,
          rangeEvaluation,
        };
      });
      const actionScores = assignStrategyProbabilities(
        rawActionScores,
        options.mixingTemperature ?? DEFAULT_MIXING_TEMPERATURE,
      );
      const highestScore = Math.max(...actionScores.map(({ totalValue }) => totalValue));
      const bestActions = actionScores.filter(
        ({ totalValue }) => Math.abs(totalValue - highestScore) < 1e-9,
      );

      const chosenAction = pickStrategyAction(
        actionScores,
        nextDecisionRandom(),
        bestActions.map(({ action }) => action),
      );
      previousView = view;
      previousRanges = ranges;
      lastOwnAction = chosenAction;
      lastAnalysis = {
        ranges,
        sampledWorlds: sampledStates.length,
        decisionMilliseconds: performance.now() - startedAt,
        actions: actionScores,
        opponentModel,
        chosenAction,
      };

      return chosenAction;
    },
    getLastAnalysis() {
      return lastAnalysis;
    },
  };
}

// Compatibility names retained for the app and external callers.
export function createSimpleBot(seed: number): BeliefBot {
  return createBeliefBot(seed);
}

export function createRandomBot(seed: number): BeliefBot {
  return createBeliefBot(seed);
}

export function createRangeBot(
  seed: number,
  options: Pick<BeliefBotOptions, "opponentModel" | "mixingTemperature"> = {},
): BeliefBot {
  return createBeliefBot(seed, {
    ...options,
    rolloutBudget: 0,
    minSamplesPerAction: 0,
    maxSamplesPerAction: 0,
  });
}

function evaluateWithRollouts(
  sampledStates: GameState[],
  action: PlayCardAction,
  rootPlayerId: number,
  nextRandom: () => number,
) {
  let totalValue = 0;
  let completedRollouts = 0;

  for (const sampledState of sampledStates) {
    try {
      const nextState = applyAction(sampledState, action);
      totalValue += rolloutRound(nextState, rootPlayerId, nextRandom);
      completedRollouts += 1;
    } catch {
      // A sampled world that cannot accept a public legal action is inconsistent
      // and contributes no evidence.
    }
  }

  return completedRollouts > 0 ? totalValue / completedRollouts : -1;
}

function rolloutRound(
  initialState: GameState,
  rootPlayerId: number,
  nextRandom: () => number,
) {
  let state = initialState;

  for (let turn = 0; turn < MAX_ROLLOUT_TURNS; turn += 1) {
    if (state.phase === "round-over" || state.phase === "game-over") {
      return terminalUtility(state, rootPlayerId);
    }

    if (state.phase === "awaiting-turn-draw") {
      state = drawCardForCurrentPlayer(state);
      continue;
    }

    if (state.phase !== "awaiting-card-play") {
      return 0;
    }

    const activeView = getPlayerView(state, state.currentPlayerIndex);
    const legalActions = getLegalActions(state).filter(
      (candidate): candidate is PlayCardAction => candidate.type === "play-card",
    );
    if (legalActions.length === 0) {
      return 0;
    }

    const chosenAction = chooseRolloutAction(activeView, legalActions, nextRandom);
    state = applyAction(state, chosenAction);
  }

  return 0;
}

function terminalUtility(state: GameState, rootPlayerId: number) {
  const winnerId = state.gameWinnerId ?? state.roundWinnerId;
  if (winnerId === null) {
    return 0;
  }

  const magnitude = state.phase === "game-over" ? 4 : 1;
  return winnerId === rootPlayerId ? magnitude : -magnitude;
}

function chooseRolloutAction(
  view: PlayerView,
  actions: PlayCardAction[],
  nextRandom: () => number,
) {
  const uniqueActions = deduplicateActions(actions);
  const safeActions = uniqueActions.filter((action) => action.card !== "Princess");
  const candidates = safeActions.length > 0 ? safeActions : uniqueActions;
  const scoredActions = candidates.map((action) => ({
    action,
    score: scoreAction(view, action),
  }));
  const highestScore = Math.max(...scoredActions.map(({ score }) => score));
  const bestActions = scoredActions.filter(
    ({ score }) => Math.abs(score - highestScore) < 1e-9,
  );

  // Rollout players normally use the strongest range-aware action, but retain
  // a little policy noise for less brittle opponent modelling.
  if (nextRandom() < 0.12) {
    return pickRandomAction(candidates, nextRandom());
  }

  return pickRandomAction(
    bestActions.map(({ action }) => action),
    nextRandom(),
  );
}

function scoreAction(
  view: PlayerView,
  action: PlayCardAction,
  ranges: OpponentRange[] = inferOpponentRanges(view),
  rangeEvaluation: ActionRangeEvaluation = evaluateActionAgainstRange(
    view,
    action,
    ranges,
  ),
) {
  const me = view.players[view.myIndex];
  const target = view.players.find((player) => player.id === action.targetId);
  const retainedCard = getRetainedCard(view.myHand, action.card);
  const evaluation = rangeEvaluation;
  const targetRange =
    action.targetId === undefined
      ? null
      : ranges.find((range) => range.playerId === action.targetId);

  switch (action.card) {
    case "Guard":
      return action.guess && target
        ? 15 + evaluation.hitProbability * 260
        : 3;
    case "Priest":
      return targetRange ? 18 + targetRange.entropy * 22 : 5;
    case "Baron":
      return (
        (evaluation.winProbability - evaluation.lossProbability) * 120 +
        evaluation.tieProbability * 8
      );
    case "Handmaid":
      return 34 + (view.cardsRemaining <= 3 ? 12 : 0);
    case "Prince": {
      if (!target || target.id === me?.id) {
        return retainedCard === "Princess" ? -10_000 : 4;
      }

      return (
        24 +
        evaluation.princessProbability * 260 +
        evaluation.expectedTargetValue * 3
      );
    }
    case "King":
      return retainedCard
        ? 16 +
            (evaluation.expectedTargetValue - CARD_VALUES[retainedCard]) * 10 +
            (retainedCard === "Princess" ? 70 : 0)
        : 4;
    case "Countess":
      return 10;
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

function deduplicateActions(actions: PlayCardAction[]) {
  const seen = new Set<string>();

  return actions.filter((action) => {
    const key = `${action.playerId}:${action.card}:${action.targetId ?? "none"}:${
      action.guess ?? "none"
    }`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function hashAction(action: PlayCardAction) {
  const text = `${action.playerId}|${action.card}|${action.targetId ?? -1}|${
    action.guess ?? ""
  }`;
  let hash = 2_166_136_261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function pickRandomAction(actions: PlayCardAction[], randomValue: number) {
  const index = Math.floor(randomValue * actions.length);
  return actions[index] ?? actions[0];
}

function assignStrategyProbabilities(
  scores: BotActionScore[],
  temperature: number,
) {
  if (scores.length === 0) {
    return scores;
  }

  const bestValue = Math.max(...scores.map((entry) => entry.totalValue));
  if (temperature <= 0) {
    const bestCount = scores.filter(
      (entry) => Math.abs(entry.totalValue - bestValue) < 1e-9,
    ).length;
    return scores.map((entry) => ({
      ...entry,
      strategyProbability:
        Math.abs(entry.totalValue - bestValue) < 1e-9 ? 1 / bestCount : 0,
    }));
  }

  const weights = scores.map((entry) =>
    Math.exp(Math.max(-40, (entry.totalValue - bestValue) / temperature)),
  );
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);

  return scores.map((entry, index) => ({
    ...entry,
    strategyProbability: (weights[index] ?? 0) / totalWeight,
  }));
}

function pickStrategyAction(
  scores: BotActionScore[],
  randomValue: number,
  fallbackActions: PlayCardAction[],
) {
  let threshold = randomValue;

  for (const entry of scores) {
    threshold -= entry.strategyProbability;
    if (threshold <= 0) {
      return entry.action;
    }
  }

  return fallbackActions[0] ?? scores[0].action;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
