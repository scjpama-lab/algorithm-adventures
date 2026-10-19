export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function toast(message, kind = '') {
  const host = $('toasts');
  const node = el('div', `toast ${kind}`.trim(), message);
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity 0.25s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, 3200);
}

export function formatSeconds(value) {
  const seconds = Math.max(0, Math.round(value ?? 0));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatTime(timestamp) {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
