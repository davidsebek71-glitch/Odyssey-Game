// TEST ONLY: a stand-in for the Claude Messages API (Stage 8 tests). Records every
// request to MOCK_LOG and returns canned mini games. Keywords in the student's
// sentence pick the reply: broken (unwinnable first, fixed on retry), stubborn
// (always unwinnable), refuse (stop_reason refusal), fail500 (server error).
const http = require('http'); const fs = require('fs');
const LOG = require('./env').MOCK_LOG; fs.writeFileSync(LOG, '[]');
const good = { start: { x: 1, y: 4 }, things: [
  { id: 'fleece', name: 'Golden Fleece', emoji: '⭐', type: 'item', x: 3, y: 1, hidden: false, question: { prompt: '', options: [], correct_index: -1 } },
  { id: 'king', name: 'King Aeetes', emoji: '🤴', type: 'character', x: 6, y: 4, hidden: false, question: { prompt: 'What did Jason sail on?', options: ['The Argo', 'A raft'], correct_index: 0 } },
  { id: 'exit', name: 'Harbor', emoji: '⚓', type: 'place', x: 10, y: 4, hidden: true, question: { prompt: '', options: [], correct_index: -1 } }],
  rules: [
  { when: { event: 'talks_to', thing: 'king', answer: 'none' }, if_carrying: 'fleece', if_not: true, then: { do: 'message', thing: '', text: 'Bring me the fleece first.', x: -1, y: -1 } },
  { when: { event: 'answers', thing: 'king', answer: 'correct' }, if_carrying: 'fleece', if_not: false, then: { do: 'appear', thing: 'exit', text: '', x: -1, y: -1 } },
  { when: { event: 'answers', thing: 'king', answer: 'wrong' }, if_carrying: '', if_not: false, then: { do: 'perish', thing: '', text: '', x: -1, y: -1 } },
  { when: { event: 'enters', thing: 'exit', answer: 'none' }, if_carrying: '', if_not: false, then: { do: 'survive', thing: '', text: '', x: -1, y: -1 } }] };
const broken = JSON.parse(JSON.stringify(good)); broken.rules = broken.rules.filter(r => r.then.do !== 'survive');
http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const body = JSON.parse(b || '{}'); const log = JSON.parse(fs.readFileSync(LOG)); log.push({ url: req.url, headers: { beta: req.headers['anthropic-beta'], key: req.headers['x-api-key'] ? 'set' : 'none' }, body }); fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
    const first = body.messages[0].content; const n = body.messages.length;
    let stop = 'end_turn', game = good;
    if (/refuse/.test(first)) stop = 'refusal';
    if (/broken/.test(first) && n === 1) game = broken;
    if (/stubborn/.test(first)) game = broken;
    if (/fail500/.test(first)) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } })); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, stop_reason: stop, stop_details: null,
      content: stop === 'refusal' ? [] : [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(game) }],
      usage: { input_tokens: 10, output_tokens: 10 } }));
  });
}).listen(parseInt(process.env.MOCK_PORT || '4300'), () => console.log('mock on 4300'));
