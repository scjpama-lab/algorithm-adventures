import crypto from 'node:crypto';
import fs from 'node:fs';

const RUN_TTL_MS = 40 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export function loadQuestionBank(file) {
  const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(bank.questions) || bank.questions.length === 0) {
    throw new Error(`Question bank ${file} is empty or malformed`);
  }
  for (const question of bank.questions) {
    if (!Array.isArray(question.options) || question.correct == null) {
      throw new Error(`Question ${question.id} is missing options or an answer key`);
    }
  }
  return bank;
}

export function rankFor(accuracy) {
  if (accuracy === 100) return 'GRANDMASTER SORTER';
  if (accuracy >= 80) return 'ALGORITHM ARCHMAGE';
  if (accuracy >= 60) return 'DIVIDE & CONQUER KNIGHT';
  return 'SORTING NOVICE';
}

export function sanitizeName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 40);
}

export class RunRegistry {
  constructor(bank, { onProgress, onFinish } = {}) {
    this.bank = bank;
    this.runs = new Map();
    this.onProgress = onProgress ?? (() => {});
    this.onFinish = onFinish ?? (() => {});
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  get total() {
    return this.bank.questions.length;
  }

  create({ name, heroClass }) {
    this.cleanup();
    const runId = crypto.randomUUID();
    const run = {
      runId,
      name,
      heroClass,
      startedAt: Date.now(),
      answers: new Array(this.total).fill(null),
      score: 0,
      finished: false,
    };
    this.runs.set(runId, run);
    this.onProgress(run);
    return {
      runId,
      total: this.total,
      questions: this.bank.questions.map(({ id, topic, question, options }) => ({
        id,
        topic,
        question,
        options,
      })),
    };
  }

  answer(runId, index, selected) {
    const run = this.runs.get(runId);
    if (!run) throw new HttpError(404, 'Unknown or expired run. Start a new quest.');
    if (run.finished) throw new HttpError(409, 'This run is already submitted.');
    if (!Number.isInteger(index) || index < 0 || index >= this.total) {
      throw new HttpError(400, 'Question index is out of range.');
    }
    const question = this.bank.questions[index];
    if (!Number.isInteger(selected) || selected < 0 || selected >= question.options.length) {
      throw new HttpError(400, 'Answer option is out of range.');
    }
    if (run.answers[index]) throw new HttpError(409, 'That question was already answered.');

    const isCorrect = selected === question.correct;
    const entry = {
      id: question.id,
      question: question.question,
      selected,
      selectedText: question.options[selected],
      correct: question.correct,
      correctText: question.options[question.correct],
      isCorrect,
      explanation: question.explanation,
    };
    run.answers[index] = entry;
    if (isCorrect) run.score += 1;
    run.lastActivityAt = Date.now();
    this.onProgress(run);
    return entry;
  }

  finish(runId) {
    const run = this.runs.get(runId);
    if (!run) throw new HttpError(404, 'Unknown or expired run. Start a new quest.');
    if (run.finished) throw new HttpError(409, 'This run is already submitted.');

    const answered = run.answers.filter(Boolean);
    if (answered.length !== this.total) {
      throw new HttpError(400, `Run is incomplete: ${answered.length}/${this.total} answered.`);
    }

    run.finished = true;
    const accuracy = Math.round((run.score / this.total) * 100);
    const record = {
      id: `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
      name: run.name,
      heroClass: run.heroClass,
      score: run.score,
      total: this.total,
      accuracy,
      rank: rankFor(accuracy),
      timeSeconds: Math.max(0, Math.round((Date.now() - run.startedAt) / 1000)),
      startedAt: run.startedAt,
      finishedAt: Date.now(),
      answers: run.answers,
    };
    this.runs.delete(runId);
    this.onFinish(record);
    return record;
  }

  summary(run) {
    return {
      runId: run.runId,
      name: run.name,
      heroClass: run.heroClass,
      stage: run.answers.filter(Boolean).length,
      total: this.total,
      score: run.score,
      startedAt: run.startedAt,
    };
  }

  active() {
    return [...this.runs.values()].map((run) => this.summary(run));
  }

  cleanup() {
    const cutoff = Date.now() - RUN_TTL_MS;
    for (const [runId, run] of this.runs) {
      if ((run.lastActivityAt ?? run.startedAt) < cutoff) this.runs.delete(runId);
    }
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
