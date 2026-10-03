import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Absolute path to the repository root (…/RoundTable). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The single .env file lives at the repo root and is only ever read server-side.
loadEnv({ path: path.join(REPO_ROOT, '.env'), quiet: true });

export const PORT = Number(process.env.PORT ?? 8787);

/** Server-only secret. Never send this to the browser. */
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? '';

export const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live';

export const DEBUG = process.env.DEBUG_GEMINI === '1';

export const CLIENT_DIST = path.join(REPO_ROOT, 'client', 'dist');
