# Love Letter

A browser implementation of the classic Love Letter card game, built around a
bot that has to reason with the same incomplete information as a human player.

The app is a complete two-player game. The rules engine is deterministic, the
bot maintains a weighted range of possible opponent cards, and the interface
can show the reasoning behind the bot's latest decision.

## Why this project exists

Love Letter has a small deck and simple rules, but choosing a strong move is not
straightforward. Most of the state is hidden, and each public action changes
what the other player is likely to hold.

This project explores that problem through:

- a standalone game engine with explicit state transitions;
- a strict information boundary between the engine and the bot;
- Bayesian range updates based on visible cards and observed play;
- Monte Carlo sampling of hidden states consistent with the bot's knowledge;
- reproducible benchmarks for strength and decision latency; and
- an in-game inspector that makes the bot's estimates and action scores visible.

## Current scope

- Complete classic two-player game in the browser
- All eight card effects, round scoring, and the seven-token win condition
- Responsive interface with turn and card-resolution animations
- Range-aware bot with optional Monte Carlo rollouts
- Human-tendency and neutral opponent models
- Automated engine, bot, and UI tests
- GitHub Pages deployment on pushes to `main` or `master`

The engine can initialise classic two-, three-, and four-player rulesets. The
current browser experience is intentionally limited to a human playing against
one bot.

## How the bot works

The bot never receives the real hidden game state. It receives a `PlayerView`
containing its own cards, public events, visible discards, and any cards it has
legitimately learned through play.

From that view it:

1. removes known cards from the deck and builds an opponent range;
2. updates that range using the opponent's public choices;
3. evaluates card-specific outcomes such as Guard hit rate or Baron equity;
4. samples complete hidden states that match everything it can see;
5. rolls candidate actions forward to the end of the round; and
6. mixes between close actions instead of always making a deterministic choice.

Select **Bot brain** during a game to inspect the latest range, behavioral
evidence, action values, mixed-strategy probabilities, sample count, and
decision time.

The strategy is GTO-inspired, not a solved equilibrium. The human-tendency
model is deliberately exploitative, while a true GTO claim would require a
self-play solver and a measured exploitability bound.

## Languages

| Language | Where it is used | Why it is used |
| --- | --- | --- |
| TypeScript | Game engine, bot, benchmark harness, and tests | Discriminated unions make cards, actions, phases, and public/private events explicit. Strict checking catches invalid state handling early. |
| TSX | React components and UI tests | Keeps rendering logic and its types together while supporting accessible component testing. |
| CSS | Table layout, card styling, responsive behavior, and animations | The visual layer stays independent of the engine and does not require a component styling dependency. |
| HTML | Minimal browser entry point | Vite only needs a small document shell; the application is rendered by React. |

There is no backend, database, or external API. The game runs entirely in the
browser; Node.js is used for development, testing, builds, and benchmarks.

## Main tools

| Tool | Role |
| --- | --- |
| React 18 | Browser interface and local UI state |
| Vite | Development server and production bundling |
| Vitest | Unit and integration test runner |
| Testing Library + jsdom | Interaction-focused React tests without a real browser |
| GitHub Actions + Pages | Production build and static hosting |

## Project structure

```text
src/
  engine/     Rules, state transitions, views, and seeded setup
  bots/       Range inference, opponent models, and action selection
  app/        React interface, animations, and Bot brain inspector
  shared/     Shared test setup
scripts/
  benchmarkBot.ts
docs/
  architecture.md
  bot-strategy.md
  testing.md
```

The main design rule is that dependencies point inward: the UI and bots use the
engine, while the engine knows nothing about React or any particular strategy.

## Run locally

Node.js 18 or later is required.

```bash
npm ci
npm run dev
```

Vite prints the local URL when the development server starts.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm test` | Run the complete test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run build` | Type-check and create the production bundle |
| `npm run preview` | Serve the production bundle locally |
| `npm run benchmark:bot` | Run the seeded bot tournament harness |

## Documentation

- [Architecture](docs/architecture.md) explains the engine boundaries, state
  flow, information model, and source layout.
- [Bot strategy](docs/bot-strategy.md) covers range construction, Bayesian
  updates, sampling, rollouts, mixed play, and current limitations.
- [Testing and benchmarks](docs/testing.md) describes the test coverage,
  benchmark opponents, configuration, metrics, and CI/CD workflow.
