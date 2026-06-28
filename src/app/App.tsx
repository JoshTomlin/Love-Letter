import { useEffect, useMemo, useRef, useState } from "react";
import { createRandomBot } from "../bots/randomBot";
import { CARD_VALUES, TOKENS_TO_WIN_BY_RULESET } from "../engine/constants";
import { applyAction } from "../engine/applyAction";
import { getLegalActions } from "../engine/legalActions";
import { getPlayerView } from "../engine/playerView";
import { createInitialGame } from "../engine/setupRound";
import { drawCardForCurrentPlayer } from "../engine/turnFlow";
import type {
  Card,
  GameState,
  PlayCardAction,
  PlayerAction,
  PublicGameEvent,
  RoundPhase,
} from "../engine/types";

const HUMAN_PLAYER_INDEX = 0;
// Turn visuals are staged without changing engine timing.
const REVEAL_CUE_MS = 800;
const DRAW_CUE_MS = 950;
const PLAY_CUE_MS = 850;
const RESOLVE_CUE_MS = 1650;
const PRIEST_REVEAL_MS = 2400;

const CARD_TEXT: Record<Card, string> = {
  Guard: "Name a card. Correct guesses eliminate.",
  Priest: "Look at the bot's hand.",
  Baron: "Compare hands. Low card is out.",
  Handmaid: "Protected until your next turn.",
  Prince: "Force a discard and redraw.",
  King: "Trade hands with the bot.",
  Countess: "Must play with King or Prince.",
  Princess: "Discarding her eliminates you.",
};

type CardPlayedEvent = Extract<PublicGameEvent, { type: "card-played" }>;
type CueTone = "neutral" | "success" | "danger";
type TableCue = {
  kind: "draw" | "reveal" | "play" | "resolve" | "win";
  actorId?: number;
  card?: Card;
  targetId?: number;
  revealedCard?: Card;
  title: string;
  detail: string;
  speech?: string;
  response?: string;
  tone?: CueTone;
};

const MOBILE_BOARD_STYLES = String.raw`
html, body, #root { width: 100%; height: 100%; overflow: hidden; }
body { overscroll-behavior: none; }
.hand-card-slot { position: relative; min-width: 0; min-height: 0; transform-style: preserve-3d; }
.hand-card-slot > .card-face, .hand-card-slot > .card-back { width: 100%; height: 100%; min-height: 0; }
.player-tools { display: flex; align-items: center; justify-content: flex-end; gap: .45rem; min-height: 2rem; }
.reset-button { min-height: 1.8rem; padding: .25rem .5rem; border: 0; border-radius: 8px; background: rgba(248,242,232,.1); color: rgba(248,242,232,.82); font: inherit; font-size: .68rem; cursor: pointer; }
@media (max-width: 719px) {
  .game-shell { display: grid; grid-template-rows: auto minmax(0,1fr); width: min(100%,430px); height: 100vh; height: 100dvh; min-height: 0; padding: calc(.35rem + env(safe-area-inset-top)) .55rem calc(.4rem + env(safe-area-inset-bottom)); overflow: hidden; }
  .score-bar { min-height: 2.6rem; margin: 0; }
  .score-name, .game-title small, .zone-label, .stage-label { font-size: .64rem; }
  .score-side strong { font-size: 1rem; }
  .game-title span { font-size: 1.15rem; }
  .table-surface { grid-template-rows: minmax(0,.78fr) minmax(0,1.08fr) minmax(0,1.28fr); gap: .35rem; min-height: 0; height: 100%; overflow: hidden; }
  .opponent-zone, .player-zone, .center-table { position: relative; min-width: 0; min-height: 0; }
  .opponent-zone { display: grid; grid-template-rows: auto minmax(0,1fr); }
  .player-zone { display: grid; grid-template-rows: auto minmax(0,1fr) auto; }
  .zone-row, .player-tools { min-height: 2rem; margin: 0; }
  .zone-row h2 { font-size: .86rem; line-height: 1; }
  .opponent-hand, .player-hand { display: flex; align-items: center; justify-content: center; gap: .5rem; min-width: 0; min-height: 0; padding: .1rem 0; perspective: 900px; }
  .hand-card-slot { flex: 0 1 auto; height: 100%; aspect-ratio: 5 / 7; }
  .opponent-hand .hand-card-slot { max-height: 8.4rem; }
  .player-hand .hand-card-slot { max-width: calc(50% - .25rem); max-height: 14.5rem; }
  .card-face-large, .card-face-small { min-height: 0; }
  .card-face { gap: .12rem; padding: clamp(.25rem,1.7vmin,.5rem); }
  .card-face::before { inset: .24rem; }
  .card-corner { width: clamp(1.2rem,4.8vmin,1.55rem); height: clamp(1.2rem,4.8vmin,1.55rem); font-size: clamp(.72rem,2.7vmin,.9rem); }
  .card-name { font-size: clamp(.72rem,3.3vmin,1rem); line-height: 1; }
  .card-text { display: none; }
  .card-illustration { width: min(4.7rem,70%); max-height: 100%; }
  .card-back { padding: .3rem; }
  .card-back-frame span { width: clamp(1.7rem,8vmin,2.7rem); height: clamp(1.7rem,8vmin,2.7rem); font-size: clamp(.68rem,3vmin,.95rem); }
  .pile-stack { min-width: 4.8rem; max-width: 7rem; min-height: 1.8rem; padding: .25rem .38rem; }
  .pile-stack span { width: 1.3rem; height: 1.3rem; font-size: .7rem; }
  .pile-stack strong { font-size: .68rem; }
  .center-table { grid-template-columns: 4.15rem minmax(0,1fr); grid-template-rows: minmax(0,1fr) auto; grid-template-areas: "deck stage" "prompt prompt"; gap: .35rem; align-items: center; align-content: stretch; padding: .18rem 0; }
  .deck-area > .card-back { height: auto; }
  .deck-area > span { width: 1.45rem; height: 1.45rem; font-size: .72rem; }
  .turn-stage { grid-template-columns: minmax(4.2rem,5.25rem) minmax(0,1fr); gap: .35rem; width: 100%; height: 100%; min-height: 0; padding: .1rem; }
  .turn-stage .stage-label { align-self: end; }
  .turn-stage .card-face, .turn-stage .card-back, .turn-stage .empty-stage { align-self: center; width: 100%; height: auto; min-height: 0; max-height: 8.2rem; }
  .empty-stage { font-size: .72rem; }
  .stage-owner { padding: .25rem .42rem; font-size: .72rem; }
  .prompt-panel { display: flex; align-items: center; justify-content: center; gap: .38rem; min-height: 2.35rem; padding: .35rem .5rem; text-align: center; }
  .prompt-panel strong { font-size: .86rem; }
  .prompt-detail, .prompt-panel small { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .prompt-panel em { padding: .2rem .38rem; font-size: .72rem; }
  .intel-strip { position: absolute; z-index: 7; right: .2rem; bottom: 2.75rem; justify-content: end; }
  .intel-strip span { padding: .25rem .38rem; color: #172d33; background: rgba(228,197,122,.92); font-size: .66rem; font-weight: 700; }
  .pile-stack-player { margin: 0; }
  .action-row { position: absolute; z-index: 14; left: 50%; bottom: .35rem; width: min(80%,18rem); margin: 0; transform: translateX(-50%); }
}
@media (max-height: 700px) and (max-width: 719px) {
  .game-shell { padding-top: calc(.2rem + env(safe-area-inset-top)); padding-bottom: calc(.2rem + env(safe-area-inset-bottom)); }
  .score-bar { min-height: 2.2rem; }
  .table-surface { gap: .2rem; }
  .zone-row, .player-tools { min-height: 1.7rem; }
  .center-table { grid-template-columns: 3.7rem minmax(0,1fr); }
  .prompt-panel { min-height: 2rem; padding-block: .22rem; }
}`;

const MOBILE_EFFECT_STYLES = String.raw`
.cue-bubbles { position: absolute; z-index: 12; left: 0; right: 0; display: grid; gap: .3rem; pointer-events: none; }
.cue-bubbles-bot { top: -.25rem; justify-items: start; }
.cue-bubbles-you { bottom: 2.75rem; justify-items: end; }
.speech-bubble { width: fit-content; max-width: min(88%,17rem); padding: .5rem .68rem; border-radius: 8px; font-size: clamp(.84rem,3.8vmin,1.05rem); line-height: 1.15; box-shadow: 0 .45rem .8rem rgba(2,8,10,.25); animation: bubble-in 220ms ease; }
.speech-bubble-actor { background: #f0d17f; color: #172d33; font-weight: 700; }
.speech-bubble-response { background: #f8f2e8; color: #172d33; font-weight: 700; }
.speech-bubble-success { background: #5dbf7e; color: #082219; }
.speech-bubble-danger { background: #ec5656; color: #fff8ed; }
.action-effect { position: absolute; z-index: 11; left: 59%; top: 40%; display: grid; place-items: center; min-width: 4.5rem; min-height: 4.5rem; border-radius: 999px; color: #f8f2e8; font-family: Georgia,"Times New Roman",serif; font-size: 1rem; font-weight: 700; text-shadow: 0 2px 4px rgba(2,8,10,.42); transform: translate(-50%,-50%); pointer-events: none; animation: effect-burst 650ms cubic-bezier(.2,.85,.25,1) both; }
.action-effect-priest svg { width: 6.5rem; filter: drop-shadow(0 0 .6rem rgba(106,164,184,.9)); }
.action-effect-priest path, .action-effect-priest circle { fill: rgba(106,164,184,.22); stroke: #d9f4ff; stroke-width: 4; }
.action-effect-guard { border: 3px solid #f0d17f; background: rgba(109,31,32,.88); font-size: 2.4rem; }
.action-effect-baron, .action-effect-prince, .action-effect-king, .action-effect-princess { border: 2px solid rgba(248,242,232,.76); background: rgba(3,18,20,.78); }
.action-effect-handmaid { border: 3px solid #f0d17f; background: rgba(53,90,45,.9); font-size: .68rem; }
.action-effect-win { width: 7rem; height: 7rem; border: 3px solid #f5c84b; background: rgba(93,63,20,.72); box-shadow: 0 0 2rem rgba(245,200,75,.68); }
.effect-crown { font-size: 2.4rem; }
.action-effect-win i { position: absolute; width: .45rem; height: .45rem; border-radius: 999px; background: #f5c84b; animation: win-orbit 1200ms linear infinite; }
.action-effect-win i:nth-of-type(2) { animation-delay: -400ms; }
.action-effect-win i:nth-of-type(3) { animation-delay: -800ms; }
.shield-aura { position: absolute; z-index: 9; left: 50%; top: 54%; width: min(42%,8.5rem); transform: translate(-50%,-50%); pointer-events: none; }
.shield-aura svg { width: 100%; overflow: visible; fill: rgba(245,200,75,.16); stroke: #f5d76e; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 .7rem rgba(245,200,75,.75)); animation: shield-pulse 1000ms ease-in-out infinite alternate; }
.hand-card-slot-revealing { z-index: 7; animation: reveal-in-hand 800ms ease both; }
.hand-card-slot-playing { z-index: 8; pointer-events: none; }
.hand-card-slot-playing-bot { animation: bot-card-to-table 850ms cubic-bezier(.25,.78,.28,1) both; }
.hand-card-slot-playing-you { animation: player-card-to-table 850ms cubic-bezier(.25,.78,.28,1) both; }
.hand-card-slot-priest-reveal { z-index: 10; animation: priest-card-flip 500ms ease both, priest-card-glow 800ms 500ms ease-in-out infinite alternate; }
.table-surface-bot-thinking .opponent-hand .hand-card-slot:not(.hand-card-slot-revealing) { animation: bot-think 780ms ease-in-out infinite alternate; }
.table-surface-bot-thinking .opponent-hand .hand-card-slot:nth-child(2) { animation-delay: -390ms; }
@keyframes reveal-in-hand { 0% { transform: rotateY(0) scale(1); } 48% { transform: rotateY(88deg) scale(1.08); } 52% { transform: rotateY(92deg) scale(1.08); } 100% { transform: rotateY(360deg) scale(1.05); filter: brightness(1.12); } }
@keyframes priest-card-flip { from { transform: rotateY(90deg); } to { transform: rotateY(360deg); } }
@keyframes priest-card-glow { from { filter: drop-shadow(0 0 .2rem rgba(217,244,255,.4)); } to { filter: drop-shadow(0 0 .9rem rgba(217,244,255,1)); } }
@keyframes bot-card-to-table { 0% { opacity: 1; transform: translate(0,0) rotate(0) scale(1.04); } 75% { opacity: 1; transform: translate(-1.2rem,20vh) rotate(-5deg) scale(.84); } 100% { opacity: 0; transform: translate(-1.2rem,20vh) rotate(-5deg) scale(.84); } }
@keyframes player-card-to-table { 0% { opacity: 1; transform: translate(0,0) rotate(0) scale(1.04); } 75% { opacity: 1; transform: translate(.8rem,-24vh) rotate(5deg) scale(.68); } 100% { opacity: 0; transform: translate(.8rem,-24vh) rotate(5deg) scale(.68); } }
@keyframes effect-burst { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.35) rotate(-18deg); } 70% { opacity: 1; transform: translate(-50%,-50%) scale(1.12) rotate(3deg); } 100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
@keyframes shield-pulse { from { opacity: .72; transform: scale(.94); } to { opacity: 1; transform: scale(1.05); } }
@keyframes win-orbit { from { transform: rotate(0) translateX(4.3rem) rotate(0); } to { transform: rotate(360deg) translateX(4.3rem) rotate(-360deg); } }
@media (prefers-reduced-motion: reduce) { .hand-card-slot, .action-effect, .shield-aura svg { animation-duration: 1ms !important; } }
`;

function playerLabel(playerId: number) {
  return playerId === HUMAN_PLAYER_INDEX ? "You" : "Bot";
}

function cardClass(card: Card) {
  return card.toLowerCase();
}

function formatReason(reason: string) {
  const descriptions: Record<string, string> = {
    "guard-correct-guess": "correct Guard guess",
    "baron-lower-card": "lower Baron card",
    "discarded-princess": "discarded Princess",
    "last-player-standing": "last player standing",
    "deck-empty": "highest final hand",
  };

  return descriptions[reason] ?? reason.replace(/-/g, " ");
}

function formatPhase(phase: RoundPhase) {
  const labels: Record<RoundPhase, string> = {
    "round-start": "Deal",
    "awaiting-turn-draw": "Draw",
    "awaiting-card-play": "Play",
    "resolving-action": "Resolve",
    "round-over": "Round",
    "game-over": "Game",
  };

  return labels[phase];
}

function formatEvent(event: PublicGameEvent) {
  if (event.type === "turn-started") {
    return `${playerLabel(event.playerId)} started.`;
  }

  if (event.type === "card-played") {
    return `${playerLabel(event.playerId)} played ${event.card}${
      event.targetId === undefined ? "" : ` on ${playerLabel(event.targetId)}`
    }.`;
  }

  if (event.type === "player-eliminated") {
    return `${playerLabel(event.playerId)} eliminated: ${formatReason(event.reason)}.`;
  }

  if (event.type === "token-awarded") {
    return `${playerLabel(event.playerId)} gained a token.`;
  }

  return `${playerLabel(event.winnerId)} won by ${formatReason(event.reason)}.`;
}

function createSeed() {
  return Math.floor(Math.random() * 2_147_483_647) || 1;
}

function createGame() {
  return createInitialGame({
    playerNames: ["You", "Bot"],
    seed: createSeed(),
  });
}

function getPrompt(
  phase: RoundPhase,
  isHumanTurn: boolean,
  currentPlayerName: string | undefined,
  roundWinnerId: number | null,
  gameWinnerId: number | null,
) {
  if (phase === "game-over") {
    return {
      title: `${playerLabel(gameWinnerId ?? HUMAN_PLAYER_INDEX)} wins the game`,
      detail: "Final token reached.",
    };
  }

  if (phase === "round-over") {
    return {
      title:
        roundWinnerId === null
          ? "Round complete"
          : `${playerLabel(roundWinnerId)} wins the round`,
      detail: "Deal the next round.",
    };
  }

  if (phase === "awaiting-turn-draw") {
    return {
      title: `${currentPlayerName ?? "Player"} draws`,
      detail: "Second card enters the hand.",
    };
  }

  if (isHumanTurn) {
    return {
      title: "Your move",
      detail: "Choose one card.",
    };
  }

  return {
    title: "Bot thinking",
    detail: "Watch the table.",
  };
}

function getPlayOptions(legalActions: PlayerAction[], card: Card) {
  return legalActions.filter(
    (action): action is PlayCardAction =>
      action.type === "play-card" && action.card === card,
  );
}

function getLastPlayedEvent(log: PublicGameEvent[]) {
  return [...log].reverse().find(
    (event): event is CardPlayedEvent => event.type === "card-played",
  );
}

function getNewPublicEvents(before: GameState, after: GameState) {
  return after.log.slice(before.log.length).filter((event): event is PublicGameEvent => {
    return event.type !== "card-drawn" && event.type !== "card-revealed";
  });
}

function getNewEliminatedPlayers(before: GameState, after: GameState) {
  return after.players.filter((player) => {
    const previous = before.players.find((candidate) => candidate.id === player.id);
    return player.eliminated && !previous?.eliminated;
  });
}

function getPrivateReveal(before: GameState, after: GameState, viewerId: number) {
  return after.log.slice(before.log.length).find((event) => {
    return event.type === "card-revealed" && event.viewerId === viewerId;
  });
}

function getChoiceSheetTitle(action: PlayCardAction | undefined) {
  if (!action) {
    return "Choose";
  }

  switch (action.card) {
    case "Guard":
      return "Guard guess";
    case "Prince":
      return "Prince target";
    case "Priest":
    case "Baron":
    case "King":
      return "Target";
    default:
      return action.card;
  }
}

function getChoiceLabel(action: PlayCardAction) {
  if (action.card === "Guard") {
    return action.guess ? action.guess : "Play Guard";
  }

  if (action.targetId !== undefined) {
    return playerLabel(action.targetId);
  }

  return action.card;
}

function getChoiceHint(action: PlayCardAction) {
  if (action.card === "Prince" && action.targetId === HUMAN_PLAYER_INDEX) {
    return "You discard and redraw.";
  }

  if (action.card === "Prince") {
    return "Bot discards and redraws.";
  }

  return CARD_TEXT[action.card];
}

function getPlayCue(action: PlayCardAction): TableCue {
  const actor = playerLabel(action.playerId);
  const target =
    action.targetId === undefined ? null : playerLabel(action.targetId);

  if (action.card === "Guard" && action.guess) {
    return {
      kind: "play",
      actorId: action.playerId,
      targetId: action.targetId,
      card: action.card,
      title: `${actor} plays Guard`,
      detail: `${target ?? "Opponent"} is challenged.`,
      speech: `I guess ${action.guess}.`,
    };
  }

  return {
    kind: "play",
    actorId: action.playerId,
    targetId: action.targetId,
    card: action.card,
    title: `${actor} plays ${action.card}`,
    detail: target ? `${target} is targeted.` : CARD_TEXT[action.card],
  };
}

function getResolveCue(before: GameState, after: GameState, action: PlayCardAction): TableCue {
  const actor = playerLabel(action.playerId);
  const target = action.targetId === undefined ? null : playerLabel(action.targetId);
  const eliminated = getNewEliminatedPlayers(before, after);
  const eliminatedTarget = eliminated.find((player) => player.id === action.targetId);
  const eliminatedActor = eliminated.find((player) => player.id === action.playerId);
  const newEvents = getNewPublicEvents(before, after);

  if (action.card === "Guard") {
    const correct = Boolean(eliminatedTarget);

    return {
      kind: "resolve",
      actorId: action.playerId,
      targetId: action.targetId,
      card: action.card,
      title: `${actor} guessed ${action.guess}`,
      detail: correct
        ? `${target ?? "Target"} had ${action.guess}.`
        : `${target ?? "Target"} says no. ${action.guess} was wrong.`,
      speech: `I guess ${action.guess}.`,
      response: correct ? "Correct." : "Wrong.",
      tone: correct ? "success" : "neutral",
    };
  }

  if (action.card === "Priest") {
    const reveal = getPrivateReveal(before, after, action.playerId);

    return {
      kind: "resolve",
      actorId: action.playerId,
      targetId: action.targetId,
      card: action.card,
      title: `${actor} uses Priest`,
      detail:
        action.playerId === HUMAN_PLAYER_INDEX && reveal?.type === "card-revealed"
          ? `You saw ${playerLabel(reveal.targetId)} holding ${reveal.card}.`
          : `${actor} looked at ${target ?? "the target"}'s hand.`,
      revealedCard:
        action.playerId === HUMAN_PLAYER_INDEX && reveal?.type === "card-revealed"
          ? reveal.card
          : undefined,
      tone: "success",
    };
  }

  if (action.card === "Baron") {
    const eliminatedPlayer = eliminatedTarget ?? eliminatedActor;

    return {
      kind: "resolve",
      actorId: action.playerId,
      targetId: action.targetId,
      card: action.card,
      title: "Baron comparison",
      detail: eliminatedPlayer
        ? `${playerLabel(eliminatedPlayer.id)} had the lower card.`
        : "The cards matched. Nobody is eliminated.",
      response: eliminatedPlayer ? `${playerLabel(eliminatedPlayer.id)} is out.` : "Tie.",
      tone: eliminatedPlayer ? "danger" : "neutral",
    };
  }

  if (action.card === "Handmaid") {
    return {
      kind: "resolve",
      actorId: action.playerId,
      card: action.card,
      title: `${actor} is protected`,
      detail: "Handmaid blocks targeting until that player's next turn.",
      response: "Protected.",
      tone: "success",
    };
  }

  if (action.card === "Prince") {
    const princessDiscard = newEvents.some(
      (event) => event.type === "player-eliminated" && event.reason === "discarded-princess",
    );

    return {
      kind: "resolve",
      actorId: action.playerId,
      targetId: action.targetId,
      card: action.card,
      title: `${target ?? "Target"} discards`,
      detail: princessDiscard
        ? "Princess was discarded, so the target is eliminated."
        : `${target ?? "Target"} discarded and drew a replacement.`,
      response: princessDiscard ? "Princess." : "Redrawn.",
      tone: princessDiscard ? "danger" : "success",
    };
  }

  if (action.card === "King") {
    return {
      kind: "resolve",
      actorId: action.playerId,
      targetId: action.targetId,
      card: action.card,
      title: "Hands traded",
      detail: `${actor} and ${target ?? "the target"} swapped hands.`,
      response: "Swapped.",
      tone: "success",
    };
  }

  if (action.card === "Princess") {
    return {
      kind: "resolve",
      actorId: action.playerId,
      card: action.card,
      title: `${actor} discarded Princess`,
      detail: "Princess leaving the hand eliminates that player.",
      response: `${actor} is out.`,
      tone: "danger",
    };
  }

  return {
    kind: "resolve",
    actorId: action.playerId,
    card: action.card,
    title: `${action.card} resolves`,
    detail: CARD_TEXT[action.card],
    response: "Resolved.",
    tone: "neutral",
  };
}

function getWinCue(state: GameState): TableCue {
  const winnerId = state.gameWinnerId ?? state.roundWinnerId ?? HUMAN_PLAYER_INDEX;
  const winner = playerLabel(winnerId);
  const tokensToWin = TOKENS_TO_WIN_BY_RULESET[state.ruleset];

  if (state.phase === "game-over") {
    return {
      kind: "win",
      actorId: winnerId,
      title: `${winner} wins the game`,
      detail: `${winner} reached ${tokensToWin} tokens.`,
      response: "Game over.",
      tone: "success",
    };
  }

  return {
    kind: "win",
    actorId: winnerId,
    title: `${winner} wins the round`,
    detail: "A favor token is awarded.",
    response: "+1 token",
    tone: "success",
  };
}

function CardIllustration({ card }: { card: Card }) {
  const className = `card-illustration card-illustration-${cardClass(card)}`;

  if (card === "Guard") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 120 120">
        <path d="M60 14 L96 28 V58 C96 82 80 100 60 108 C40 100 24 82 24 58 V28 Z" />
        <path d="M60 28 V92" />
        <path d="M39 50 H81" />
      </svg>
    );
  }

  if (card === "Priest") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 120 120">
        <path d="M32 100 V48 L60 20 L88 48 V100 Z" />
        <path d="M47 100 V70 C47 61 53 55 60 55 C67 55 73 61 73 70 V100" />
        <path d="M60 34 V49" />
        <path d="M52 42 H68" />
      </svg>
    );
  }

  if (card === "Baron") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 120 120">
        <path d="M60 20 V96" />
        <path d="M35 38 H85" />
        <path d="M39 38 L25 70 H53 Z" />
        <path d="M81 38 L67 70 H95 Z" />
        <path d="M42 96 H78" />
      </svg>
    );
  }

  if (card === "Handmaid") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 120 120">
        <path d="M60 18 C78 34 90 52 90 71 C90 91 77 104 60 104 C43 104 30 91 30 71 C30 52 42 34 60 18 Z" />
        <path d="M43 70 C50 80 70 80 77 70" />
        <path d="M43 52 C50 45 70 45 77 52" />
      </svg>
    );
  }

  if (card === "Prince") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 120 120">
        <path d="M30 74 L38 34 L52 58 L60 28 L68 58 L82 34 L90 74 Z" />
        <path d="M34 74 H86 V94 H34 Z" />
        <path d="M46 86 H74" />
      </svg>
    );
  }

  if (card === "King") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 120 120">
        <path d="M26 86 H94" />
        <path d="M34 86 L42 36 L57 66 L60 26 L63 66 L78 36 L86 86" />
        <path d="M42 96 H78" />
      </svg>
    );
  }

  if (card === "Countess") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 120 120">
        <path d="M34 96 C40 50 80 50 86 96 Z" />
        <path d="M42 52 C46 31 74 31 78 52" />
        <path d="M49 40 L60 23 L71 40" />
        <path d="M45 73 H75" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 120 120">
      <path d="M60 18 L86 38 V76 C86 94 74 106 60 106 C46 106 34 94 34 76 V38 Z" />
      <path d="M45 39 C50 28 70 28 75 39" />
      <path d="M49 65 C55 72 65 72 71 65" />
      <path d="M60 51 V90" />
    </svg>
  );
}

function CardFace({
  card,
  className = "",
  disabled = false,
  onClick,
  size = "large",
}: {
  card: Card;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  size?: "large" | "small";
}) {
  const cardFaceClassName = `card-face card-face-${cardClass(card)} card-face-${size} ${className}`.trim();

  if (onClick) {
    return (
      <button className={cardFaceClassName} disabled={disabled} onClick={onClick} type="button">
        <CardContents card={card} />
      </button>
    );
  }

  return (
    <div className={cardFaceClassName}>
      <CardContents card={card} />
    </div>
  );
}

function CardContents({ card }: { card: Card }) {
  return (
    <>
      <span className="card-corner">{CARD_VALUES[card]}</span>
      <CardIllustration card={card} />
      <span className="card-name">{card}</span>
      <span className="card-text">{CARD_TEXT[card]}</span>
    </>
  );
}

function CardBack({ stacked = false }: { stacked?: boolean }) {
  return (
    <div className={`card-back ${stacked ? "card-back-stacked" : ""}`}>
      <div className="card-back-frame">
        <span>LL</span>
      </div>
    </div>
  );
}

function ActionEffect({ cue }: { cue: TableCue | null }) {
  if (!cue || (cue.kind !== "resolve" && cue.kind !== "win")) {
    return null;
  }

  if (cue.kind === "win") {
    return (
      <div className="action-effect action-effect-win" aria-hidden="true">
        <span className="effect-crown">W</span>
        <i />
        <i />
        <i />
      </div>
    );
  }

  const labels: Partial<Record<Card, string>> = {
    Baron: "VS",
    Handmaid: "SHIELD",
    Prince: "DISCARD",
    King: "SWAP",
    Princess: "OUT",
  };

  if (cue.card === "Priest") {
    return (
      <div className="action-effect action-effect-priest" aria-hidden="true">
        <svg viewBox="0 0 120 70">
          <path d="M8 35 C30 5 90 5 112 35 C90 65 30 65 8 35 Z" />
          <circle cx="60" cy="35" r="16" />
          <circle cx="60" cy="35" r="6" />
        </svg>
      </div>
    );
  }

  if (cue.card === "Guard") {
    return <div className="action-effect action-effect-guard" aria-hidden="true">?</div>;
  }

  if (cue.card && labels[cue.card]) {
    return (
      <div className={`action-effect action-effect-${cardClass(cue.card)}`} aria-hidden="true">
        {labels[cue.card]}
      </div>
    );
  }

  return null;
}

function ShieldAura() {
  return (
    <div className="shield-aura" aria-label="Protected by Handmaid">
      <svg aria-hidden="true" viewBox="0 0 100 112">
        <path d="M50 5 L92 20 V54 C92 82 74 103 50 109 C26 103 8 82 8 54 V20 Z" />
        <path d="M50 22 V88 M29 48 H71" />
      </svg>
    </div>
  );
}

export function App() {
  const [state, setState] = useState(createGame);
  const [pendingChoices, setPendingChoices] = useState<PlayCardAction[] | null>(null);
  const [historyPlayerId, setHistoryPlayerId] = useState<number | null>(null);
  const [tableCue, setTableCue] = useState<TableCue | null>(null);
  const [isSequencing, setIsSequencing] = useState(false);
  const sequenceInProgressRef = useRef(false);
  const timeoutsRef = useRef<number[]>([]);
  const botRef = useRef<ReturnType<typeof createRandomBot> | null>(null);
  if (botRef.current === null) {
    botRef.current = createRandomBot(createSeed());
  }
  const view = getPlayerView(state, HUMAN_PLAYER_INDEX);
  const legalActions = getLegalActions(state);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const me = view.players[HUMAN_PLAYER_INDEX];
  const opponent = view.players.find((player) => player.id !== HUMAN_PLAYER_INDEX) ?? null;
  const isHumanTurn =
    state.phase === "awaiting-card-play" && currentPlayer?.id === HUMAN_PLAYER_INDEX;
  const isBotThinking =
    state.phase === "awaiting-card-play" && currentPlayer?.id !== HUMAN_PLAYER_INDEX;
  const latestPublicEvent = [...view.log].reverse()[0] ?? null;
  const lastPlayedEvent = getLastPlayedEvent(view.log);
  const knownCards = Object.entries(state.players[HUMAN_PLAYER_INDEX]?.seenCards ?? {});
  const tokensToWin = TOKENS_TO_WIN_BY_RULESET[state.ruleset];
  const prompt = getPrompt(
    state.phase,
    isHumanTurn,
    currentPlayer?.name,
    state.roundWinnerId,
    state.gameWinnerId,
  );
  const stageCard =
    tableCue?.kind === "draw" || tableCue?.kind === "reveal"
      ? null
      : tableCue?.card ?? lastPlayedEvent?.card ?? null;
  const stageActorId = tableCue?.actorId ?? lastPlayedEvent?.playerId ?? null;
  const stageLabel = tableCue
    ? tableCue.kind === "draw"
      ? `${playerLabel(tableCue.actorId ?? HUMAN_PLAYER_INDEX)} draws`
      : tableCue.kind === "reveal"
        ? `${playerLabel(tableCue.actorId ?? HUMAN_PLAYER_INDEX)} reveals`
      : tableCue.kind === "win"
        ? "Round result"
        : `${playerLabel(tableCue.actorId ?? HUMAN_PLAYER_INDEX)} ${tableCue.kind === "play" ? "plays" : "resolves"}`
    : lastPlayedEvent
      ? `${playerLabel(lastPlayedEvent.playerId)} played`
      : "Opening deal";
  const tableCueTone = tableCue?.tone ?? "neutral";
  const botIsPlaying =
    tableCue?.actorId === opponent?.id &&
    (tableCue?.kind === "reveal" || tableCue?.kind === "play");
  const humanIsPlaying =
    tableCue?.actorId === HUMAN_PLAYER_INDEX &&
    (tableCue?.kind === "reveal" || tableCue?.kind === "play");
  const activeBotCard = botIsPlaying ? tableCue?.card : undefined;
  const priestRevealsBot =
    tableCue?.kind === "resolve" &&
    tableCue.card === "Priest" &&
    tableCue.targetId === opponent?.id &&
    tableCue.revealedCard;
  const playedHumanCardIndex = humanIsPlaying
    ? view.myHand.findIndex((card) => card === tableCue?.card)
    : -1;
  const showHumanShield =
    Boolean(me?.protected) ||
    (tableCue?.kind === "resolve" &&
      tableCue.card === "Handmaid" &&
      tableCue.actorId === HUMAN_PLAYER_INDEX);
  const showBotShield =
    Boolean(opponent?.protected) ||
    (tableCue?.kind === "resolve" &&
      tableCue.card === "Handmaid" &&
      tableCue.actorId === opponent?.id);

  const historyCards = useMemo(() => {
    if (historyPlayerId === null) {
      return [];
    }

    const player = view.players.find((entry) => entry.id === historyPlayerId);
    return player?.discardPile ?? [];
  }, [historyPlayerId, view.players]);

  function clearQueuedTimeouts() {
    for (const timeoutId of timeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }

    timeoutsRef.current = [];
  }

  function queueTimeout(callback: () => void, delay: number) {
    const timeoutId = window.setTimeout(() => {
      timeoutsRef.current = timeoutsRef.current.filter((id) => id !== timeoutId);
      callback();
    }, delay);

    timeoutsRef.current.push(timeoutId);
  }

  function startSequence() {
    clearQueuedTimeouts();
    sequenceInProgressRef.current = true;
    setIsSequencing(true);
  }

  function finishSequence(nextCue: TableCue | null = null) {
    sequenceInProgressRef.current = false;
    setIsSequencing(false);
    setTableCue(nextCue);
  }

  function finishActionSequence(nextState: GameState, action: PlayCardAction) {
    if (nextState.phase === "round-over" || nextState.phase === "game-over") {
      queueTimeout(() => {
        finishSequence(getWinCue(nextState));
      }, RESOLVE_CUE_MS);
      return;
    }

    queueTimeout(() => {
      finishSequence(null);
    }, action.card === "Priest" ? PRIEST_REVEAL_MS : RESOLVE_CUE_MS);
  }

  function playActionWithSequence(sourceState: GameState, action: PlayCardAction) {
    startSequence();
    setPendingChoices(null);
    setTableCue({
      ...getPlayCue(action),
      kind: "reveal",
      title: `${playerLabel(action.playerId)} reveals ${action.card}`,
      detail: "The chosen card turns face up.",
    });

    queueTimeout(() => {
      setTableCue(getPlayCue(action));

      queueTimeout(() => {
        const nextState = applyAction(sourceState, action);
        setState(nextState);
        setTableCue(getResolveCue(sourceState, nextState, action));
        finishActionSequence(nextState, action);
      }, PLAY_CUE_MS);
    }, REVEAL_CUE_MS);
  }

  useEffect(() => {
    return () => {
      clearQueuedTimeouts();
      sequenceInProgressRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (state.phase !== "awaiting-turn-draw") {
      return;
    }

    if (sequenceInProgressRef.current) {
      return;
    }

    const activePlayer = state.players[state.currentPlayerIndex];
    if (!activePlayer) {
      return;
    }

    startSequence();
    setTableCue({
      kind: "draw",
      actorId: activePlayer.id,
      title: `${playerLabel(activePlayer.id)} draws`,
      detail: "A card slides from the deck into the hand.",
    });

    queueTimeout(() => {
      setState((currentState) => drawCardForCurrentPlayer(currentState));
      finishSequence(null);
    }, DRAW_CUE_MS);
  }, [isSequencing, state]);

  useEffect(() => {
    if (state.phase !== "awaiting-card-play") {
      return;
    }

    if (currentPlayer?.id === HUMAN_PLAYER_INDEX) {
      return;
    }

    if (sequenceInProgressRef.current) {
      return;
    }

    const botView = getPlayerView(state, state.currentPlayerIndex);
    const botActions = getLegalActions(state);
    const bot = botRef.current;
    if (!bot) {
      return;
    }

    const botAction = bot.chooseAction(botView, botActions);
    playActionWithSequence(state, botAction as PlayCardAction);
  }, [currentPlayer?.id, isSequencing, state]);

  useEffect(() => {
    setPendingChoices(null);
  }, [state.phase, state.roundNumber]);

  function handleAction(action: PlayerAction) {
    if (action.type === "start-next-round") {
      clearQueuedTimeouts();
      sequenceInProgressRef.current = false;
      setIsSequencing(false);
      setTableCue(null);
      setPendingChoices(null);
      setState((currentState) => applyAction(currentState, action));
      return;
    }

    playActionWithSequence(state, action);
  }

  function handleCardTap(card: Card) {
    if (isSequencing) {
      return;
    }

    const choices = getPlayOptions(legalActions, card);

    if (choices.length === 0) {
      return;
    }

    if (choices.length === 1) {
      handleAction(choices[0]);
      return;
    }

    setPendingChoices(choices);
  }

  function handleResetGame() {
    clearQueuedTimeouts();
    sequenceInProgressRef.current = false;
    setIsSequencing(false);
    setTableCue(null);
    setPendingChoices(null);
    setHistoryPlayerId(null);
    botRef.current = createRandomBot(createSeed());
    setState(createGame());
  }

  return (
    <>
      <style>{MOBILE_BOARD_STYLES + MOBILE_EFFECT_STYLES}</style>
      <main className="game-shell">
      <header className="score-bar">
        <div className="score-side">
          <span className="score-name">You</span>
          <strong>
            {me?.tokens ?? 0}/{tokensToWin}
          </strong>
        </div>
        <div className="game-title">
          <span>Love Letter</span>
          <small>{formatPhase(state.phase)}</small>
        </div>
        <div className="score-side score-side-right">
          <span className="score-name">Bot</span>
          <strong>
            {opponent?.tokens ?? 0}/{tokensToWin}
          </strong>
        </div>
      </header>

      <section
        className={`table-surface ${isBotThinking ? "table-surface-bot-thinking" : ""} ${
          tableCue ? `table-surface-cue table-surface-cue-${tableCue.kind}` : ""
        }`}
      >
        <section className="opponent-zone" aria-label="Opponent area">
          {showBotShield && <ShieldAura />}
          <div className="zone-row">
            <div>
              <span className="zone-label">Opponent</span>
              <h2>{opponent?.name ?? "Bot"}</h2>
            </div>
            <button
              className="pile-stack pile-stack-opponent"
              onClick={() => setHistoryPlayerId(opponent?.id ?? 1)}
              type="button"
            >
              <span>{opponent?.discardPile.length ?? 0}</span>
              <strong>{opponent?.discardPile[opponent.discardPile.length - 1] ?? "Pile"}</strong>
            </button>
          </div>
          <div className="opponent-hand" aria-label="Bot hand">
            {!opponent?.eliminated &&
              Array.from({ length: 2 }).map((_, index) => {
                const isSelectedCard = botIsPlaying && index === 1;
                const slotClass = isSelectedCard
                  ? tableCue?.kind === "reveal"
                    ? "hand-card-slot-revealing"
                    : "hand-card-slot-playing hand-card-slot-playing-bot"
                  : priestRevealsBot && index === 0
                    ? "hand-card-slot-priest-reveal"
                    : "";

                return (
                  <div className={`hand-card-slot ${slotClass}`} key={`bot-card-${index}`}>
                    {priestRevealsBot && index === 0 ? (
                      <CardFace card={priestRevealsBot} size="small" />
                    ) : isSelectedCard && activeBotCard ? (
                      <CardFace card={activeBotCard} size="small" />
                    ) : (
                      <CardBack />
                    )}
                  </div>
                );
              })}
          </div>
        </section>

        <section className="center-table" aria-label="Table">
          <div className="deck-area">
            <CardBack stacked />
            <span>{view.cardsRemaining}</span>
            {tableCue?.kind === "draw" && (
              <div
                className={`draw-runner ${
                  tableCue.actorId === HUMAN_PLAYER_INDEX ? "draw-runner-you" : "draw-runner-bot"
                }`}
                aria-hidden="true"
              >
                <CardBack />
              </div>
            )}
          </div>

          <div
            className={`turn-stage turn-stage-${tableCue?.kind ?? "idle"} turn-stage-${tableCueTone}`}
            key={`${tableCue?.kind ?? "idle"}-${tableCue?.title ?? stageCard ?? "empty"}-${view.log.length}`}
          >
            <span className="stage-label">{stageLabel}</span>
            {tableCue?.kind === "draw" ? (
              <CardBack />
            ) : stageCard ? (
              <CardFace card={stageCard} size="small" />
            ) : (
              <div className="empty-stage">No cards played</div>
            )}
            {stageActorId !== null && tableCue?.kind !== "draw" && (
              <span className="stage-owner">{playerLabel(stageActorId)}</span>
            )}
          </div>

          <ActionEffect cue={tableCue} />

          <div className={`prompt-panel prompt-panel-${tableCueTone}`} aria-live="polite">
            <strong>{tableCue?.title ?? prompt.title}</strong>
            <span className="prompt-detail">{tableCue?.detail ?? prompt.detail}</span>
            {tableCue?.response && <em>{tableCue.response}</em>}
            {!tableCue && latestPublicEvent && <small>{formatEvent(latestPublicEvent)}</small>}
            {tableCue?.kind === "win" && <div className="win-flash" aria-hidden="true" />}
          </div>

          {tableCue?.speech && (
            <div
              className={`cue-bubbles cue-bubbles-${
                tableCue.actorId === HUMAN_PLAYER_INDEX ? "you" : "bot"
              }`}
            >
              <span className="speech-bubble speech-bubble-actor">{tableCue.speech}</span>
              {tableCue.response && (
                <span className={`speech-bubble speech-bubble-response speech-bubble-${tableCueTone}`}>
                  {tableCue.response}
                </span>
              )}
            </div>
          )}

          {knownCards.length > 0 && (
            <div className="intel-strip">
              {knownCards.map(([playerId, card]) => (
                <span key={playerId}>
                  {playerLabel(Number(playerId))}: {card}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="player-zone" aria-label="Your area">
          {showHumanShield && <ShieldAura />}
          <div className="player-tools">
            <button
              className="pile-stack pile-stack-player"
              onClick={() => setHistoryPlayerId(HUMAN_PLAYER_INDEX)}
              type="button"
            >
              <span>{me?.discardPile.length ?? 0}</span>
              <strong>{me?.discardPile[me.discardPile.length - 1] ?? "Pile"}</strong>
            </button>
            <button className="reset-button" onClick={handleResetGame} type="button">
              Reset
            </button>
          </div>

          <div className="player-hand" aria-label="Your hand">
            {view.myHand.map((card, index) => {
              const choices = getPlayOptions(legalActions, card);
              const playable = isHumanTurn && choices.length > 0 && !isSequencing;

              const isSelectedCard = index === playedHumanCardIndex;
              const slotClass = isSelectedCard
                ? tableCue?.kind === "reveal"
                  ? "hand-card-slot-revealing"
                  : "hand-card-slot-playing hand-card-slot-playing-you"
                : "";

              return (
                <div className={`hand-card-slot ${slotClass}`} key={`${card}-${index}`}>
                  <CardFace
                    card={card}
                    disabled={!playable}
                    onClick={playable ? () => handleCardTap(card) : undefined}
                  />
                </div>
              );
            })}
          </div>

          {(state.phase === "round-over" || state.phase === "game-over") && (
            <div className="action-row">
              {state.phase === "round-over" && !isSequencing && (
                <button
                  className="primary-button"
                  onClick={() => handleAction({ type: "start-next-round" })}
                  type="button"
                >
                  Next round
                </button>
              )}
              {state.phase === "game-over" && !isSequencing && (
                <button className="primary-button" onClick={handleResetGame} type="button">
                  New game
                </button>
              )}
            </div>
          )}
        </section>
      </section>

      {pendingChoices && pendingChoices.length > 0 && (
        <div className="overlay" role="presentation">
          <section aria-modal="true" className="bottom-sheet" role="dialog">
            <div className="sheet-header">
              <div>
                <span className="zone-label">Choose</span>
                <h2>{getChoiceSheetTitle(pendingChoices[0])}</h2>
              </div>
              <button
                aria-label="Close card choices"
                className="icon-button"
                onClick={() => setPendingChoices(null)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="sheet-list">
              {pendingChoices.map((action, index) => (
                <button
                  className="sheet-option"
                  key={`${action.card}-${action.targetId ?? "self"}-${action.guess ?? "none"}-${index}`}
                  onClick={() => handleAction(action)}
                  type="button"
                >
                  <strong>{getChoiceLabel(action)}</strong>
                  {action.card !== "Guard" && <span>{getChoiceHint(action)}</span>}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {historyPlayerId !== null && (
        <div className="overlay" role="presentation">
          <section aria-modal="true" className="bottom-sheet" role="dialog">
            <div className="sheet-header">
              <div>
                <span className="zone-label">Played cards</span>
                <h2>{playerLabel(historyPlayerId)}</h2>
              </div>
              <button
                aria-label="Close discard history"
                className="icon-button"
                onClick={() => setHistoryPlayerId(null)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="history-list">
              {historyCards.length > 0 ? (
                historyCards.map((card, index) => (
                  <div className="history-item" key={`${card}-${index}`}>
                    <CardFace card={card} size="small" />
                    <div>
                      <strong>
                        {index + 1}. {card}
                      </strong>
                      <span>{CARD_TEXT[card]}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-copy">No cards played.</p>
              )}
            </div>
          </section>
        </div>
      )}
      </main>
    </>
  );
}
