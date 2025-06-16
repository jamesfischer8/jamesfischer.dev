import {
  defineWorkersConfig,
} from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    coverage: {
      provider: 'c8',
      reporter: ['text', 'lcov'],
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});