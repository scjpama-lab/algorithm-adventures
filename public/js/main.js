import { LiveSocket } from './net.js';
import { $, toast } from './dom.js';
import { isSoundEnabled, setSoundEnabled } from './audio.js';
import { createGame } from './game.js';
import { createAdmin } from './admin.js';

const presenceListeners = [];
const feedListeners = [];

const socket = new LiveSocket({
  onEvent: (event) => {
    if (event.type === 'presence' || event.type === 'hello') {
      const presence = {
        clients: event.clients ?? event.presence ?? [],
        runs: event.runs ?? [],
      };
      presenceListeners.forEach((listener) => listener(presence));
    }
    if (event.type === 'run:finished') {
      feedListeners.forEach((listener) => listener(event.record));
    }
  },
  onState: setNetState,
});

const live = {
  onPresence: (listener) => presenceListeners.push(listener),
  onRunFinished: (listener) => feedListeners.push(listener),
  identify: (role, name) => socket.identify(role, name),
};

function setNetState(state) {
  const pill = $('net-status');
  pill.dataset.state = state;
  $('net-status-text').textContent = state === 'online' ? 'live' : state === 'connecting' ? 'connecting…' : 'offline — retrying';
}

const savedSound = localStorage.getItem('aq.sound');
if (savedSound !== null) setSoundEnabled(savedSound === 'on');
refreshSoundButton();

function refreshSoundButton() {
  $('sound-btn').firstChild.textContent = isSoundEnabled() ? '🔊 ' : '🔇 ';
}

$('sound-btn').addEventListener('click', () => {
  localStorage.setItem('aq.sound', isSoundEnabled() ? 'on' : 'off');
  refreshSoundButton();
});

const game = createGame({ live });
createAdmin({ live });

socket.connect();

game.boot().then(() => {
  refreshSoundButton();
}).catch((error) => {
  toast(`Could not reach the game server: ${error.message}`, 'bad');
});

window.addEventListener('online', () => socket.connect());
