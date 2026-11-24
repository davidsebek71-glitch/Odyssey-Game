# Tests

Scripts that check the islands build (Stages 1–8) and Revenge of the Gods end to end.
They never touch the real database: `run.sh` copies the app into a temporary
folder, starts it on a fresh database with test accounts, runs the tests, and
deletes the folder.

## Running

From the repository root:

```bash
tests/run.sh
```

The other modes:

- `tests/run.sh` runs the **API tests**, about 2 minutes.
- `tests/run.sh ui` runs the **browser tests**. They need Playwright with Chromium (`npm install --no-save playwright` and `npx playwright install chromium`).
- `tests/run.sh all` runs both.
- `tests/run.sh tests/api/stage7_api.js` runs just the files you name.

Each file prints ✓ or ✗ for every check. The run ends with `All N test files
passed.` or names the files that failed. Set `KEEP=1` to keep the temporary
folder afterwards, with the server log, screenshots and the output of each failed file.

**Ports:** the app uses `TEST_PORT` (default 4200) and the Claude API stand-in uses `MOCK_PORT` (default 4300).

## What the tests use

| | |
|---|---|
| Teacher | `teacher@test.local` |
| Test Period students | `stuA@test.local` … `stuI@test.local` |
| Other period | `stuX@test.local` (period 1st, no alliance) |
| Password (all) | `pw-test-1` |
| Alliances | Test Argonauts (A, B; owns Armory + Dock), Test Spartans (C, D), Test Minoans (E, F, I; owns Transport Ship), Test Myrmidons (G, H) |

These accounts exist only in the temporary database. Most tests start by
calling the Test Period reset, so they can run in any order and more than once.

## Files

| File | Checks |
|---|---|
| `api/island_api.js`, `ui/island_ui.js` | Stage 1: quests unlock with the myth quiz, story pins, submit checks, teacher approval, photos |
| `api/voyage_api.js`, `ui/voyage_ui.js` | Stage 2: build/voyage phases, voyage tokens, visits, responses approved by the teacher |
| `api/stage3_api.js`, `ui/stage3_ui.js` | Stage 3: Oracle Trials, Labyrinth Logic, accommodations, reading dashboard |
| `api/stage4a_api.js`, `ui/stage4a_ui.js` | Stage 4A: god powers, monsters waking and blocking, battles (dice are rigged through `lib/rng-preload.js`) |
| `api/stage4b_api.js`, `ui/stage4b_ui.js` | Stage 4B: student-made Guardian, Lair and Monster encounters |
| `ui/stage5_ui.js` | Stage 5: terrain from the map's color key |
| `ui/stage6_ui.js` | Stage 6: walking the island |
| `api/stage7_api.js`, `ui/stage7_ui.js` | Stage 7: mini game builder, checks, approval, teammate play-test |
| `api/stage8_api.js`, `ui/stage8_ui.js` | Stage 8: AI helper, against `lib/mock-claude.js`, a stand-in for the Claude API that records each request (no real API calls, no key needed) |
| `api/rotg_paths_api.js` | Revenge of the Gods: two alliances choosing the same path |
| `ui/rotg_ui.js`, `ui/rotg_notimer_ui.js` | Revenge of the Gods: two students play through the page; trivia has no timer |

`lib/` holds the shared settings (`env.js`), the account and building setup,
the rigged-dice preload and the Claude API stand-in. Every file in it is test-only.
