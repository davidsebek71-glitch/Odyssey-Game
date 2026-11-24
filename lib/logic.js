// Labyrinth Logic — logic grid puzzle model and solver.
//
// A puzzle has 2 or 3 categories, each with the same number of items (3 or 4):
//   categories: [{ name: 'Hero', items: ['Theseus','Perseus','Jason'] }, ...]
// An answer links every item of category 0 to one item of each other category.
// It is stored as rows: rows[i][c] = index of the item in category c that goes
// with item i of category 0 (rows[i][0] === i).
//
// Clues are structured so the solver can check them (the page shows them as
// sentences):
//   { type: 'is',     a: {c, i}, b: {c, i} }            a goes with b
//   { type: 'is_not', a: {c, i}, b: {c, i} }            a does not go with b
//   { type: 'either', a: {c, i}, b: {c, i}, b2: {c, i} } a goes with b or with b2 (not both)
//   optional text: the teacher's own wording, shown instead of the generated one
//
// With at most 3 categories of 4 items there are at most (4!)^2 = 576 possible
// answers, so the solver simply tries them all: the count is exact.

function permutations(n) {
  const out = [];
  const rec = (arr, used) => {
    if (arr.length === n) { out.push(arr.slice()); return; }
    for (let i = 0; i < n; i++) if (!used[i]) { used[i] = true; arr.push(i); rec(arr, used); arr.pop(); used[i] = false; }
  };
  rec([], []);
  return out;
}

// Problems with the puzzle's shape (null = fine)
function shapeProblem(categories) {
  if (!Array.isArray(categories) || categories.length < 2 || categories.length > 3) return 'A puzzle needs 2 or 3 categories.';
  const n = (categories[0].items || []).length;
  if (n < 3 || n > 4) return 'Each category needs 3 or 4 items.';
  for (const cat of categories) {
    if (!cat.name || !String(cat.name).trim()) return 'Every category needs a name.';
    const items = (cat.items || []).map(x => String(x || '').trim());
    if (items.length !== n) return 'Every category needs the same number of items.';
    if (items.some(x => !x)) return `Fill in every item in "${cat.name}".`;
    if (new Set(items.map(x => x.toLowerCase())).size !== n) return `Two items in "${cat.name}" have the same name.`;
  }
  return null;
}

function refOk(ref, categories) {
  return ref && Number.isInteger(ref.c) && Number.isInteger(ref.i) && ref.c >= 0 && ref.c < categories.length &&
    ref.i >= 0 && ref.i < categories[ref.c].items.length;
}
function clueProblem(clue, categories) {
  if (!clue || !['is', 'is_not', 'either'].includes(clue.type)) return 'Unknown kind of clue.';
  if (!refOk(clue.a, categories) || !refOk(clue.b, categories)) return 'Choose both items for the clue.';
  if (clue.a.c === clue.b.c) return 'A clue must link items from two different categories.';
  if (clue.type === 'either') {
    if (!refOk(clue.b2, categories)) return 'Choose the second "or" item.';
    if (clue.b2.c === clue.a.c) return 'A clue must link items from two different categories.';
    if (clue.b2.c === clue.b.c && clue.b2.i === clue.b.i) return 'The two "or" items must be different.';
  }
  return null;
}

// Which row (category-0 item) an item belongs to under an answer
function rowOf(perms, ref) {
  if (ref.c === 0) return ref.i;
  return perms[ref.c].indexOf(ref.i);
}
function satisfies(perms, clue) {
  const ra = rowOf(perms, clue.a), rb = rowOf(perms, clue.b);
  if (clue.type === 'is') return ra === rb;
  if (clue.type === 'is_not') return ra !== rb;
  const rb2 = rowOf(perms, clue.b2);
  return (ra === rb) !== (ra === rb2);
}

// Count answers that satisfy every clue (stops counting at `limit`)
function solve(categories, clues, limit = 50) {
  const k = categories.length, n = categories[0].items.length;
  const P = permutations(n);
  let count = 0, first = null;
  const combos = k === 2 ? P.map(p => [null, p]) : P.flatMap(p1 => P.map(p2 => [null, p1, p2]));
  for (const perms of combos) {
    if (clues.every(cl => satisfies(perms, cl))) {
      count++;
      if (!first) first = perms;
      if (count >= limit) break;
    }
  }
  const rows = first ? Array.from({ length: n }, (_, i) => [i, ...perms2cols(first, i)]) : null;
  return { count, solution: count === 1 ? rows : null };
}
function perms2cols(perms, i) { return perms.slice(1).map(p => p[i]); }

// Full check used by the builder: shape, each clue, then the solution count
function check(categories, clues) {
  const shape = shapeProblem(categories);
  if (shape) return { ok: false, problem: shape, count: null };
  for (let j = 0; j < (clues || []).length; j++) {
    const p = clueProblem(clues[j], categories);
    if (p) return { ok: false, problem: `Clue ${j + 1}: ${p}`, count: null };
  }
  const { count, solution } = solve(categories, clues || []);
  if (count === 0) return { ok: false, count, problem: 'No answer fits all the clues. Two clues contradict each other.' };
  if (count > 1) return { ok: false, count, problem: `${count >= 50 ? '50 or more' : count} answers fit these clues. Add clues until exactly one does.` };
  return { ok: true, count: 1, solution, problem: null };
}

function clueText(clue, categories) {
  if (clue.text && String(clue.text).trim()) return String(clue.text).trim();
  const name = r => categories[r.c].items[r.i];
  if (clue.type === 'is') return `${name(clue.a)} goes with ${name(clue.b)}.`;
  if (clue.type === 'is_not') return `${name(clue.a)} does not go with ${name(clue.b)}.`;
  return `${name(clue.a)} goes with either ${name(clue.b)} or ${name(clue.b2)}.`;
}

// Is a student's answer right? answer: rows in the same form as the solution
function isCorrect(solution, answer) {
  if (!Array.isArray(answer) || !Array.isArray(solution) || answer.length !== solution.length) return false;
  return solution.every((row, i) => Array.isArray(answer[i]) && row.every((v, c) => answer[i][c] === v));
}

module.exports = { check, solve, clueText, isCorrect, shapeProblem, clueProblem };
