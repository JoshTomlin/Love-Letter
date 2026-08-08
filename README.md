# Love Letter

Love Letter is a playable two-player browser game and an experiment in building
an explainable bot for a game with hidden information. The rules are compact,
but a strong player still has to reason about cards they cannot see, what an
opponent's previous choices imply, and how each action performs against a range
of possible hands.

The bot plays under the same information constraints as the human. It maintains
a probability distribution over the opponent's hand, updates that range from
public actions, evaluates legal plays against it, and can roll those actions
forward through sampled deals. The latest range and action scores can be
inspected in the UI through **Bot brain**.

[Play the current build](https://joshtomlin.github.io/Love-Letter/) | [Architecture](docs/architecture.md) | [Bot strategy](docs/bot-strategy.md) | [Testing and benchmarks](docs/testing.md)

## Why this project exists

A game bot is easy to make artificially strong if it can read the full program
state. That is not the problem this project is trying to solve. A Love Letter
bot should only know what a real player would know:

- its own hand;
- public discards and face-up removed cards;
- public actions and outcomes;
- cards it has legitimately learned, such as a Priest reveal; and
- the number of cards left in the deck.

From that view, the bot must estimate the opponent's possible hand and compare
its actions against that estimate. Public choices become evidence. For example,
if players usually play Handmaid readily, playing another card makes Handmaid
less likely to be the card they kept. If players tend to avoid playing Baron, a
retained Baron becomes more plausible.

This makes Love Letter a useful small test case for ideas normally associated
with poker and imperfect-information game solving: hand ranges, Bayesian
updates, hidden-state sampling, mixed strategies, and exploitative opponent
models. The state space is small enough that each step can remain visible and
testable.

## Project goals

- Implement the classic rules in a deterministic, UI-independent engine.
- Enforce a clear boundary between the full game state and the information
  available to a bot.
- Compare direct hand-versus-range reasoning with Monte Carlo rollouts.
- Make decisions explainable rather than presenting the strategy as a black
  box.
- Measure strength and decision latency with reproducible seeded benchmarks.
- Keep the complete application static, local-first, and deployable without a
  backend.

## What is implemented

- A complete classic two-player game with all eight card effects, round scoring,
  and the seven-token match target
- Correct 16-card setup, including one face-down burn card and three face-up
  removals in a two-player round
- Countess forced play, Handmaid protection, elimination, deck-exhaustion
  comparison, and discard-value tie breaking
- Responsive table UI with card-resolution sequences, discard histories, and
  accessible controls
- Persistent opponent ranges and exact knowledge from Priest and King
- Balanced and human-tendency models for interpreting observed play
- Inventory-safe hidden-state sampling and optional Monte Carlo rollouts
- Mixed action selection when estimated values are close
- An in-game inspector for ranges, evidence, action scores, strategy
  probabilities, sample counts, and decision time
- Automated engine, bot, and UI tests; a seeded tournament harness; and GitHub
  Pages deployment

## Game model

The classic deck has 16 cards: five Guards, two each of Priest, Baron, Handmaid,
and Prince, and one each of King, Countess, and Princess. Each player normally
holds one card. On a turn, the active player draws a second card, plays one of
the two, and resolves its effect.

At the start of the two-player game represented by the UI, the inventory is:

```text
16 cards = 10 in the draw deck
         + 2 opening hands
         + 1 face-down burn card
         + 3 face-up removed cards
```

A round ends when only one player remains or the draw deck is exhausted. In a
deck-exhaustion showdown, the higher hand wins and discarded-card value breaks
a tie. The round winner receives a token and starts the next round.

The engine can initialise classic two-, three-, and four-player rulesets. The
current browser experience is intentionally one human against one bot.

## How the bot decides

The main strategy is created by
[`createBeliefBot`](src/bots/randomBot.ts). For each turn it follows the same
pipeline:

1. **Build the visible inventory.** Start from the 16-card deck and remove the
   bot's hand, public discards, and face-up removals. Exact private knowledge
   collapses the relevant range to one card.
2. **Update the opponent range.** Carry the previous distribution forward and
   apply the likelihood of the observed card being played while each possible
   card was retained.
3. **Evaluate each action directly.** Guard uses guess hit rate, Baron uses
   win/tie/loss equity, Priest values information, and Prince and King use the
   expected value of the target range. Handmaid and forced Countess plays have
   card-specific rules.
4. **Sample consistent worlds.** Assign hidden hands and the burn card without
   exceeding the remaining card inventory, then shuffle the rest into a
   possible deck order.
5. **Roll actions forward.** Apply each candidate to the same sampled worlds and
   play to the end of the round with the real rules engine. Simulated players
   receive their own redacted view, not direct access to sampled hidden cards.
6. **Combine and mix.** Combine rollout utility with the direct range heuristic,
   convert close values into softmax probabilities, and sample the final play.
7. **Record the explanation.** Store the ranges, evidence, action values,
   probabilities, chosen action, sample count, and elapsed time for the UI.

The default opponent profile expects frequent Handmaid plays and reluctant
Baron plays while mixing in neutral noise so an unusual legal choice never
becomes impossible. A balanced profile treats legal non-Princess cards as
roughly equally likely. King swaps and self-targeted Prince plays reset retained
hand evidence because the old hand no longer exists.

The default rollout budget is 1,024, divided and clamped to 32-128 worlds per
candidate action. A range-only bot uses the same belief and action calculations
with sampling disabled, providing a fast baseline for tests and benchmarks.

## What "GTO-inspired" means

The strategy borrows useful ideas from poker, but it is not a solved
game-theory-optimal policy:

- the human-tendency weights are hand-authored and intentionally exploitative;
- the range stores marginal card probabilities rather than every possible
  hidden history;
- rollout opponents use a heuristic policy; and
- softmax frequencies come from estimated action values, not regret
  minimisation.

A defensible equilibrium claim would require self-play over information sets,
an algorithm such as counterfactual regret minimisation, and a measured
exploitability bound. Those are possible next steps, not claims made by the
current implementation.

## System architecture

```text
React UI or benchmark
         |
         v
      GameState -----> getPlayerView -----> PlayerView --------+
         |                                                   |
         +---------> getLegalActions -----> legal actions ----+---> Belief bot
         |                                                          |
         |                                                range inference
         |                                                + action scoring
         |                                                + sampled rollouts
         |                                                          |
         +<-------------- applyAction <----- PlayerAction <---------+
         |
         +-----> next GameState
```

| Layer | Main paths | Responsibility |
| --- | --- | --- |
| Engine | [`src/engine/`](src/engine/) | Owns cards, full state, seeded setup, legal actions, effects, scoring, events, and player-specific views. |
| Bots | [`src/bots/`](src/bots/) | Maintains beliefs, models observed actions, scores ranges, samples hidden states, runs rollouts, and selects a play. |
| Application | [`src/app/`](src/app/) | Owns the live match in React state, accepts human input, sequences visible effects, invokes the bot, and renders its analysis. |
| Benchmark | [`scripts/benchmarkBot.ts`](scripts/benchmarkBot.ts) | Reuses the engine and strategies outside the browser to run seeded tournament series. |
| Delivery | [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) | Builds the static Vite application and deploys `dist` to GitHub Pages. |

Dependencies point towards the engine. The engine has no React dependency and
does not know which strategy selected an action. The UI and benchmark are two
orchestrators around the same engine and bot APIs.

### State and action flow

`GameState` is the source of truth. A turn draws a card, expands the active hand
into every legal card/target/Guard-guess combination, accepts one `PlayerAction`,
and applies it through a single resolver. `applyAction` validates the selection
again before resolving the effect, updating knowledge, recording events, and
advancing or ending the round.

Legal-action generation is shared by the UI, bots, tests, and engine validation.
Rule logic is not reproduced in React or individual strategies. Engine
functions return new state objects instead of mutating their input, which keeps
single-action behavior deterministic and easy to test.

### Full state versus player view

[`getPlayerView`](src/engine/playerView.ts) is the main information boundary.

| Full `GameState` | Bot-facing `PlayerView` |
| --- | --- |
| Exact opponent hands | Own hand and public hand sizes |
| Ordered draw deck | Number of cards remaining |
| Face-down burn card | Face-up removed cards only |
| Private draws and every Priest result | Public plays, targets, guesses, eliminations, and round results |
| Knowledge held by every player | Cards legitimately learned by this player |

The bot API accepts only a `PlayerView` and a list of legal actions. Draw events
and Priest reveals are filtered from other players' views. Knowledge is cleared
or replaced when King or Prince makes it stale.

## Inspecting the bot

Open the [live app](https://joshtomlin.github.io/Love-Letter/), play until the
bot takes a turn, and select **Bot brain**. It shows:

- the current opponent model and estimated probability of each card;
- range entropy and whether knowledge is inferred or exact;
- how the latest public play fits retained Handmaid and Baron hypotheses;
- every candidate's range, rollout, and combined value;
- the mixed-strategy probability and chosen action; and
- sampled worlds and decision time.

The panel uses the `BotAnalysis` produced during the decision. It is not a
separate explanation reconstructed afterwards.

## Languages and tooling

| Technology | How it is used | Why it is used |
| --- | --- | --- |
| TypeScript | Rules, domain types, beliefs, simulations, benchmarks, and tests | Discriminated unions make cards, phases, actions, and public/private events explicit. |
| React 18 and TSX | Browser game, interaction state, visual sequencing, and analysis UI | Keeps live UI state manageable while preserving typed engine boundaries. |
| CSS and HTML | Card artwork, responsive table, animations, and application shell | Produces a static interface without a component styling dependency. |
| Vite | Development server and production bundle | Provides a small React/TypeScript toolchain and emits a static `dist` directory. |
| Vitest, Testing Library, and jsdom | Engine, bot, and accessible UI tests | Covers pure state transitions and user-visible behavior with the same TypeScript setup. |
| Node.js | Development commands and tournament harness | Runs the real engine and bot outside the browser for repeatable benchmarks. |
| GitHub Actions and Pages | Production build and hosting | Rebuilds and publishes the client-only application from `main` or `master`. |

There is no backend, database, external API, or account system. Gameplay and
analysis run entirely in the browser; Node.js is used only for development,
testing, builds, and benchmarks.

## Repository map

| Path | Purpose |
| --- | --- |
| [`src/engine/`](src/engine/) | Domain types, deck setup, turn flow, legality, effects, scoring, redacted views, and rules tests |
| [`src/bots/`](src/bots/) | Bot interface, opponent models, belief state, sampling, rollouts, and strategy tests |
| [`src/app/`](src/app/) | React game, card presentation, animation sequencing, histories, inspector, and UI tests |
| [`scripts/`](scripts/) | Seeded command-line benchmark harness |
| [`docs/`](docs/) | Detailed design, strategy, testing, benchmark, and deployment notes |
| [`.github/workflows/`](.github/workflows/) | GitHub Pages build and deployment |

## Run locally

Node.js 18 or newer is required.

```bash
git clone https://github.com/JoshTomlin/Love-Letter.git
cd Love-Letter
npm ci
npm run dev
```

No environment variables or external services are needed to play.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm test` | Run the complete test suite once |
| `npm run test:watch` | Run tests while files change |
| `npm run build` | Type-check and create the production bundle |
| `npm run preview` | Serve the production bundle locally |
| `npm run benchmark:bot` | Run seeded bot tournament series |

## Testing and benchmarking

Tests cover the 16-card setup, legal actions, every card effect, private
knowledge changes, elimination and scoring, belief updates, sampled-world card
inventory, legal bot play, complete simulated rounds, UI sequencing, and the Bot
brain output.

```bash
npm test
npm run build
```

`npm run benchmark:bot` compares the belief bot with uniform-random,
range-only, and human-tendency opponents. It alternates seats and reports the
record, win rate, Wilson 95% confidence interval, average and p95 decision time,
sampled worlds, and total rollouts. `ROUNDS`, `ROLLOUT_BUDGET`, `SEED`,
`OPPONENT`, and `BELIEF_MODEL` control reproducible experiments.

The [testing guide](docs/testing.md) documents those controls and records a
10,000-round range-only reference run. It is an engineering baseline, not an
equilibrium or statistical-dominance claim.

## Documentation

This README is the project overview. Continue with:

1. [Architecture](docs/architecture.md) for engine boundaries, state flow,
   events, private knowledge, determinism, and extension points.
2. [Bot strategy](docs/bot-strategy.md) for the range update, opponent profiles,
   action calculations, world sampling, rollouts, mixed play, and limitations.
3. [Testing and benchmarks](docs/testing.md) for test coverage, deterministic
   comparisons, benchmark configuration, reference results, and deployment.

## Current limits

- The UI is two-player; the wider engine model has not been exercised as deeply
  with three or four players.
- Opponent tendencies are fixed profiles rather than learned per player.
- The belief is a marginal card range rather than a full distribution over
  hidden histories.
- Larger rollout budgets cost more time and have not improved strength against
  every benchmark opponent.
- The strategy has no equilibrium or exploitability proof.
- Match state is not persisted outside the current browser session.
- The Pages workflow builds the application but does not yet run the test suite.

The most useful next experiments are learned opponent profiles, a self-play
information-set solver, and paired-deal benchmarks that test both policies from
both seats under identical hidden states.
