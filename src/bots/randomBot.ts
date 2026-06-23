import type { Bot } from "./botTypes";
import { createSeededRandom } from "../engine/random";
import type { PlayerAction } from "../engine/types";

export function createRandomBot(seed: number): Bot {
  const nextRandom = createSeededRandom(seed);

  return {
    id: "random-bot",
    chooseAction(_view, legalActions) {
      if (legalActions.length === 0) {
        throw new Error("Random bot received no legal actions.");
      }

      return pickRandomAction(legalActions, nextRandom());
    },
  };
}

function pickRandomAction(actions: PlayerAction[], randomValue: number) {
  const index = Math.floor(randomValue * actions.length);
  return actions[index] ?? actions[0];
}
