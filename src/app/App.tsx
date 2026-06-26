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
const DRAW_CUE_MS = 950;
const PLAY_CUE_MS = 1050;
const RESOLVE_CUE_MS = 1350;

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
  kind: "draw" | "play" | "resolve" | "win";
  actorId?: number;
  card?: Card;
  targetId?: number;
  title: string;
  detail: string;
  speech?: string;
  response?: string;
  tone?: CueTone;
};

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

function createGame() {
  return createInitialGame({
    playerNames: ["You", "Bot"],
    seed: 1,
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
  if (action.card === "Guard") {
    return "A correct guess eliminates the bot.";
  }

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
  disabled = false,
  onClick,
  size = "large",
}: {
  card: Card;
  disabled?: boolean;
  onClick?: () => void;
  size?: "large" | "small";
}) {
  const className = `card-face card-face-${cardClass(card)} card-face-${size}`;

  if (onClick) {
    return (
      <button className={className} disabled={disabled} onClick={onClick} type="button">
        <CardContents card={card} />
      </button>
    );
  }

  return (
    <div className={className}>
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

export function App() {
  const [state, setState] = useState(createGame);
  const [pendingChoices, setPendingChoices] = useState<PlayCardAction[] | null>(null);
  const [historyPlayerId, setHistoryPlayerId] = useState<number | null>(null);
  const [tableCue, setTableCue] = useState<TableCue | null>(null);
  const [isSequencing, setIsSequencing] = useState(false);
  const sequenceInProgressRef = useRef(false);
  const timeoutsRef = useRef<number[]>([]);
  const botRef = useRef(createRandomBot(99));
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
  const stageCard = tableCue?.card ?? lastPlayedEvent?.card ?? null;
  const stageActorId = tableCue?.actorId ?? lastPlayedEvent?.playerId ?? null;
  const stageLabel = tableCue
    ? tableCue.kind === "draw"
      ? `${playerLabel(tableCue.actorId ?? HUMAN_PLAYER_INDEX)} draws`
      : tableCue.kind === "win"
        ? "Round result"
        : `${playerLabel(tableCue.actorId ?? HUMAN_PLAYER_INDEX)} ${tableCue.kind === "play" ? "plays" : "resolves"}`
    : lastPlayedEvent
      ? `${playerLabel(lastPlayedEvent.playerId)} played`
      : "Opening deal";
  const tableCueTone = tableCue?.tone ?? "neutral";

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

  function finishActionSequence(nextState: GameState) {
    if (nextState.phase === "round-over" || nextState.phase === "game-over") {
      queueTimeout(() => {
        finishSequence(getWinCue(nextState));
      }, RESOLVE_CUE_MS);
      return;
    }

    queueTimeout(() => {
      finishSequence(null);
    }, RESOLVE_CUE_MS);
  }

  function playActionWithSequence(sourceState: GameState, action: PlayCardAction) {
    startSequence();
    setPendingChoices(null);
    setTableCue(getPlayCue(action));

    queueTimeout(() => {
      const nextState = applyAction(sourceState, action);
      setState(nextState);
      setTableCue(getResolveCue(sourceState, nextState, action));
      finishActionSequence(nextState);
    }, PLAY_CUE_MS);
  }

  useEffect(() => {
    return () => {
      clearQueuedTimeouts();
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
    const botAction = botRef.current.chooseAction(botView, botActions);
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
    setState(createGame());
  }

  return (
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
            {Array.from({ length: opponent?.handSize ?? 0 }).map((_, index) => (
              <CardBack key={`bot-card-${index}`} />
            ))}
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

          <div className={`prompt-panel prompt-panel-${tableCueTone}`}>
            <strong>{tableCue?.title ?? prompt.title}</strong>
            <span>{tableCue?.detail ?? prompt.detail}</span>
            {tableCue?.response && <em>{tableCue.response}</em>}
            {!tableCue && latestPublicEvent && <small>{formatEvent(latestPublicEvent)}</small>}
            {tableCue?.kind === "win" && <div className="win-flash" aria-hidden="true" />}
          </div>

          {tableCue?.speech && (
            <div className="cue-bubbles">
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
          <button
            className="pile-stack pile-stack-player"
            onClick={() => setHistoryPlayerId(HUMAN_PLAYER_INDEX)}
            type="button"
          >
            <span>{me?.discardPile.length ?? 0}</span>
            <strong>{me?.discardPile[me.discardPile.length - 1] ?? "Pile"}</strong>
          </button>

          <div className="player-hand" aria-label="Your hand">
            {view.myHand.map((card, index) => {
              const choices = getPlayOptions(legalActions, card);
              const playable = isHumanTurn && choices.length > 0 && !isSequencing;

              return (
                <CardFace
                  card={card}
                  disabled={!playable}
                  key={`${card}-${index}`}
                  onClick={playable ? () => handleCardTap(card) : undefined}
                />
              );
            })}
          </div>

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
            <button className="ghost-button" onClick={handleResetGame} type="button">
              Reset
            </button>
          </div>
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
  );
}
