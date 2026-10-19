import { api } from './net.js';
import { clear, el, formatSeconds, $, toast } from './dom.js';
import { isSoundEnabled, playSound, setSoundEnabled } from './audio.js';

const SCREENS = ['screen-character', 'screen-battle', 'screen-victory'];

export function createGame({ live }) {
  const state = {
    config: null,
    heroClass: 'paladin',
    runId: null,
    questions: [],
    index: 0,
    score: 0,
    answers: [],
    startedAt: 0,
    elapsed: 0,
    timer: null,
    busy: false,
    presence: { clients: [], runs: [] },
  };

  function switchScreen(id) {
    SCREENS.forEach((screen) => $(screen).hidden = screen !== id);
  }

  async function boot() {
    state.config = await api.config();
    renderClassCards();
    renderHeroStatic();
    switchScreen('screen-character');
    $('player-name-input').addEventListener('input', () => {
      $('name-error').hidden = true;
    });
    $('hero-form').addEventListener('submit', (event) => {
      event.preventDefault();
      beginQuest();
    });
    $('again-btn').addEventListener('click', () => {
      switchScreen('screen-character');
      refreshLobbyBoard();
    });
    $('sound-btn').addEventListener('click', toggleSound);
    live.onPresence((presence) => {
      state.presence = presence;
      renderOnlineCount();
      renderPartyStrip();
      renderLobbyOnline();
    });
    await refreshLobbyBoard();
  }

  function renderClassCards() {
    const host = clear($('class-selector'));
    for (const heroClass of state.config.classes) {
      const card = el('button', 'class-card');
      card.type = 'button';
      card.dataset.key = heroClass.key;
      if (heroClass.key === state.heroClass) card.classList.add('selected');
      card.append(el('span', 'class-icon', heroClass.icon), el('span', 'class-name', heroClass.name));
      card.addEventListener('click', () => selectClass(heroClass.key));
      host.appendChild(card);
    }
  }

  function selectClass(key) {
    state.heroClass = key;
    for (const card of $('class-selector').children) {
      card.classList.toggle('selected', card.dataset.key === key);
    }
    renderHeroStatic();
    playSound('join');
  }

  function renderHeroStatic() {
    const heroClass = state.config?.classes.find((entry) => entry.key === state.heroClass);
    if (!heroClass) return;
    $('hero-avatar').textContent = heroClass.icon;
    $('hero-class-label').textContent = heroClass.name;
  }

  function toggleSound() {
    const next = !isSoundEnabled();
    setSoundEnabled(next);
    $('sound-btn').firstChild.textContent = next ? '🔊 ' : '🔇 ';
    if (next) playSound('join');
  }

  async function beginQuest() {
    const name = $('player-name-input').value.trim();
    if (!name) {
      $('name-error').hidden = false;
      return;
    }
    const button = $('begin-btn');
    button.disabled = true;
    button.textContent = 'OPENING QUEST…';
    try {
      const run = await api.startRun(name, state.heroClass);
      state.runId = run.runId;
      state.questions = run.questions;
      state.index = 0;
      state.score = 0;
      state.answers = [];
      state.startedAt = Date.now();
      state.elapsed = 0;
      startTimer();
      $('hud-player-name').textContent = name;
      live.identify('player', name);
      switchScreen('screen-battle');
      renderQuestion();
    } catch (error) {
      toast(error.message, 'bad');
    } finally {
      button.disabled = false;
      button.textContent = 'BEGIN QUEST ⚔️';
    }
  }

  function startTimer() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      $('hud-timer').textContent = formatSeconds(state.elapsed);
    }, 1000);
  }

  function monsterFor(index) {
    const monsters = state.config.monsters;
    return monsters[Math.min(Math.floor(index / 2), monsters.length - 1)];
  }

  function renderQuestion() {
    const question = state.questions[state.index];
    const monster = monsterFor(state.index);

    $('hud-stage').textContent = `${state.index + 1} / ${state.questions.length}`;
    $('hud-score').textContent = state.score;
    $('q-number').textContent = `Q${question.id}`;
    $('question-text').textContent = question.question;
    $('monster-name').textContent = monster.name;
    $('monster-avatar').textContent = monster.avatar;
    $('monster-type-badge').textContent = monster.badge;
    setMonsterHp(100);
    $('log-text').textContent = `A wild ${monster.name} attacks! Choose the correct sorting spell!`;

    const host = clear($('options-container'));
    question.options.forEach((option, optionIndex) => {
      const button = el('button', 'option-btn');
      button.type = 'button';
      button.append(el('span', 'letter', `${String.fromCharCode(65 + optionIndex)})`));
      button.append(el('span', undefined, option));
      button.addEventListener('click', () => submitAnswer(optionIndex, button));
      host.appendChild(button);
    });
    renderPartyStrip();
  }

  function setMonsterHp(percent) {
    $('monster-hp-bar').style.width = `${Math.max(0, percent)}%`;
    $('monster-hp-text').textContent = `${Math.max(0, Math.round(percent))} HP`;
  }

  async function submitAnswer(selected, button) {
    if (state.busy) return;
    state.busy = true;
    const buttons = [...$('options-container').children];
    buttons.forEach((node) => (node.disabled = true));

    try {
      const { entry } = await api.answer(state.runId, state.index, selected);
      state.answers.push(entry);
      if (entry.isCorrect) state.score += 1;
      $('hud-score').textContent = state.score;

      buttons[entry.correct]?.classList.add('correct');
      if (!entry.isCorrect) button.classList.add('wrong');

      if (entry.isCorrect) {
        playSound('hit');
        lunge();
        setMonsterHp(0);
        popup('-100 HP!', 'green');
        $('log-text').textContent = 'CRITICAL STRIKE! Your sorting logic deals lethal damage!';
      } else {
        playSound('hurt');
        $('battle-stage').classList.add('shake');
        popup('MISSED!', 'rose');
        setMonsterHp(60);
        $('log-text').textContent = 'SPELL MISSED! The boss counters your attack!';
        setTimeout(() => $('battle-stage').classList.remove('shake'), 420);
      }
    } catch (error) {
      toast(error.message, 'bad');
      state.busy = false;
      buttons.forEach((node) => (node.disabled = false));
      return;
    }

    setTimeout(() => {
      state.busy = false;
      state.index += 1;
      if (state.index < state.questions.length) renderQuestion();
      else finishQuest();
    }, 1250);
  }

  function lunge() {
    const hero = $('hero-sprite-box');
    const monster = $('monster-sprite-box');
    hero.classList.add('lunge');
    monster.classList.add('hit');
    setTimeout(() => {
      hero.classList.remove('lunge');
      monster.classList.remove('hit');
    }, 420);
  }

  function popup(message, colorClass) {
    const node = el('div', `popup ${colorClass}`, message);
    $('damage-container').appendChild(node);
    setTimeout(() => node.remove(), 900);
  }

  async function finishQuest() {
    clearInterval(state.timer);
    try {
      const { record } = await api.finish(state.runId);
      state.runId = null;
      playSound('victory');
      renderVictory(record);
      switchScreen('screen-victory');
      live.identify('player', record.name);
    } catch (error) {
      toast(error.message, 'bad');
      switchScreen('screen-character');
    }
  }

  function renderVictory(record) {
    $('winner-name').textContent = record.name;
    $('final-score').textContent = `${record.score} / ${record.total}`;
    $('final-accuracy').textContent = `${record.accuracy}%`;
    $('final-time').textContent = formatSeconds(record.timeSeconds);
    $('final-rank').textContent = record.rank;

    const host = clear($('review-container'));
    host.appendChild(el('h3', 'review-head', 'BATTLE REVIEW & ANSWERS KEY:'));
    state.answers.forEach((answer, index) => {
      const item = el('div', `review-item ${answer.isCorrect ? 'ok' : 'bad'}`);
      item.append(el('div', 'q', `Q${index + 1}: ${answer.question}`));
      item.append(
        el('div', answer.isCorrect ? 'ans-ok' : 'ans-bad', `Your answer: ${answer.selectedText}`)
      );
      if (!answer.isCorrect) {
        item.append(el('div', 'ans-ok', `Correct answer: ${answer.correctText}`));
      }
      item.append(el('div', 'why', answer.explanation));
      host.appendChild(item);
    });
  }

  function renderOnlineCount() {
    const players = state.presence.clients.filter((client) => client.role === 'player');
    $('online-count').textContent = `${players.length} online`;
  }

  function renderLobbyOnline() {
    if (!$('screen-character').hidden) {
      const players = state.presence.clients.filter((client) => client.role === 'player' && client.name);
      const host = clear($('lobby-online'));
      if (!players.length) {
        host.appendChild(el('li', 'muted', 'Nobody connected yet'));
        return;
      }
      players.forEach((player, index) => {
        const row = el('li');
        row.append(el('span', 'rank-no', String(index + 1)), el('span', 'who', player.name));
        host.appendChild(row);
      });
    }
  }

  function renderPartyStrip() {
    if ($('screen-battle').hidden) return;
    const host = clear($('party-strip'));
    const others = state.presence.runs.filter((run) => run.runId !== state.runId);
    if (!others.length) {
      host.appendChild(el('span', undefined, 'No other heroes in battle right now.'));
      return;
    }
    host.appendChild(el('span', undefined, `In battle now: `));
    others
      .slice(0, 6)
      .forEach((run) => {
        const chip = el('span', 'party-chip');
        chip.append(document.createTextNode(`${run.name} · `));
        chip.appendChild(el('b', undefined, `Q${run.stage}/${run.total}`));
        host.appendChild(chip);
      });
  }

  async function refreshLobbyBoard() {
    try {
      const { records } = await api.scores({ limit: 6 });
      const host = clear($('lobby-leaderboard'));
      if (!records.length) {
        host.appendChild(el('li', 'muted', 'No runs recorded yet — be the first!'));
        return;
      }
      records.forEach((record, index) => {
        const row = el('li');
        row.append(
          el('span', 'rank-no', String(index + 1)),
          el('span', 'who', record.name),
          el('span', 'val', `${record.score}/${record.total}`)
        );
        host.appendChild(row);
      });
    } catch {
      /* header pill already reports the connection problem */
    }
  }

  return { boot, state, switchScreen, refreshLobbyBoard };
}
