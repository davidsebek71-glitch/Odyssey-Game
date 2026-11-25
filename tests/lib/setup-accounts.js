// Creates the test accounts on a FRESH database through the normal API:
//   Test Teacher (teacher@test.local)
//   Test Period: Students A–I     Period 1st: Student X (no alliance)
//   Alliances (Test): 1 Test Argonauts = A,B   2 Test Spartans = C,D
//                     3 Test Minoans = E,F,I   4 Test Myrmidons = G,H
// Every password is pw-test-1. Run by tests/run.sh.
const { API, PASSWORD } = require('./env');
const post = async (p, body, t) => { const r = await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const get = async (p, t) => (await fetch(API + p, { headers: { Authorization: 'Bearer ' + t } })).json();
const fail = m => { console.error('setup failed: ' + m); process.exit(1); };

(async () => {
  const t = await post('/auth/teacher/register', { name: 'Test Teacher', email: 'teacher@test.local', password: PASSWORD });
  if (!t.token) fail('teacher: ' + JSON.stringify(t));
  const tok = {}, id = {};
  for (const l of 'ABCDEFGHIX') {
    const r = await post('/auth/student/register', { name: 'Student ' + l, email: `stu${l}@test.local`, password: PASSWORD, class_period: l === 'X' ? '1st' : 'Test' });
    if (r.status !== 200) fail(`student ${l}: ${JSON.stringify(r)}`);
    const li = await post('/auth/student/login', { email: `stu${l}@test.local`, password: PASSWORD });
    tok[l] = li.token; id[l] = (li.student || li.user || {}).student_id || (li.student || li.user || {}).id;
  }
  for (const [name, members] of [['Test Argonauts', 'AB'], ['Test Spartans', 'CD'], ['Test Minoans', 'EFI'], ['Test Myrmidons', 'GH']]) {
    const lead = members[0];
    const c = await post('/alliance/create', { alliance_name: name }, tok[lead]);
    if (!c.alliance && !c.success) fail(`alliance ${name}: ${JSON.stringify(c)}`);
    for (const m of members.slice(1)) {
      await post('/alliance/invite', { invited_student_id: id[m] }, tok[lead]);
      const inv = (await get('/student/invitations', tok[m]))[0];
      const acc = await post('/alliance/respond-invitation', { invitation_id: inv.invitation_id, accept: true }, tok[m]);
      if (!acc.success) fail(`${m} joining ${name}: ${JSON.stringify(acc)}`);
    }
  }
  console.log('test accounts created');
})().catch(e => fail(e.stack));
