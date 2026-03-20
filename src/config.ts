import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ConfigError } from './errors.js';

const configSchema = z.object({
  eideticDataDir: z.string().default(path.join(os.homedir(), '.eidetic')),
});

export type Config = z.infer<typeof configSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  const raw = {
    eideticDataDir: process.env.EIDETIC_DATA_DIR,
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function getConfig(): Config {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}
