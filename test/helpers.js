// Every test file runs in its own process. Call setup() before importing server modules so the
// config sees mock Qloo, AI off and a throwaway data directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wayin-test-'));
  process.env.WAYIN_ENV_FILE = path.join(dir, 'no.env');
  process.env.WAYIN_DATA_DIR = dir;
  process.env.QLOO_MODE = 'mock';
  process.env.AI_PROVIDER = 'off';
  delete process.env.QLOO_API_KEY;
  delete process.env.AZURE_OPENAI_API_KEY;
  return dir;
}
