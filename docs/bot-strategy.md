# Bot strategy

[Back to the project overview](../README.md)

The bot's central problem is not card resolution; the engine already handles
that. Its problem is choosing an action when the opponent's hand, deck order,
and burn card are unknown.

The implementation combines a persistent opponent range with direct
hand-versus-range calculations and optional Monte Carlo rollouts.

## Decision pipeline

For each turn, [`createBeliefBot`](../src/bots/randomBot.ts) follows the same
sequence:

1. Update the opponent range from the latest `PlayerView`.
2. Remove duplicate legal actions and avoid discarding Princess when another
   card is legal.
3. Evaluate each action directly against the range.
4. Sample hidden game states consistent with the view.
5. Apply each candidate action to the same set of sampled worlds and play those
   worlds to the end of the round.
6. Combine the range heuristic and average rollout result.
7. Convert close scores into a mixed strategy and sample the final action.
8. Store the ranges, scores, probabilities, sample count, and timing for the
   **Bot brain** inspector.

The state held between turns is limited to the previous view, previous ranges,
and the bot's last action. It resets naturally when the round number changes.

## Building an opponent range

The base range starts with the 16-card classic deck. It removes the bot's hand,
visible burned cards, and public discards. Remaining copies provide the prior
weight for each possible opponent card.

Exact knowledge takes precedence. A Priest reveal or a valid known card after a
King swap collapses the range to one card with probability 1.

Otherwise, the weights are normalised into a probability distribution. The bot
also reports Shannon entropy for the distribution; higher entropy means greater
uncertainty.

## Learning from an observed play

A public choice is evidence about the card that was kept. At a high level, the
update is:

```text
posterior weight(card) = prior transition weight(card)
                       × P(observed play | retained card)
```

The transition weight accounts for two paths: the opponent may have retained
their previous card and played the draw, or played their previous card and kept
the draw. A small inventory prior is mixed back in so an unusual but legal human
choice does not permanently remove the true card from consideration.

### Opponent profiles

[`src/bots/opponentModel.ts`](../src/bots/opponentModel.ts) defines two profiles:

| Profile | Intended use |
| --- | --- |
| Human tendencies | Exploitative model. It expects Handmaid to be played readily and Baron to be held back. |
| Balanced | Neutral comparison model. Legal non-Princess cards have equal play weight. |

The human profile uses relative play weights rather than fixed action
probabilities:

| Card | Weight |
| --- | ---: |
| Guard | 1.00 |
| Priest | 0.90 |
| Baron | 0.24 |
| Handmaid | 2.60 |
| Prince | 0.82 |
| King | 0.55 |
| Countess | 0.42 |
| Princess | 0.01 |

For a possible two-card hand, the observed card's weight is divided by the sum
of both play weights. The result is mixed with 12% neutral noise. This captures
useful tendencies without assuming that every opponent behaves exactly as the
profile predicts.

For example, if an opponent plays Guard, retaining Handmaid is discounted
because the model expected Handmaid to be played. Retaining Baron becomes more
plausible because the model expects players to avoid exposing it.

Countess is handled separately. A Countess played alongside King or Prince is
treated as near-certain forced-play evidence, while an illegal King or Prince
play from that pair receives zero likelihood.

King swaps and Prince effects can replace a hand entirely. Those events clear
retained-card evidence rather than carrying an obsolete range forward.

## Hand-versus-range evaluation

Before simulation, each legal action gets card-specific measurements:

| Action | Range calculation |
| --- | --- |
| Guard | Probability that the guessed card matches the target range |
| Priest | Information value based on target-range entropy |
| Baron | Probability of winning, tying, or losing with the retained card |
| Handmaid | Protection value, with a bonus late in the deck |
| Prince | Target hand value and probability of forcing a Princess discard |
| King | Expected value of the exchanged hand relative to the retained card |
| Countess | Modest value unless forced by the rules |
| Princess | Effectively excluded whenever another legal play exists |

These measurements are useful even with rollouts disabled. `createRangeBot`
uses the same range logic with a zero rollout budget and is both a fast strategy
and a benchmark baseline.

## Sampling hidden worlds

[`sampleConsistentStates`](../src/bots/beliefState.ts) creates complete
hypothetical `GameState` objects from a `PlayerView`:

1. Preserve the acting player's real hand.
2. Assign exact known cards first.
3. Draw unknown opponent cards from their weighted ranges without exceeding the
   remaining card inventory.
4. Assign the hidden burn card when the ruleset requires one.
5. Shuffle the remaining cards into a possible deck order.

Every sample contains exactly the cards still possible under the visible deck
composition. Tests reconstruct the full classic deck from each sampled world to
check that no card is duplicated or lost.

## Rollouts

Each candidate action is applied to every sampled world. The simulation then
continues until the round ends or reaches an 80-step safety limit.

Rollout players use the same range-aware heuristic with 12% policy noise. Each
actor only receives its own `PlayerView`, including actors inside a hypothetical
state. This prevents a rollout policy from choosing actions with knowledge of
the sampled hands.

The default rollout budget is 1,024. It is divided across the candidate actions
and clamped to 32-128 worlds per action. The final score is:

```text
total score = average rollout utility × 100
            + range heuristic × 0.12
```

Round wins and losses have utility `+1` and `-1`. The code also supports a
larger game-over utility when a rollout reaches the match result.

## Mixed action selection

The bot does not always select the highest score directly. It applies a softmax
to the action scores using a default temperature of `0.35`:

```text
action weight = exp((action score - best score) / temperature)
```

The weights are normalised and sampled. Clearly worse actions receive
negligible probability, while close choices are mixed. Setting the temperature
to zero produces a pure best-score policy with random selection only between
exact ties.

## What “GTO-inspired” means here

The range calculations and mixed actions borrow useful ideas from poker, but
this is not a solved game-theory-optimal strategy.

- The human-tendency weights are hand-authored and intentionally exploitable.
- The range tracks marginal card probabilities rather than a complete joint
  belief over every hidden history.
- Rollout opponents use a heuristic policy, not an equilibrium strategy.
- The softmax frequencies come from estimated action values, not regret
  minimisation.

A stronger equilibrium-oriented version would use self-play such as
counterfactual regret minimisation, store policies by information set, and then
measure exploitability against an approximate best response.

## Current limitations

- The opponent profiles are fixed rather than learned from a particular player
  across matches.
- More rollouts increase latency and have not yet shown a reliable strength gain
  over the range heuristic in every benchmark.
- Multi-player data structures are supported, but the strategy has primarily
  been exercised in two-player games.
- Hand-authored heuristic scales make tuning and score interpretation less
  principled than a trained value function.

These limitations are explicit so benchmark changes can be evaluated against a
clear baseline rather than presented as solved AI.
