# Love Letter

Standalone Love Letter web app with three explicit layers:

- `src/engine`: pure game rules and state transitions
- `src/bots`: strategy implementations that only operate on player views
- `src/app`: React UI shell

## First principles

- The engine is deterministic and UI-agnostic.
- Bots should never receive full hidden state.
- The UI submits player intents and renders engine events.

## Bot strategy

The default bot combines explicit hidden-information reasoning with Monte Carlo
simulation:

- `src/bots/beliefState.ts` removes every visible card from the classic deck,
  builds a normalized range for each opponent, and collapses that range when a
  Priest reveal or King swap provides exact knowledge.
- Public choices update a persistent retained-card range with a Bayesian action
  model. The default human-tendency profile expects players to use Handmaid
  readily and avoid Baron: passing up Handmaid discounts it from the retained
  range, while passing up Baron increases its probability. A noise floor allows
  surprising human choices, and forced Countess combinations remain strong
  evidence.
- The belief state samples complete hands, deck orders, and the hidden burn card
  that are consistent with the acting player's `PlayerView`.
- `src/bots/randomBot.ts` evaluates every legal action across the same sampled
  worlds and rolls each world to the end of the round. Simulated players also act
  only through their own `PlayerView`, so rollouts cannot inspect cards that the
  player would not know.
- Guard hit rate, Baron win/tie/loss rate, Prince Princess probability, King
  exchange value, and Priest information value are calculated directly from the
  opponent range and used alongside rollout results.

`createBeliefBot` accepts a rollout budget and per-action sample bounds for
strength/performance tuning. Its `getLastAnalysis()` method exposes the ranges
and action values from the most recent decision for diagnostics.

The bot uses a softmax mixed policy for close estimated values, which makes the
strategy less predictable in the same spirit as poker mixing. This is
GTO-inspired rather than a proven Nash equilibrium: the human-tendency profile
is deliberately exploitative. A true GTO claim would require solving the full
imperfect-information game through self-play (for example, CFR) and measuring
exploitability against a best response.

### Inspecting a decision

After the bot has taken its first turn, select **Bot brain** beside Reset. The
inspector shows its estimated range for your hand, the behavioral model and
latest action evidence, uncertainty, the number of sampled worlds, decision
time, every action's hand-vs-range result, its mixed-strategy frequency, and
which action it selected. The percentages are beliefs rather than a reveal of
the actual hidden card.

### Benchmarking

Run the paired-seat tournament harness with:

```bash
npm run benchmark:bot
```

It compares the belief bot against uniform random play and the same range
heuristic with rollouts disabled. Results include round win rate with a 95%
confidence interval, average and p95 decision latency, worlds sampled per
decision, and total rollouts.

The default is 100 rounds and a 1,024-rollout budget. Override the inputs with
`ROUNDS`, `ROLLOUT_BUDGET`, and `SEED`. Set `OPPONENT` to `random`, `range`, or
`human` to run only one baseline. Set `BELIEF_MODEL=balanced` to disable the
human-tendency assumptions for an A/B comparison. For example, in PowerShell:

```powershell
$env:ROUNDS=500
$env:ROLLOUT_BUDGET=2048
$env:SEED=1
npm run benchmark:bot
```

Use several hundred rounds when comparing strategy changes; short runs are
useful for smoke testing but have wide confidence intervals.

## Getting started

```bash
npm install
npm run dev
```

## Current scope

The browser UI is a complete classic two-player game against the belief bot.
The engine and bot data structures support classic two-, three-, and four-player
rulesets, while multiplayer UI work remains future scope.
