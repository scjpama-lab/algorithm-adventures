const base = process.env.BASE ?? 'http://localhost:3000';
const bank = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile('./data/questions.json', 'utf8')));
const key = process.env.ADMIN_KEY ?? 'sorting-admin';

const json = (method, url, body, headers = {}) =>
  fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const start = await json('POST', '/api/runs/start', { name: 'Test Hero', heroClass: 'rogue' });
console.log('start', start.status, 'questions:', start.body.questions.length, 'leaks key:', JSON.stringify(start.body).includes('"correct"'));

const runId = start.body.runId;
for (let index = 0; index < start.body.questions.length; index++) {
  const selected = index % 5 === 4 ? (bank.questions[index].correct + 1) % 4 : bank.questions[index].correct;
  const res = await json('POST', `/api/runs/${runId}/answer`, { index, selected });
  if (res.status !== 200) { console.log('answer failed', index, res.status, res.body); break; }
  if (res.body.entry.isCorrect !== (selected === bank.questions[index].correct)) console.log('GRADING MISMATCH', index);
}

const dup = await json('POST', `/api/runs/${runId}/answer`, { index: 0, selected: 0 });
console.log('duplicate answer rejected:', dup.status === 409);

const badIndex = await json('POST', `/api/runs/${runId}/answer`, { index: 99, selected: 0 });
console.log('bad index rejected:', badIndex.status);

const finish = await json('POST', `/api/runs/${runId}/finish`);
console.log('finish', finish.status, finish.body.record?.score, finish.body.record?.rank, finish.body.record?.timeSeconds + 's');
const refinish = await json('POST', `/api/runs/${finish.body.record ? runId : runId}/finish`);
console.log('re-finish blocked:', refinish.status);

const scores = await json('GET', '/api/scores');
console.log('scores', scores.status, 'rows', scores.body.records.length, 'stats', scores.body.stats);

const noKey = await json('GET', '/api/scores/' + scores.body.records[0].id);
console.log('review without key:', noKey.status);
const withKey = await json('GET', '/api/scores/' + scores.body.records[0].id, null, { 'x-admin-key': key });
console.log('review with key:', withKey.status, 'answers', withKey.body.record?.answers.length);

const csv = await fetch(`${base}/api/export.csv?key=${key}`);
console.log('csv', csv.status, (await csv.text()).split('\r\n')[1]);

const questionKeyLeak = await fetch(`${base}/data/questions.json`);
console.log('answer key served publicly?', questionKeyLeak.status);

const html = await fetch(`${base}/`);
console.log('index', html.status, (await html.text()).includes('/js/main.js'));

const missing = await fetch(`${base}/js/nope.js`);
console.log('missing asset', missing.status);
