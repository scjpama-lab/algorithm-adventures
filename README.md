# Algorithm Quest: The Sorting Saga

A server-scored classroom RPG quiz (15 sorting-algorithm questions) that runs on your own
machine for LAN play or behind any host for online play. Students share one live scoreboard,
and the teacher dashboard streams results in real time.

## Run it (LAN play)

```bash
npm install
npm start
```

The startup banner prints the address students on the same network should open, e.g.
`http://192.168.5.157:3000`. Everything (fonts, styles, sounds) is served locally, so a lab
with no internet still works.

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address — `0.0.0.0` is what makes LAN work |
| `ADMIN_KEY` | `sorting-admin` | Key for the teacher dashboard, reviews, CSV and clearing scores |
| `DATA_DIR` | `./data` | Where `records.json` is written |
| `MAX_RECORDS` | `5000` | Oldest records are trimmed past this |

Set a real key before publishing: `ADMIN_KEY=choose-one npm start`.

## Publish it online

The app is a single stateless-ish Node process plus one JSON file, so any Node or Docker host
works.

```bash
docker build -t algorithm-quest .
docker run -p 8080:8080 -e ADMIN_KEY=choose-one -v aq-data:/data algorithm-quest
```

On Render / Fly.io / Railway / a VPS: build `npm ci --omit=dev`, start `node server.js`, and let
the platform's `PORT` win (the server already reads it). Use a persistent disk mounted at
`DATA_DIR`, otherwise scores disappear on redeploy. Put TLS in front (the platform's own
hostname) — the WebSocket endpoint at `/ws` follows the page protocol automatically.

## Teacher dashboard

Click **ADMIN**, enter the admin key. It shows connected players, a live feed of finished runs
pushed over WebSocket, the full server-side leaderboard, per-student answer review, CSV export
and a clear-all button.

## How a run is scored

The browser never receives the answer key. `POST /api/runs/start` returns the questions,
`POST /api/runs/:id/answer` is graded on the server, and `POST /api/runs/:id/finish` writes the
record. Edit `data/questions.json` to change the quiz — questions, options, answer key, monsters
and hero classes all live there.

## Dev helpers

```bash
npm run dev                 # auto-restart on edits
node scripts/smoke.js       # exercises the API: grading, auth, CSV, key leakage
node scripts/fake-student.js # plays a full run as a second LAN client
```

## Layout

```
server.js            HTTP + API wiring, LAN banner
lib/quiz.js          question bank, run registry, server-side grading
lib/store.js         JSON persistence, leaderboard queries, CSV
lib/realtime.js      WebSocket presence + live result feed
public/              self-contained client (no CDN, no build step)
data/questions.json  quiz content + answer key (never served to browsers)
```
