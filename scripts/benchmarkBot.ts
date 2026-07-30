import type { Bot } from "../src/bots/botTypes";
import {
  createBeliefBot,
  createRangeBot,
} from "../src/bots/randomBot";
import {
  getOpponentModel,
  HUMAN_TENDENCY_MODEL,
} from "../src/bots/opponentModel";
import { applyAction } from "../src/engine/applyAction";
import { getLegalActions } from "../src/engine/legalActions";
import { getPlayerView } from "../src/engine/playerView";
import { createSeededRandom } from "../src/engine/random";
import { createInitialGame } from "../src/engine/setupRound";
import { drawCardForCurrentPlayer } from "../src/engine/turnFlow";

const rounds = readPositiveInteger("ROUNDS", 100);
const rolloutBudget = readNonNegativeInteger("ROLLOUT_BUDGET", 1_024);
const baseSeed = readPositiveInteger("SEED", 1);
const opponentFilter = process.env.OPPONENT ?? "both";
const beliefModel = getOpponentModel(process.env.BELIEF_MODEL);

console.log(
  `Love Letter bot benchmark: ${rounds} paired-seat rounds, rollout budget ${rolloutBudget}, ${beliefModel.label} range model`,
);

const series = [
  { name: "uniform random", create: (seed: number) => createUniformRandomBot(seed) },
  { name: "range heuristic", create: (seed: number) => createRangeBot(seed) },
  { name: "human tendencies", create: (seed: number) => createTendencyBot(seed) },
].filter((entry) => {
  if (opponentFilter === "random") {
    return entry.name === "uniform random";
  }

  if (opponentFilter === "range") {
    return entry.name === "range heuristic";
  }

  if (opponentFilter === "human") {
    return entry.name === "human tendencies";
  }

  return true;
});
const results = series.map((entry) => runSeries(entry.name, entry.create));

console.table(
  results.map((result) => ({
    opponent: result.opponent,
    record: `${result.wins}-${result.losses}`,
    "win rate": `${(result.winRate * 100).toFixed(1)}%`,
    "95% CI": `${(result.confidenceLow * 100).toFixed(1)}–${(result.confidenceHigh * 100).toFixed(1)}%`,
    "avg decision": `${result.averageDecisionMilliseconds.toFixed(1)} ms`,
    "p95 decision": `${result.p95DecisionMilliseconds.toFixed(1)} ms`,
    "worlds/decision": result.averageWorldsPerDecision.toFixed(1),
    "total rollouts": result.totalRollouts,
  })),
);

function runSeries(
  opponentName: string,
  createOpponent: (seed: number) => Bot,
) {
  let wins = 0;
  let losses = 0;
  let totalWorlds = 0;
  let totalRollouts = 0;
  const decisionTimes: number[] = [];

  for (let round = 0; round < rounds; round += 1) {
    const seed = baseSeed + round;
    const beliefPlayerIndex = round % 2;
    let state = createInitialGame({
      playerNames:
        beliefPlayerIndex === 0
          ? ["Belief", opponentName]
          : [opponentName, "Belief"],
      seed,
    });
    const beliefBot = createBeliefBot(seed * 101 + 17, {
      rolloutBudget,
      minSamplesPerAction: rolloutBudget === 0 ? 0 : 32,
      maxSamplesPerAction: rolloutBudget === 0 ? 0 : 128,
      opponentModel: beliefModel,
    });
    const opponent = createOpponent(seed * 307 + 29);

    for (let step = 0; step < 100 && state.phase !== "round-over"; step += 1) {
      if (state.phase === "awaiting-turn-draw") {
        state = drawCardForCurrentPlayer(state);
        continue;
      }

      const activePlayerIndex = state.currentPlayerIndex;
      const actions = getLegalActions(state);
      const action = activePlayerIndex === beliefPlayerIndex
        ? beliefBot.chooseAction(
            getPlayerView(state, activePlayerIndex),
            actions,
          )
        : opponent.chooseAction(
            getPlayerView(state, activePlayerIndex),
            actions,
          );

      if (activePlayerIndex === beliefPlayerIndex) {
        const analysis = beliefBot.getLastAnalysis();
        if (analysis) {
          decisionTimes.push(analysis.decisionMilliseconds);
          totalWorlds += analysis.sampledWorlds;
          totalRollouts += analysis.sampledWorlds * analysis.actions.length;
        }
      }

      state = applyAction(state, action);
    }

    if (state.phase !== "round-over" || state.roundWinnerId === null) {
      throw new Error(`Round ${round + 1} did not terminate.`);
    }

    if (state.roundWinnerId === beliefPlayerIndex) {
      wins += 1;
    } else {
      losses += 1;
    }
  }

  const sortedTimes = [...decisionTimes].sort((left, right) => left - right);
  const confidence = wilsonInterval(wins, wins + losses);

  return {
    opponent: opponentName,
    wins,
    losses,
    winRate: wins / Math.max(1, wins + losses),
    confidenceLow: confidence.low,
    confidenceHigh: confidence.high,
    averageDecisionMilliseconds: average(decisionTimes),
    p95DecisionMilliseconds: percentile(sortedTimes, 0.95),
    averageWorldsPerDecision: totalWorlds / Math.max(1, decisionTimes.length),
    totalRollouts,
  };
}

function createUniformRandomBot(seed: number): Bot {
  const nextRandom = createSeededRandom(seed);

  return {
    id: "uniform-random",
    chooseAction(_view, legalActions) {
      if (legalActions.length === 0) {
        throw new Error("Random bot received no legal actions.");
      }

      return legalActions[Math.floor(nextRandom() * legalActions.length)] ?? legalActions[0];
    },
  };
}

function createTendencyBot(seed: number): Bot {
  const nextRandom = createSeededRandom(seed);

  return {
    id: "human-tendencies",
    chooseAction(_view, legalActions) {
      if (legalActions.length === 0) {
        throw new Error("Tendency bot received no legal actions.");
      }

      const playActions = legalActions.filter(
        (action) => action.type === "play-card",
      );
      if (playActions.length === 0) {
        return legalActions[0];
      }

      const cards = [...new Set(playActions.map((action) => action.card))];
      const totalWeight = cards.reduce(
        (total, card) => total + HUMAN_TENDENCY_MODEL.playWeights[card],
        0,
      );
      let threshold = nextRandom() * totalWeight;
      let chosenCard = cards[0];
      for (const card of cards) {
        threshold -= HUMAN_TENDENCY_MODEL.playWeights[card];
        if (threshold <= 0) {
          chosenCard = card;
          break;
        }
      }

      const matchingActions = playActions.filter(
        (action) => action.card === chosenCard,
      );
      return matchingActions[Math.floor(nextRandom() * matchingActions.length)]
        ?? matchingActions[0]
        ?? playActions[0];
    },
  };
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(sortedValues: number[], quantile: number) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.ceil(sortedValues.length * quantile) - 1;
  return sortedValues[Math.max(0, index)] ?? 0;
}

function wilsonInterval(successes: number, trials: number) {
  if (trials === 0) {
    return { low: 0, high: 0 };
  }

  const z = 1.96;
  const proportion = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (proportion + (z * z) / (2 * trials)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / trials +
        (z * z) / (4 * trials * trials),
    );

  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readNonNegativeInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
