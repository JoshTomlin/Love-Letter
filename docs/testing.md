# Testing and benchmarks

[Back to the project overview](../README.md)

The project uses deterministic seeds and small, focused tests to verify rules,
information boundaries, bot decisions, and browser interactions.

## Test coverage

| Area | Files | What is checked |
| --- | --- | --- |
| Engine setup | [`setupRound.test.ts`](../src/engine/tests/setupRound.test.ts) | Classic two-player deal, burn cards, and deck size |
| Legal actions | [`legalActions.test.ts`](../src/engine/tests/legalActions.test.ts) | Countess restrictions, Guard guesses, protected targets, and terminal states |
| Card resolution | [`applyAction.test.ts`](../src/engine/tests/applyAction.test.ts) | All card effects, knowledge changes, elimination, round scoring, and match victory |
| Belief state | [`beliefState.test.ts`](../src/bots/beliefState.test.ts) | Exact knowledge, Bayesian action evidence, range persistence, and card-inventory-safe samples |
| Bot integration | [`beliefState.test.ts`](../src/bots/beliefState.test.ts), [`App.test.tsx`](../src/app/App.test.tsx) | Legal decisions, complete simulated rounds, known-card tactics, and mixed probabilities |
| UI | [`App.test.tsx`](../src/app/App.test.tsx) | Table rendering, Strict Mode timing, and the Bot brain inspector |

Vitest runs the suite in jsdom. The engine tests remain DOM-independent, while
Testing Library queries the rendered React interface through labels, roles, and
visible text rather than component internals.

## Commands

```bash
npm test
npm run build
```

`npm test` runs the suite once. `npm run test:watch` is available during active
development. `npm run build` runs the TypeScript project build before Vite
creates `dist`, so it also catches type and module errors not reached by a test.

## Why seeds matter

The deck shuffle, bot decisions, hidden-state samples, and benchmark opponents
all use seeded pseudo-random generators. A failing scenario can therefore be
reproduced with the same seed instead of depending on `Math.random`.

Tests use small fixed seed sets for predictable coverage. The benchmark uses a
base seed and increments it once per round, while alternating which seat belongs
to the belief bot.

## Bot benchmark

Run the tournament harness with:

```bash
npm run benchmark:bot
```

The harness plays complete rounds and reports:

- wins, losses, and win rate;
- a Wilson 95% confidence interval for the win rate;
- average and 95th-percentile decision time;
- average sampled worlds per decision; and
- total rollout count.

### Opponents

| `OPPONENT` | Behavior |
| --- | --- |
| `random` | Selects uniformly from the complete legal-action list |
| `range` | Uses the same range heuristic with rollouts disabled |
| `human` | Selects card types according to the human-tendency play weights |
| unset | Runs all three opponents |

The human-tendency opponent chooses a card type by weight, then chooses between
that card's legal targets or guesses. This avoids accidentally making Guard more
likely only because it expands into several possible guesses.

### Configuration

| Variable | Default | Meaning |
| --- | ---: | --- |
| `ROUNDS` | `100` | Number of rounds in each opponent series |
| `ROLLOUT_BUDGET` | `1024` | Root sampling budget before per-action limits |
| `SEED` | `1` | First deal seed |
| `OPPONENT` | all | Optional opponent filter |
| `BELIEF_MODEL` | `human-tendencies` | Set to `balanced` for a neutral range model |

PowerShell example:

```powershell
$env:ROUNDS=500
$env:ROLLOUT_BUDGET=0
$env:SEED=1
$env:OPPONENT="human"
$env:BELIEF_MODEL="balanced"
npm run benchmark:bot
```

POSIX shell example:

```bash
ROUNDS=500 ROLLOUT_BUDGET=0 SEED=1 OPPONENT=human \
  BELIEF_MODEL=balanced npm run benchmark:bot
```

## Reference result

One 10,000-round, range-only comparison against the tendency-driven opponent
used `SEED=10001` and `ROLLOUT_BUDGET=0`:

| Belief model | Record | Win rate |
| --- | ---: | ---: |
| Human tendencies | 7,030-2,970 | 70.3% |
| Balanced | 6,954-3,046 | 69.5% |

The modeled tendencies produced a modest improvement in that run. This is an
engineering benchmark, not proof of statistical dominance or equilibrium play.
Confidence intervals, seed ranges, opponent policy, and machine-dependent
latency should all be reported when comparing later changes.

## CI and deployment

[`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) runs on pushes to
`main`. It uses Node.js 22, installs the locked dependency set with
`npm ci`, builds the production bundle, and deploys `dist` to GitHub Pages.

The current workflow validates the production build but does not run
`npm test`. Tests should be run locally before pushing; adding a separate test
job is a sensible next CI improvement.

## Suggested validation before a change is merged

```bash
npm test
npm run build
```

For bot changes, also run a seeded benchmark against at least the `range` and
`human` opponents. Use the same round count and base seed on both sides of an
A/B comparison.
