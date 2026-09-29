import type { VitestConfig } from 'vitest/config';

declare module 'vite' {
  interface UserConfig {
    test?: VitestConfig['test'];
  }
}
