import { useEffect, useRef, useState } from "react";
import { createRandomBot } from "../bots/randomBot";
import { applyAction } from "../engine/applyAction";
import { getLegalActions } from "../engine/legalActions";
import { getPlayerView } from "../engine/playerView";
import { createInitialGame } from "../engine/setupRound";
import { drawCardForCurrentPlayer } from "../engine/turnFlow";
import type { PlayerAction, PublicGameEvent } from "../engine/types";

const HUMAN_PLAYER_INDEX = 0;

function formatAction(action: PlayerAction) {
  if (action.type === "start-next-round") {
    return "Start next round";
  }

  const target = action.targetId === undefined ? "" : ` -> ${playerLabel(action.targetId)}`;
  const guess = action.guess ? ` (${action.guess})` : "";
  return `${action.card}${target}${guess}`;
}

function formatEvent(event: PublicGameEvent) {
  if (event.type === "turn-started") {
    return `Turn started: ${playerLabel(event.playerId)}`;
  }

  if (event.type === "card-played") {
    return `Played ${event.card}${event.targetId === undefined ? "" : ` on ${playerLabel(event.targetId)}`}`;
  }

  if (event.type === "player-eliminated") {
    return `${playerLabel(event.playerId)} eliminated: ${event.reason}`;
  }

  if (event.type === "token-awarded") {
    return `Token awarded to ${playerLabel(event.playerId)}`;
  }

  return `Round ended: ${playerLabel(event.winnerId)} (${event.reason})`;
}

function playerLabel(playerId: number) {
  return playerId === HUMAN_PLAYER_INDEX ? "You" : `Bot ${playerId}`;
}

function createGame() {
  return createInitialGame({
    playerNames: ["You", "Bot"],
    seed: 1,
  });
}

export function App() {
  const [state, setState] = useState(createGame);
  const botRef = useRef(createRandomBot(99));
  const view = getPlayerView(state, HUMAN_PLAYER_INDEX);
  const legalActions = getLegalActions(state);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const isHumanTurn =
    state.phase === "awaiting-card-play" &&
    currentPlayer?.id === HUMAN_PLAYER_INDEX;

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
        <p className="eyebrow">Love Letter</p>
        <h1>Playable engine-first prototype</h1>
        <p className="lede">
          The rules run in the pure engine. This UI only advances turns,
          displays public information, and submits explicit player actions.
        </p>
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

      <section className="grid">
        <article className="panel">
          <h2>Round Snapshot</h2>
          <dl className="facts">
            <div>
              <dt>Current player</dt>
              <dd>{currentPlayer?.name}</dd>
            </div>
            <div>
              <dt>Phase</dt>
              <dd>{state.phase}</dd>
            </div>
            <div>
              <dt>Cards remaining</dt>
              <dd>{view.cardsRemaining}</dd>
            </div>
            <div>
              <dt>Round</dt>
              <dd>{state.roundNumber}</dd>
            </div>
            <div>
              <dt>Winner</dt>
              <dd>
                {state.roundWinnerId === null
                  ? "In progress"
                  : playerLabel(state.roundWinnerId)}
              </dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h2>Players</h2>
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
                <p className="player-meta">
                  {player.eliminated ? "Eliminated" : player.protected ? "Protected" : "Active"}
                </p>
                <p className="player-meta">
                  Hand:{" "}
                  {player.id === HUMAN_PLAYER_INDEX
                    ? view.myHand.join(", ")
                    : `${player.handSize} hidden card`}
                </p>
                <p className="player-meta">
                  Discards: {player.discardPile.length ? player.discardPile.join(", ") : "None"}
                </p>
              </section>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2>Available Actions</h2>
          {isHumanTurn ? (
            <div className="action-list">
              {legalActions.map((action) => (
                <button
                  className="action-button"
                  key={formatAction(action)}
                  onClick={() => handlePlayAction(action)}
                  type="button"
                >
                  {formatAction(action)}
                </button>
              ))}
            </div>
          ) : (
            <p className="status-copy">
              {state.phase === "round-over"
                ? "Round finished."
                : `${currentPlayer?.name ?? "Bot"} is taking a turn.`}
            </p>
          )}
        </article>

        <article className="panel">
          <h2>Public Log</h2>
          <ul className="list">
            {view.log.map((event, index) => (
              <li key={`${event.type}-${index}`}>{formatEvent(event)}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
