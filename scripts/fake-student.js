import WebSocket from 'ws';

const base = (process.env.BASE ?? 'http://192.168.5.157:3000').replace(/\/$/, '');
const name = process.env.NAME ?? 'Bot Student';

const socket = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
const events = [];
socket.on('message', (raw) => {
  const message = JSON.parse(String(raw));
  events.push(message.type);
  if (message.type === 'run:finished') {
    console.log('saw run:finished ->', message.record.name, message.record.score + '/' + message.record.total);
  }
});

const post = (url, body) =>
  fetch(base + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

await new Promise((resolve, reject) => {
  socket.on('open', resolve);
  socket.on('error', reject);
});
socket.send(JSON.stringify({ type: 'identify', role: 'player', name }));

const run = await post('/api/runs/start', { name, heroClass: 'sorcerer' });
console.log('started run on', base, 'questions:', run.questions.length);

for (let index = 0; index < run.questions.length; index++) {
  const offset = index % 4 === 0 ? 1 : 0;
  await post(`/api/runs/${run.runId}/answer`, { index, selected: offset });
  await new Promise((resolve) => setTimeout(resolve, 120));
}

const { record } = await post(`/api/runs/${run.runId}/finish`);
console.log('finished:', record.score, '/', record.total, record.rank);
await new Promise((resolve) => setTimeout(resolve, 600));
console.log('event types seen:', [...new Set(events)].join(', '));
socket.close();
