import type { PlayerAction, PlayerView } from "../engine/types";

export type Bot = {
  id: string;
  chooseAction(view: PlayerView, legalActions: PlayerAction[]): PlayerAction;
};
