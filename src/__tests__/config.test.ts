import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must re-import loadConfig each test to avoid cached config
describe('loadConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // Reset module cache so cachedConfig is cleared
    vi.resetModules();
  });

  async function freshLoadConfig() {
    const mod = await import('../config.js');
    return mod.loadConfig;
  }

  it('loads with default eideticDataDir', async () => {
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.eideticDataDir).toContain('.eidetic');
  });

  it('overrides eideticDataDir from EIDETIC_DATA_DIR env var', async () => {
    vi.stubEnv('EIDETIC_DATA_DIR', '/custom/data');
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.eideticDataDir).toBe('/custom/data');
  });
});
