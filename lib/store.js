import fs from 'node:fs';
import path from 'node:path';

const SAVE_DEBOUNCE_MS = 250;

export class ScoreStore {
  constructor(file) {
    this.file = file;
    this.records = [];
    this.saveTimer = null;
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(parsed)) this.records = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[store] could not read ${this.file}: ${error.message}`);
      }
    }
  }

  persist() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.records), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.error(`[store] could not write ${this.file}: ${error.message}`);
    }
  }

  add(record) {
    this.records.unshift(record);
    this.persist();
    return record;
  }

  list({ limit = 100, offset = 0, search = '' } = {}) {
    const needle = search.trim().toLowerCase();
    const rows = needle
      ? this.records.filter((r) => r.name.toLowerCase().includes(needle))
      : this.records;
    return {
      total: rows.length,
      rows: rows.slice(offset, offset + limit).map(toSummary),
    };
  }

  get(id) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  clear() {
    const removed = this.records.length;
    this.records = [];
    this.flush();
    return removed;
  }

  stats() {
    const count = this.records.length;
    if (!count) return { count: 0, avgAccuracy: 0, perfectRuns: 0, fastestSeconds: null };
    const accuracies = this.records.map((r) => r.accuracy);
    const times = this.records.filter((r) => r.timeSeconds > 0).map((r) => r.timeSeconds);
    return {
      count,
      avgAccuracy: Math.round(accuracies.reduce((a, b) => a + b, 0) / count),
      perfectRuns: this.records.filter((r) => r.score === r.total).length,
      fastestSeconds: times.length ? Math.min(...times) : null,
    };
  }

  toCsv() {
    const header = [
      'ID',
      'Student Name',
      'Hero Class',
      'Score',
      'Total Questions',
      'Accuracy %',
      'Time Taken (s)',
      'Rank',
      'Finished At',
    ];
    const lines = [header];
    for (const r of this.records) {
      lines.push([
        r.id,
        r.name,
        r.heroClass,
        r.score,
        r.total,
        r.accuracy,
        r.timeSeconds,
        r.rank,
        new Date(r.finishedAt).toISOString(),
      ]);
    }
    return lines
      .map((cells) => cells.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\r\n');
  }
}

function toSummary(record) {
  return {
    id: record.id,
    name: record.name,
    heroClass: record.heroClass,
    score: record.score,
    total: record.total,
    accuracy: record.accuracy,
    timeSeconds: record.timeSeconds,
    rank: record.rank,
    finishedAt: record.finishedAt,
    hasReview: Array.isArray(record.answers),
  };
}
