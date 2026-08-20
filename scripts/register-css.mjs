import { register } from 'node:module';

/**
 * The component tests run through `tsx`, which takes its JSX setting from the
 * nearest tsconfig, and the web app's says `preserve` because Next compiles it.
 * Preserve becomes the classic runtime here, so every component would need
 * React in scope to render. Pointing tsx at a test-only config is cheaper than
 * importing React into thirty components for the benefit of the test runner,
 * and it has to happen before tsx loads, which is why this import comes first.
 */
process.env.TSX_TSCONFIG_PATH ??= 'apps/web/tsconfig.test.json';

register('./css-hooks.mjs', import.meta.url);
