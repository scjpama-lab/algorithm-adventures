import { api, getAdminKey, setAdminKey } from './net.js';
import { clear, el, formatSeconds, formatTime, $, toast } from './dom.js';

export function createAdmin({ live }) {
  const state = { unlocked: false, presence: { clients: [], runs: [] }, feed: [] };

  function bind() {
    $('admin-btn').addEventListener('click', open);
    $('victory-board-btn').addEventListener('click', open);
    $('admin-close').addEventListener('click', close);
    $('admin-unlock').addEventListener('click', unlock);
    $('admin-refresh').addEventListener('click', loadScores);
    $('admin-clear').addEventListener('click', clearAll);
    $('admin-search').addEventListener('input', debounce(loadScores, 300));
    $('admin-modal').addEventListener('click', (event) => {
      if (event.target === $('admin-modal')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    live.onPresence((presence) => {
      state.presence = presence;
      renderPresence();
    });
    live.onRunFinished((record) => {
      state.feed.unshift(record);
      state.feed = state.feed.slice(0, 12);
      renderFeed();
      loadScores();
    });
  }

  function open() {
    $('admin-modal').hidden = false;
    live.identify('admin', '');
    const key = getAdminKey();
    if (key) {
      probe(key).then((ok) => {
        if (ok) showBody();
        else $('admin-lock').hidden = false;
      });
    }
    if (!state.unlocked) $('admin-lock').hidden = false;
  }

  function close() {
    $('admin-modal').hidden = true;
    $('admin-review').hidden = true;
    live.identify('player', '');
  }

  async function probe(key) {
    setAdminKey(key);
    try {
      await api.verifyAdminKey();
      return true;
    } catch (error) {
      if (/admin key/i.test(error.message)) {
        setAdminKey('');
        return false;
      }
      return false;
    }
  }

  function showBody() {
    state.unlocked = true;
    $('admin-lock').hidden = true;
    $('admin-lock-error').hidden = true;
    $('admin-body').hidden = false;
    $('admin-csv').setAttribute('href', api.csvUrl());
    loadScores();
    renderFeed();
  }

  async function unlock() {
    const key = $('admin-key-input').value.trim();
    if (!key) return;
    const ok = await probe(key);
    if (!ok) {
      $('admin-lock-error').hidden = false;
      return;
    }
    $('admin-key-input').value = '';
    showBody();
  }

  async function loadScores() {
    if (!state.unlocked) return;
    try {
      const { records, total, stats } = await api.scores({
        limit: 200,
        q: $('admin-search').value.trim(),
      });
      $('record-count').textContent = total;
      $('admin-stats').textContent = `AVG ACC ${stats.avgAccuracy}% · PERFECT ${stats.perfectRuns}`;
      renderTable(records);
    } catch (error) {
      toast(error.message, 'bad');
    }
  }

  function renderTable(records) {
    const body = clear($('admin-table-body'));
    if (!records.length) {
      const row = el('tr');
      const cell = el('td', 'muted', 'No student records stored yet.');
      cell.colSpan = 7;
      cell.style.padding = '22px';
      cell.style.textAlign = 'center';
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    records.forEach((record, index) => {
      const row = el('tr');
      row.append(
        el('td', 'num', String(index + 1)),
        el('td', 'amber', record.name),
        el('td', undefined, record.heroClass),
        el('td', 'green', `${record.score} / ${record.total}`),
        el('td', 'amber', `${record.accuracy}%`),
        el('td', 'blue', formatSeconds(record.timeSeconds)),
        el('td', 'muted', formatTime(record.finishedAt))
      );
      row.addEventListener('click', () => loadReview(record.id));
      body.appendChild(row);
    });
  }

  async function loadReview(id) {
    const host = clear($('admin-review'));
    host.hidden = false;
    host.appendChild(el('h3', 'review-head', 'ANSWER REVIEW'));
    try {
      const { record } = await api.record(id);
      host.appendChild(
        el(
          'h3',
          'review-head',
          `${record.name} · ${record.heroClass} · ${record.score}/${record.total} · ${record.rank}`
        )
      );
      record.answers.forEach((answer, index) => {
        const item = el('div', `review-item ${answer.isCorrect ? 'ok' : 'bad'}`);
        item.append(el('div', 'q', `Q${index + 1}: ${answer.question}`));
        item.append(
          el('div', answer.isCorrect ? 'ans-ok' : 'ans-bad', `Chose: ${answer.selectedText}`)
        );
        if (!answer.isCorrect) {
          item.append(el('div', 'ans-ok', `Correct: ${answer.correctText}`));
        }
        item.append(el('div', 'why', answer.explanation));
        host.appendChild(item);
      });
    } catch (error) {
      host.appendChild(el('div', 'review-item bad', error.message));
    }
  }

  function renderPresence() {
    const host = clear($('admin-online'));
    const players = state.presence.clients.filter((client) => client.role === 'player');
    if (!players.length) {
      host.appendChild(el('li', 'muted', 'No players connected'));
      return;
    }
    players.forEach((player) => {
      const active = state.presence.runs.find((run) => run.name === player.name);
      const row = el('li');
      row.append(
        el('span', 'who', player.name || 'unnamed hero'),
        el('span', 'val', active ? `Q${active.stage}/${active.total} · ${active.score} pts` : 'lobby')
      );
      host.appendChild(row);
    });
  }

  function renderFeed() {
    const host = clear($('admin-feed'));
    if (!state.feed.length) {
      host.appendChild(el('li', 'muted', 'Waiting for finished runs…'));
      return;
    }
    state.feed.forEach((record) => {
      const row = el('li');
      row.append(
        el('span', 'who', record.name),
        el('span', 'val', `${record.score}/${record.total} · ${formatSeconds(record.timeSeconds)}`)
      );
      host.appendChild(row);
    });
  }

  async function clearAll() {
    if (!confirm('Clear all stored student score records on the server?')) return;
    try {
      const { removed } = await api.clear();
      toast(`Cleared ${removed} record(s).`, 'ok');
      state.feed = [];
      renderFeed();
      loadScores();
    } catch (error) {
      toast(error.message, 'bad');
    }
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  bind();
  return { loadScores, open };
}
