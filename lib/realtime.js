import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';

const HEARTBEAT_MS = 20000;

export class Realtime {
  constructor(httpServer, { getPresence } = {}) {
    this.getPresence = getPresence ?? (() => []);
    this.clients = new Map();
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 8192 });

    this.wss.on('connection', (socket, request) => this.onConnection(socket, request));
    this.heartbeat = setInterval(() => this.pruneDead(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  onConnection(socket, request) {
    const client = {
      id: crypto.randomUUID(),
      socket,
      role: 'player',
      name: '',
      address: request.socket.remoteAddress,
      connectedAt: Date.now(),
      alive: true,
    };
    this.clients.set(client.id, client);
    socket.on('pong', () => (client.alive = true));
    socket.on('message', (raw) => this.onMessage(client, raw));
    socket.on('close', () => {
      this.clients.delete(client.id);
      this.broadcastPresence();
    });
    this.send(
      socket,
      JSON.stringify({
        type: 'hello',
        clientId: client.id,
        serverTime: Date.now(),
        presence: this.snapshot(),
      })
    );
    this.broadcastPresence();
  }

  onMessage(client, raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message?.type === 'identify') {
      client.role = message.role === 'admin' ? 'admin' : 'player';
      client.name = String(message.name ?? '').slice(0, 40);
      this.broadcastPresence();
    }
  }

  snapshot() {
    return [...this.clients.values()].map((client) => ({
      id: client.id,
      role: client.role,
      name: client.name,
      connectedAt: client.connectedAt,
    }));
  }

  broadcastPresence() {
    this.broadcast({ type: 'presence', clients: this.snapshot(), runs: this.getPresence() });
  }

  send(socket, payload) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }

  broadcast(event) {
    const payload = JSON.stringify(event);
    for (const client of this.clients.values()) this.send(client.socket, payload);
  }

  pruneDead() {
    for (const client of this.clients.values()) {
      if (!client.alive) {
        client.socket.terminate();
        this.clients.delete(client.id);
        continue;
      }
      client.alive = false;
      try {
        client.socket.ping();
      } catch {
        client.socket.terminate();
        this.clients.delete(client.id);
      }
    }
    this.broadcastPresence();
  }

  get connectedCount() {
    return this.clients.size;
  }

  close() {
    clearInterval(this.heartbeat);
    for (const client of this.clients.values()) client.socket.close(1001, 'server shutting down');
    this.wss.close();
  }
}
