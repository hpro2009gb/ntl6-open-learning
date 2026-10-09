import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`CORRUPT_JSONL:${filePath}:${index + 1}:${error.message}`); }
    });
}

export function appendJsonLine(filePath, record) {
  ensureParent(filePath);
  const fd = fs.openSync(filePath, 'a');
  try {
    fs.writeSync(fd, JSON.stringify(record) + '\n', null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function acquireFileLock(lockPath) {
  ensureParent(lockPath);
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const locked = new Error(`WRITER_LOCKED:${lockPath}`);
      locked.code = 'WRITER_LOCKED';
      throw locked;
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { fs.closeSync(fd); }
    finally {
      try { fs.unlinkSync(lockPath); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
  };
}

export function withFileLock(lockPath, fn) {
  const release = acquireFileLock(lockPath);
  try { return fn(); }
  finally { release(); }
}
