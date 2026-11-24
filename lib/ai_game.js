// ============================================================================
// AI HELPER FOR MINI GAMES — Stage 8
// ----------------------------------------------------------------------------
// "Help me build this": the student's one-sentence description goes to the
// Claude API (the teacher's ANTHROPIC_API_KEY, shared with Athena) and comes
// back as a game in the Stage 7 format ONLY (structured output, then cleaned
// by routes/games.js sanitize() and checked by the same engine).
//
// What is sent: the description and fixed instructions. Nothing else — no
// student name, account, story text, period or id.
// The SDK is loaded lazily: if it is missing, the helper reports itself as
// unavailable and the rest of the server runs normally.
// ============================================================================
const MG = require('../public/js/minigame.js');

const MODEL = 'claude-opus-5-5';
let client = null, sdkError = null;
function getClient() {
  if (client || sdkError) return client;
  try {
    const mod = require('@anthropic-ai/sdk');
    const Anthropic = mod.default || mod;
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120000, maxRetries: 1 });
  } catch (e) { sdkError = e.message; console.error('❌ AI helper: @anthropic-ai/sdk not available:', e.message); }
  return client;
}
function status() {
  const keyPresent = !!process.env.ANTHROPIC_API_KEY;
  return { key_present: keyPresent, sdk_ok: keyPresent ? !!getClient() : !sdkError, ready: keyPresent && !!getClient() };
}

const SYSTEM = `You design tiny puzzle games for middle-school students studying Greek mythology. A student describes their game in one sentence; you return the game as data.

THE ROOM: a grid ${MG.COLS} columns (x 0-${MG.COLS - 1}) by ${MG.ROWS} rows (y 0-${MG.ROWS - 1}). The reader (the hero) starts at "start" and moves one square at a time (up, down, left, right). There is no timer.

THINGS (at most 12), each on its own square, never on the start square:
- item: stepping onto it picks it up (the reader carries it; it leaves the room). Event: picks_up.
- obstacle: solid. Bumping into it fires "touches". Use for gates, walls, boulders.
- character: solid. Bumping into it fires "touches" then "talks_to"; if it has a question, the reader is then asked it and answering fires "answers" with answer "correct" or "wrong".
- place: the reader can step onto it, which fires "enters". Use for exits, doors, pits.
- hidden: true means it starts out of sight until an "appear" rule shows it.
Emoji must be one of: ${MG.EMOJI.join(' ')}

RULES (at most 8): WHEN event + thing [AND the reader is (or is NOT) carrying an item] THEN one result.
Results: survive (reader wins), perish (game over), message (show text), open_path (the thing disappears so the reader can pass), appear (a hidden thing appears), vanish (a thing disappears), move (teleport the reader to x,y).

REQUIREMENTS
- There MUST be a way to win: a sequence of moves that reaches a "survive" rule. Walls of obstacles must leave a path or be opened by a rule. Check it.
- The puzzle should need the idea in the student's sentence (for example: carry the right item, answer the right answer, choose the right door).
- Give helpful "message" rules when the reader does the wrong thing (for example, bumping a locked gate without the key).
- Keep every word school-appropriate and short (names up to 40 characters, messages up to 160). No real people's names; mythological names are fine.
- Questions are multiple choice with 2-4 options.

DATA CONVENTIONS (the format has no nulls):
- thing.question: when the thing asks nothing, use prompt "" and options [] and correct_index -1.
- rule.when.answer: "correct" or "wrong" for "answers" events, otherwise "none".
- rule.if_carrying: the item id, or "" for always. rule.if_not: true means "is NOT carrying".
- rule.then.thing: the thing id for open_path/appear/vanish, otherwise "". then.text: message text, otherwise "". then.x/then.y: target square for move, otherwise -1.
- ids: short lowercase letters/digits/underscores, unique.`;

const STR = { type: 'string' }, INT = { type: 'integer' }, BOOL = { type: 'boolean' };
const obj = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const SCHEMA = obj({
  start: obj({ x: INT, y: INT }),
  things: { type: 'array', items: obj({
    id: STR, name: STR, emoji: { type: 'string', enum: MG.EMOJI }, type: { type: 'string', enum: MG.TYPES }, x: INT, y: INT, hidden: BOOL,
    question: obj({ prompt: STR, options: { type: 'array', items: STR }, correct_index: INT })
  }) },
  rules: { type: 'array', items: obj({
    when: obj({ event: { type: 'string', enum: MG.EVENTS }, thing: STR, answer: { type: 'string', enum: ['correct', 'wrong', 'none'] } }),
    if_carrying: STR, if_not: BOOL,
    then: obj({ do: { type: 'string', enum: MG.RESULTS }, thing: STR, text: STR, x: INT, y: INT })
  }) }
});

// Structured output (no nulls) → the Stage 7 shape that sanitize() expects
function toGame(d) {
  return {
    start: d.start,
    things: (d.things || []).map(t => {
      const o = { id: t.id, name: t.name, emoji: t.emoji, type: t.type, x: t.x, y: t.y, hidden: !!t.hidden };
      if (t.type === 'character' && t.question && String(t.question.prompt || '').trim()) o.question = t.question;
      return o;
    }),
    rules: (d.rules || []).map(r => {
      const o = { when: { event: r.when.event, thing: r.when.thing }, then: { do: r.then.do } };
      if (r.when.event === 'answers') o.when.answer = r.when.answer === 'wrong' ? 'wrong' : 'correct';
      if (r.if_carrying) o.if = { carrying: r.if_carrying, not: !!r.if_not };
      if (['open_path', 'appear', 'vanish'].includes(r.then.do)) o.then.thing = r.then.thing;
      if (r.then.do === 'message') o.then.text = r.then.text;
      if (r.then.do === 'move') { o.then.x = r.then.x; o.then.y = r.then.y; }
      return o;
    })
  };
}

class HelperError extends Error {}

async function ask(messages) {
  const c = getClient();
  if (!c) throw new HelperError('The AI helper isn\'t set up on this server.');
  const mod = require('@anthropic-ai/sdk'); const Anthropic = mod.default || mod;
  let res;
  try {
    res = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      // On a safety decline the API retries on a fallback model inside the same call
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HelperError('The AI helper is busy. Try again in a minute.');
    if (e instanceof Anthropic.AuthenticationError) { console.error('AI helper: API key rejected'); throw new HelperError('The AI helper isn\'t working right now. Tell your teacher.'); }
    if (e instanceof Anthropic.APIConnectionError) throw new HelperError('Couldn\'t reach the AI helper. Try again.');
    if (e instanceof Anthropic.APIError) { console.error('AI helper API error', e.status, e.message); throw new HelperError('The AI helper had a problem. Try again.'); }
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new HelperError('The helper couldn\'t make that one. Describe your game a different way.');
  if (res.stop_reason === 'max_tokens') throw new HelperError('The helper ran out of room. Try a simpler sentence.');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new HelperError('The helper\'s answer came back broken. Try again.'); }
  return { res, game: toGame(data) };
}

// One draft. If the engine finds problems, the helper gets one chance to fix them.
// check(game) → { ok, problems } using the server's own rules.
async function draftGame(description, check) {
  const messages = [{ role: 'user', content: `The student's game: ${description}` }];
  let { res, game } = await ask(messages);
  let c = check(game);
  if (!c.ok) {
    messages.push({ role: 'assistant', content: res.content });
    messages.push({ role: 'user', content: `The game checker found these problems:\n- ${c.problems.join('\n- ')}\nFix them and return the whole game again.` });
    ({ game } = await ask(messages));
    c = check(game);
  }
  return { game, check: c };
}

module.exports = { draftGame, status, HelperError, SYSTEM, SCHEMA, toGame };
