const ADMIN_KEY_STORAGE = 'aq.adminKey';

export function getAdminKey() {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? '';
}

export function setAdminKey(key) {
  if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  else sessionStorage.removeItem(ADMIN_KEY_STORAGE);
}

async function request(method, url, { body, admin = false } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (admin) headers['x-admin-key'] = getAdminKey();

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) throw new Error('Admin key required.');
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `Request failed (${response.status})`);
  }
  return response.json();
}

export const api = {
  health: () => request('GET', '/api/health'),
  config: () => request('GET', '/api/config'),
  startRun: (name, heroClass) => request('POST', '/api/runs/start', { body: { name, heroClass } }),
  answer: (runId, index, selected) =>
    request('POST', `/api/runs/${runId}/answer`, { body: { index, selected } }),
  finish: (runId) => request('POST', `/api/runs/${runId}/finish`),
  scores: ({ limit = 60, q = '' } = {}) =>
    request('GET', `/api/scores?limit=${limit}&q=${encodeURIComponent(q)}`),
  record: (id) => request('GET', `/api/scores/${encodeURIComponent(id)}`, { admin: true }),
  verifyAdminKey: () => request('POST', '/api/admin/verify', { admin: true }),
  clear: () => request('DELETE', '/api/scores', { admin: true }),
  csvUrl: () => `/api/export.csv?key=${encodeURIComponent(getAdminKey())}`,
};

export class LiveSocket {
  constructor({ onEvent, onState } = {}) {
    this.onEvent = onEvent ?? (() => {});
    this.onState = onState ?? (() => {});
    this.socket = null;
    this.clientId = null;
    this.identity = { role: 'player', name: '' };
    this.reconnectDelay = 800;
    this.closedByUser = false;
  }

  connect() {
    this.closedByUser = false;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.onState('connecting');
    try {
      this.socket = new WebSocket(`${protocol}//${location.host}/ws`);
    } catch {
      this.onState('offline');
      return;
    }

    this.socket.addEventListener('open', () => {
      this.reconnectDelay = 800;
      this.onState('online');
      this.identify(this.identity.role, this.identity.name);
    });
    this.socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'hello') this.clientId = payload.clientId;
      this.onEvent(payload);
    });
    this.socket.addEventListener('close', () => {
      this.onState('offline');
      if (!this.closedByUser) this.scheduleReconnect();
    });
    this.socket.addEventListener('error', () => this.socket?.close());
  }

  scheduleReconnect() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.8, 12000);
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  identify(role, name = '') {
    this.identity = { role, name };
    this.send({ type: 'identify', role, name });
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }
}
