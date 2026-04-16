/*
 * Copyright 2026 Otto the Agent
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Persist OAuth tokens to ~/.openclaw/.otto-tokens.json with 0600 permissions.
 * Matches the ecosystem convention (OpenClaw stores its own auth-profiles.json the same way).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp (seconds)
  scope: string;
  client_id: string;
  server_url: string;
}

const TOKEN_DIR = join(homedir(), ".openclaw");
const TOKEN_FILE = join(TOKEN_DIR, ".otto-tokens.json");

export async function loadTokens(serverUrl: string): Promise<StoredTokens | null> {
  try {
    const raw = await readFile(TOKEN_FILE, "utf-8");
    const tokens: StoredTokens = JSON.parse(raw);
    // Only return tokens that match the configured server
    if (tokens.server_url !== serverUrl) return null;
    return tokens;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function isExpired(tokens: StoredTokens): boolean {
  // Treat as expired 60s before actual expiry to avoid edge cases
  return Date.now() / 1000 > tokens.expires_at - 60;
}
