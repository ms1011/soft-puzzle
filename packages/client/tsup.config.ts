import { defineConfig } from 'tsup';

/**
 * 배포용 번들 구성. 워크스페이스 코드(@soft-puzzle/core, @soft-puzzle/server, client 자체
 * src)는 전부 dist/index.js 하나로 묶는다 — 이 패키지들은 npm에 따로 게시되지 않으므로
 * 설치된 패키지에서 그 import를 풀 방법이 없다. 반대로 실제 npm 서드파티 패키지(ink,
 * react, ink-text-input)는 external로 남겨 package.json dependencies로 설치되게 한다.
 */
export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  clean: true,
  dts: false,
  sourcemap: false,
  splitting: false,
  external: ['ink', 'react', 'ink-text-input'],
});
