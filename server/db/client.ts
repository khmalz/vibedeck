import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { initSchema } from './schema';

const DEFAULT_DB_PATH = '~/.vibedeck/vibedeck.db';

/** Expand leading tilde to os.homedir() cleanly across Windows and POSIX. */
export function resolveDbPath(rawPath?: string): string {
  const input = rawPath?.trim() || DEFAULT_DB_PATH;
  if (input === ':memory:') {
    return ':memory:';
  }
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.resolve(os.homedir(), input.slice(2));
  }
  return path.resolve(input);
}

/** Open or create a bun:sqlite database with WAL mode, foreign keys, and schema. */
export function createDb(customPath?: string): Database {
  const resolvedPath = resolveDbPath(customPath ?? process.env.VIBEDECK_DB_PATH);
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const instance = new Database(resolvedPath, { create: true, strict: true });
  instance.run('PRAGMA journal_mode = WAL;');
  instance.run('PRAGMA foreign_keys = ON;');
  initSchema(instance);
  return instance;
}

export const dbPath = resolveDbPath(process.env.VIBEDECK_DB_PATH);
export const db = createDb(dbPath);
