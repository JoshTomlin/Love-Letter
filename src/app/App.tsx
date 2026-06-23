import { useEffect, useMemo, useRef, useState } from "react";
import { createRandomBot } from "../bots/randomBot";
import { CARD_VALUES } from "../engine/constants";
import { applyAction } from "../engine/applyAction";
import { getLegalActions } from "../engine/legalActions";
import { getPlayerView } from "../engine/playerView";
import { createInitialGame } from "../engine/setupRound";
import { drawCardForCurrentPlayer } from "../engine/turnFlow";
import type {
  Card,
  PlayCardAction,
  PlayerAction,
  PublicGameEvent,
  RoundPhase,
} from "../engine/types";

const HUMAN_PLAYER_INDEX = 0;

const CARD_TEXT: Record<Card, string> = {
  Guard: "Name a non-Guard card. A correct guess knocks the bot out.",
  Priest: "Secretly peek at the bot's hand.",
  Baron: "Compare hands. The lower value is eliminated.",
  Handmaid: "You cannot be targeted until your next turn.",
  Prince: "Target a player to discard their hand and redraw.",
  King: "Swap hands with the bot.",
  Countess: "No effect, but sometimes the rules force you to play it.",
  Princess: "If this leaves your hand, you are eliminated.",
};

function playerLabel(playerId: number) {
  return playerId === HUMAN_PLAYER_INDEX ? "You" : "Bot";
}

function formatReason(reason: string) {
  const descriptions: Record<string, string> = {
    "guard-correct-guess": "a correct Guard guess",
    "baron-lower-card": "losing the Baron comparison",
    "discarded-princess": "discarding the Princess",
    "last-player-standing": "being the last player standing",
    "deck-empty": "holding the stronger hand when the deck ran out",
  };

  return descriptions[reason] ?? reason.replace(/-/g, " ");
}

function formatPhase(phase: RoundPhase) {
  const labels: Record<RoundPhase, string> = {
    "round-start": "Setting the table",
    "awaiting-turn-draw": "Drawing a second card",
    "awaiting-card-play": "Choosing a card to play",
    "resolving-action": "Resolving the move",
    "round-over": "Round complete",
  };

  return labels[phase];
}

function formatEvent(event: PublicGameEvent) {
  if (event.type === "turn-started") {
    return `${playerLabel(event.playerId)} started a turn.`;
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

function getStatusSummary(
  phase: RoundPhase,
  isHumanTurn: boolean,
  currentPlayerName: string | undefined,
  roundWinnerId: number | null,
) {
  if (phase === "round-over") {
    return {
      eyebrow: "Round over",
      title:
        roundWinnerId === null
          ? "The round has finished."
          : `${playerLabel(roundWinnerId)} won the token.`,
      body: "Start the next round to deal fresh hands and keep the score going.",
    };
  }

  if (phase === "awaiting-turn-draw") {
    return {
      eyebrow: `${currentPlayerName ?? "A player"} is drawing`,
      title: "A turn begins with a second card.",
      body: "Once the extra card is drawn, one of the two cards must be played immediately.",
    };
  }

  if (isHumanTurn) {
    return {
      eyebrow: "Your turn",
      title: "Tap one of your two cards to play it.",
      body: "If a card needs extra input, a choice sheet will appear for the target or guess.",
    };
  }

  return {
    eyebrow: "Bot turn",
    title: "The bot is deciding what to play.",
    body: "You can still inspect either discard pile while the bot thinks.",
  };
}

function getPlayOptions(legalActions: PlayerAction[], card: Card) {
  return legalActions.filter(
    (action): action is PlayCardAction =>
      action.type === "play-card" && action.card === card,
  );
}

function getChoiceSheetTitle(action: PlayCardAction | undefined) {
  if (!action) {
    return "Choose an option";
  }

  switch (action.card) {
    case "Guard":
      return "What would you like to guess?";
    case "Prince":
      return "Who should the Prince target?";
    case "Priest":
    case "Baron":
    case "King":
      return "Choose the target";
    default:
      return "Choose an option";
  }
}

function getChoiceLabel(action: PlayCardAction) {
  if (action.card === "Guard") {
    return action.guess ? `Guess ${action.guess}` : "Play Guard";
  }

  if (action.targetId !== undefined) {
    return playerLabel(action.targetId);
  }

  return `Play ${action.card}`;
}

function getChoiceHint(action: PlayCardAction) {
  if (action.card === "Guard") {
    return "If the guess is right, the bot is eliminated.";
  }

  if (action.card === "Prince" && action.targetId === HUMAN_PLAYER_INDEX) {
    return "You will discard your hand and draw a replacement.";
  }

  if (action.card === "Prince") {
    return "The bot will discard its hand and draw a replacement.";
  }

  if (action.card === "Priest") {
    return "Peek at the bot's hidden card.";
  }

  if (action.card === "Baron") {
    return "Compare hands. Lower card loses.";
  }

  if (action.card === "King") {
    return "Swap your hand with the bot's hand.";
  }

  return CARD_TEXT[action.card];
}

function getDiscardHistory(cards: Card[]) {
  return cards.length > 0 ? cards : [];
}

export function App() {
  const [state, setState] = useState(createGame);
  const [pendingChoices, setPendingChoices] = useState<PlayCardAction[] | null>(null);
  const [historyPlayerId, setHistoryPlayerId] = useState<number | null>(null);
  const botRef = useRef(createRandomBot(99));
  const view = getPlayerView(state, HUMAN_PLAYER_INDEX);
  const legalActions = getLegalActions(state);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const opponent = view.players.find((player) => player.id !== HUMAN_PLAYER_INDEX) ?? null;
  const isHumanTurn =
    state.phase === "awaiting-card-play" && currentPlayer?.id === HUMAN_PLAYER_INDEX;
  const latestPublicEvent = [...view.log].reverse()[0] ?? null;
  const knownCards = Object.entries(state.players[HUMAN_PLAYER_INDEX]?.seenCards ?? {});
  const statusSummary = getStatusSummary(
    state.phase,
    isHumanTurn,
    currentPlayer?.name,
    state.roundWinnerId,
  );

  const historyCards = useMemo(() => {
    if (historyPlayerId === null) {
      return [];
    }

    const player = view.players.find((entry) => entry.id === historyPlayerId);
    return getDiscardHistory(player?.discardPile ?? []);
  }, [historyPlayerId, view.players]);

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

  useEffect(() => {
    setPendingChoices(null);
  }, [state.phase, state.roundNumber]);

  function handleAction(action: PlayerAction) {
    setPendingChoices(null);
    setState((currentState) => applyAction(currentState, action));
  }

  function handleCardTap(card: Card) {
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
    setPendingChoices(null);
    setHistoryPlayerId(null);
    setState(createGame());
  }

  return (
    <main className="game-shell">
      <section className="top-bar">
        <div>
          <p className="bar-label">Love Letter</p>
          <h1>Phone-first duel table</h1>
        </div>
        <button className="ghost-button" onClick={handleResetGame} type="button">
          Reset
        </button>
      </section>

      <section className="status-banner">
        <p className="status-eyebrow">{statusSummary.eyebrow}</p>
        <h2>{statusSummary.title}</h2>
        <p className="status-copy">{statusSummary.body}</p>
        <div className="status-chips">
          <span className="status-chip">Round {state.roundNumber}</span>
          <span className="status-chip">Deck {view.cardsRemaining}</span>
          <span className="status-chip">{formatPhase(state.phase)}</span>
        </div>
        {latestPublicEvent && <p className="latest-event">Latest: {formatEvent(latestPublicEvent)}</p>}
      </section>

      <section className="table-surface">
        <section className="opponent-zone">
          <div className="zone-header">
            <div>
              <p className="zone-label">Opponent</p>
              <h3>{opponent?.name ?? "Bot"}</h3>
            </div>
            <span className="token-badge">{opponent?.tokens ?? 0} token(s)</span>
          </div>
          <div className="opponent-hand" aria-label="Bot hand">
            {Array.from({ length: opponent?.handSize ?? 0 }).map((_, index) => (
              <div className="card-back" key={`bot-card-${index}`}>
                <div className="card-back-inner" />
              </div>
            ))}
          </div>
          <button
            className="pile-button"
            onClick={() => setHistoryPlayerId(opponent?.id ?? 1)}
            type="button"
          >
            <span className="pile-label">Bot discard pile</span>
            <span className="pile-top-card">
              {opponent?.discardPile[opponent.discardPile.length - 1] ?? "Empty"}
            </span>
          </button>
        </section>

        <section className="center-strip">
          <div className="info-card">
            <p className="info-label">Round state</p>
            <strong>{currentPlayer?.name ?? "Bot"} is active</strong>
            <span>
              {state.visibleBurnedCards.length > 0
                ? `Face-up burns: ${state.visibleBurnedCards.join(", ")}`
                : "No face-up burned cards"}
            </span>
          </div>
          <div className="info-card">
            <p className="info-label">What you know</p>
            {knownCards.length > 0 ? (
              <span>
                {knownCards
                  .map(([playerId, card]) => `${playerLabel(Number(playerId))}: ${card}`)
                  .join(" | ")}
              </span>
            ) : (
              <span>No revealed opponent card remembered yet.</span>
            )}
          </div>
        </section>

        <section className="player-zone">
          <button
            className="pile-button player-pile"
            onClick={() => setHistoryPlayerId(HUMAN_PLAYER_INDEX)}
            type="button"
          >
            <span className="pile-label">Your discard pile</span>
            <span className="pile-top-card">
              {view.players[HUMAN_PLAYER_INDEX]?.discardPile[view.players[HUMAN_PLAYER_INDEX].discardPile.length - 1] ?? "Empty"}
            </span>
          </button>

          <div className="zone-header">
            <div>
              <p className="zone-label">Your hand</p>
              <h3>Tap a card to play it</h3>
            </div>
            <span className="token-badge">{view.players[HUMAN_PLAYER_INDEX]?.tokens ?? 0} token(s)</span>
          </div>

          <div className="player-hand" aria-label="Your hand">
            {view.myHand.map((card, index) => {
              const choices = getPlayOptions(legalActions, card);
              const playable = isHumanTurn && choices.length > 0;

              return (
                <button
                  className={`hand-card ${playable ? "hand-card-playable" : "hand-card-disabled"}`}
                  disabled={!playable}
                  key={`${card}-${index}`}
                  onClick={() => handleCardTap(card)}
                  type="button"
                >
                  <span className="hand-card-value">{CARD_VALUES[card]}</span>
                  <span className="hand-card-name">{card}</span>
                  <span className="hand-card-text">{CARD_TEXT[card]}</span>
                </button>
              );
            })}
          </div>

          <p className="tap-help">
            {isHumanTurn
              ? "Tap a card. If it needs a target or guess, a choice sheet will slide up."
              : state.phase === "round-over"
                ? "Start the next round when you're ready."
                : "Wait for the bot's move, then your next two-card hand will appear here."}
          </p>

          {state.phase === "round-over" && (
            <button
              className="primary-button"
              onClick={() => handleAction({ type: "start-next-round" })}
              type="button"
            >
              Start next round
            </button>
          )}
        </section>
      </section>

      {pendingChoices && pendingChoices.length > 0 && (
        <div className="overlay" role="presentation">
          <section aria-modal="true" className="bottom-sheet" role="dialog">
            <div className="sheet-header">
              <div>
                <p className="zone-label">Card choice</p>
                <h3>{getChoiceSheetTitle(pendingChoices[0])}</h3>
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
                  <span>{getChoiceHint(action)}</span>
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
                <p className="zone-label">Discard history</p>
                <h3>{playerLabel(historyPlayerId)} played</h3>
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
                    <span>{index + 1}.</span>
                    <strong>{card}</strong>
                    <span>{CARD_TEXT[card]}</span>
                  </div>
                ))
              ) : (
                <p className="empty-copy">No cards have been discarded yet.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

