# Love Letter

Standalone Love Letter web app with three explicit layers:

- `src/engine`: pure game rules and state transitions
- `src/bots`: strategy implementations that only operate on player views
- `src/app`: React UI shell

## First principles

- The engine is deterministic and UI-agnostic.
- Bots should never receive full hidden state.
- The UI submits player intents and renders engine events.

## Getting started

```bash
npm install
npm run dev
```

## Near-term implementation order

1. Finish legal action generation for all classic cards.
2. Implement card resolution in `applyAction.ts`.
3. Add round-end scoring and 2-player setup specifics.
4. Add a random bot to exercise the engine.
5. Build the first playable human-vs-bot screen.
