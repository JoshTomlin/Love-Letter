import { useEffect, useRef, useState } from "react";
import { createRandomBot } from "../bots/randomBot";
import { applyAction } from "../engine/applyAction";
import { getLegalActions } from "../engine/legalActions";
import { getPlayerView } from "../engine/playerView";
import { createInitialGame } from "../engine/setupRound";
import { drawCardForCurrentPlayer } from "../engine/turnFlow";
import type { PlayerAction, PublicGameEvent, RoundPhase } from "../engine/types";

const HUMAN_PLAYER_INDEX = 0;

const TURN_STEPS: Array<{ phase: RoundPhase; label: string; detail: string }> = [
  {
    phase: "awaiting-turn-draw",
    label: "Draw",
    detail: "The active player takes a second card.",
  },
  {
    phase: "awaiting-card-play",
    label: "Choose",
    detail: "One of the two cards must be played.",
  },
  {
    phase: "round-over",
    label: "Score",
    detail: "The winner earns a token and the table resets.",
  },
];

function playerLabel(playerId: number) {
  return playerId === HUMAN_PLAYER_INDEX ? "You" : `Bot ${playerId}`;
}

function formatReason(reason: string) {
  const descriptions: Record<string, string> = {
    "guard-correct-guess": "a correct Guard guess",
    "baron-lower-card": "losing a Baron comparison",
    "discarded-princess": "discarding the Princess",
    "last-player-standing": "being the last player standing",
    "deck-empty": "holding the strongest hand when the deck ran out",
  };

  return descriptions[reason] ?? reason.replace(/-/g, " ");
}

function formatPhaseLabel(phase: RoundPhase) {
  const labels: Record<RoundPhase, string> = {
    "round-start": "Round setup",
    "awaiting-turn-draw": "Draw step",
    "awaiting-card-play": "Decision step",
    "resolving-action": "Resolving action",
    "round-over": "Round over",
  };

  return labels[phase];
}

function formatActionLabel(action: PlayerAction) {
  if (action.type === "start-next-round") {
    return "Start the next round";
  }

  if (action.card === "Guard") {
    return `Play Guard and guess ${action.guess} on ${playerLabel(action.targetId ?? HUMAN_PLAYER_INDEX)}`;
  }

  if (action.targetId !== undefined) {
    return `Play ${action.card} on ${playerLabel(action.targetId)}`;
  }

  return `Play ${action.card}`;
}

function formatActionHint(action: PlayerAction) {
  if (action.type === "start-next-round") {
    return "Shuffle up and let the previous round winner lead.";
  }

  const targetLabel =
    action.targetId === undefined ? null : playerLabel(action.targetId);

  switch (action.card) {
    case "Guard":
      return `If ${targetLabel} is holding ${action.guess}, they are eliminated.`;
    case "Priest":
      return `Peek at ${targetLabel}'s hidden card.`;
    case "Baron":
      return `Compare hands with ${targetLabel}. The lower card is eliminated.`;
    case "Handmaid":
      return "Stay untouchable until your next turn begins.";
    case "Prince":
      return `${targetLabel} discards their hand and draws a replacement.`;
    case "King":
      return `Swap hands with ${targetLabel}.`;
    case "Countess":
      return "No effect, but sometimes the rules force this play.";
    case "Princess":
      return "Dangerous play: Princess only stays safe in your hand.";
    default:
      return "";
  }
}

function formatEvent(event: PublicGameEvent) {
  if (event.type === "turn-started") {
    return `${playerLabel(event.playerId)} begins the turn.`;
  }

  if (event.type === "card-played") {
    return `${playerLabel(event.playerId)} played ${event.card}${
      event.targetId === undefined ? "" : ` on ${playerLabel(event.targetId)}`
    }.`;
  }

  if (event.type === "player-eliminated") {
    return `${playerLabel(event.playerId)} was eliminated by ${formatReason(event.reason)}.`;
  }

  if (event.type === "token-awarded") {
    return `${playerLabel(event.playerId)} earned a token.`;
  }

  return `${playerLabel(event.winnerId)} won the round by ${formatReason(event.reason)}.`;
}

function createGame() {
  return createInitialGame({
    playerNames: ["You", "Bot"],
    seed: 1,
  });
}

function getStatusCopy(
  phase: RoundPhase,
  currentPlayerName: string | undefined,
  isHumanTurn: boolean,
  winnerId: number | null,
) {
  if (phase === "round-over") {
    return {
      eyebrow: "Round complete",
      title:
        winnerId === null ? "This round has ended." : `${playerLabel(winnerId)} won the round.`,
      body: "Use the next-round button to deal fresh hands while keeping token scores.",
    };
  }

  if (phase === "awaiting-turn-draw") {
    return {
      eyebrow: `${currentPlayerName ?? "A player"} is drawing`,
      title: "A new turn is starting.",
      body: "Each turn begins with the active player drawing a second card before choosing one to play.",
    };
  }

  if (isHumanTurn) {
    return {
      eyebrow: "Your decision",
      title: "Choose one card to play.",
      body: "You must play exactly one of the two cards in your hand. The other card stays with you.",
    };
  }

  return {
    eyebrow: `${currentPlayerName ?? "The bot"} is thinking`,
    title: "The bot is choosing a play.",
    body: "Watch the table and recent events to see what information the bot is acting on.",
  };
}

function getVisibleBurnSummary(cards: string[]) {
  if (cards.length === 0) {
    return "No face-up burned cards in this ruleset.";
  }

  return cards.join(", ");
}

export function App() {
  const [state, setState] = useState(createGame);
  const botRef = useRef(createRandomBot(99));
  const view = getPlayerView(state, HUMAN_PLAYER_INDEX);
  const legalActions = getLegalActions(state);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const isHumanTurn =
    state.phase === "awaiting-card-play" && currentPlayer?.id === HUMAN_PLAYER_INDEX;
  const publicEvents = [...view.log].reverse();
  const latestEvent = publicEvents[0] ?? null;
  const knownCards = Object.entries(state.players[HUMAN_PLAYER_INDEX]?.seenCards ?? {});
  const statusCopy = getStatusCopy(
    state.phase,
    currentPlayer?.name,
    isHumanTurn,
    state.roundWinnerId,
  );

  useEffect(() => {
    if (state.phase !== "awaiting-turn-draw") {
      return;
    }

    setState((currentState) => drawCardForCurrentPlayer(currentState));
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "awaiting-card-play") {
      return;
    }

    if (currentPlayer?.id === HUMAN_PLAYER_INDEX) {
      return;
    }

    const timer = window.setTimeout(() => {
      setState((currentState) => {
        const botView = getPlayerView(currentState, currentState.currentPlayerIndex);
        const botActions = getLegalActions(currentState);
        const botAction = botRef.current.chooseAction(botView, botActions);
        return applyAction(currentState, botAction);
      });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [currentPlayer?.id, state.phase]);

  function handlePlayAction(action: PlayerAction) {
    setState((currentState) => applyAction(currentState, action));
  }

  function handleStartNextRound() {
    setState((currentState) =>
      applyAction(currentState, { type: "start-next-round" }),
    );
  }

  function handleResetGame() {
    setState(createGame());
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Love Letter</p>
          <h1>A clearer table for following every turn</h1>
          <p className="lede">
            The rules still live in the pure engine, but the screen now explains
            who is acting, what stage the round is in, and why each move matters.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={handleResetGame} type="button">
            Reset game
          </button>
          {state.phase === "round-over" && (
            <button
              className="secondary-button"
              onClick={handleStartNextRound}
              type="button"
            >
              Start next round
            </button>
          )}
        </div>
      </section>

      <section className="status-layout">
        <article className="status-card panel-accent">
          <p className="status-eyebrow">{statusCopy.eyebrow}</p>
          <h2>{statusCopy.title}</h2>
          <p className="status-body">{statusCopy.body}</p>
          {latestEvent && (
            <p className="status-latest">
              <strong>Latest table update:</strong> {formatEvent(latestEvent)}
            </p>
          )}
        </article>

        <article className="steps-card">
          <h2>Turn flow</h2>
          <ol className="step-list">
            {TURN_STEPS.map((step) => {
              const isActive = state.phase === step.phase;
              const isComplete =
                state.phase === "awaiting-card-play" && step.phase === "awaiting-turn-draw";
              const isScored = state.phase === "round-over" && step.phase !== "round-over";

              return (
                <li
                  className={`step-item ${isActive ? "step-item-active" : ""} ${
                    isComplete || isScored ? "step-item-complete" : ""
                  }`}
                  key={step.label}
                >
                  <span className="step-marker" aria-hidden="true" />
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </article>
      </section>

      <section className="board-grid">
        <article className="panel panel-wide">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Your view</p>
              <h2>Your hand</h2>
            </div>
            <span className="phase-pill">{formatPhaseLabel(state.phase)}</span>
          </div>
          <div className="hand-card-row">
            {view.myHand.map((card) => (
              <div className="hand-card" key={card}>
                <span className="hand-card-label">{card}</span>
              </div>
            ))}
          </div>
          <p className="support-copy">
            {isHumanTurn
              ? "Choose the card you want to reveal. The other card remains hidden in your hand."
              : "Your hand stays visible here so you can keep your options in mind while the turn advances."}
          </p>
        </article>

        <article className="panel">
          <h2>Choose your play</h2>
          {isHumanTurn ? (
            <div className="action-list">
              {legalActions.map((action) => (
                <button
                  className="action-button"
                  key={formatActionLabel(action)}
                  onClick={() => handlePlayAction(action)}
                  type="button"
                >
                  <strong>{formatActionLabel(action)}</strong>
                  <span>{formatActionHint(action)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="status-copy">
              {state.phase === "round-over"
                ? "This round is finished. Start the next round when you're ready."
                : `${currentPlayer?.name ?? "Bot"} is the active player right now.`}
            </p>
          )}
        </article>

        <article className="panel">
          <h2>Round snapshot</h2>
          <dl className="facts">
            <div>
              <dt>Active player</dt>
              <dd>{currentPlayer?.name}</dd>
            </div>
            <div>
              <dt>Current step</dt>
              <dd>{formatPhaseLabel(state.phase)}</dd>
            </div>
            <div>
              <dt>Cards left in deck</dt>
              <dd>{view.cardsRemaining}</dd>
            </div>
            <div>
              <dt>Round number</dt>
              <dd>{state.roundNumber}</dd>
            </div>
            <div>
              <dt>Face-up burns</dt>
              <dd>{getVisibleBurnSummary(state.visibleBurnedCards)}</dd>
            </div>
            <div>
              <dt>Winner</dt>
              <dd>
                {state.roundWinnerId === null ? "Still in progress" : playerLabel(state.roundWinnerId)}
              </dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h2>Players at the table</h2>
          <div className="player-stack">
            {view.players.map((player, index) => (
              <section
                className={`player-card ${index === state.currentPlayerIndex ? "player-card-active" : ""}`}
                key={player.id}
              >
                <div className="player-card-header">
                  <strong>{player.name}</strong>
                  <span>{player.tokens} token(s)</span>
                </div>
                <p className="player-state">
                  {player.eliminated ? "Eliminated" : player.protected ? "Protected by Handmaid" : "Still in the round"}
                </p>
                <p className="player-meta">
                  Hand: {player.id === HUMAN_PLAYER_INDEX ? view.myHand.join(", ") : `${player.handSize} hidden card`}
                </p>
                <p className="player-meta">
                  Discards: {player.discardPile.length ? player.discardPile.join(", ") : "None yet"}
                </p>
              </section>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2>Your notes</h2>
          {knownCards.length > 0 ? (
            <ul className="note-list">
              {knownCards.map(([playerId, card]) => (
                <li key={playerId}>
                  You previously saw that {playerLabel(Number(playerId))} was holding {card}.
                </li>
              ))}
            </ul>
          ) : (
            <p className="status-copy">
              You have not privately seen any opponent cards yet.
            </p>
          )}
        </article>

        <article className="panel panel-wide">
          <h2>Recent events</h2>
          <ul className="event-list">
            {publicEvents.map((event, index) => (
              <li key={`${event.type}-${index}`}>{formatEvent(event)}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
