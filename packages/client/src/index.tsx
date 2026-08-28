#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.js';
import { detectTheme } from './art/theme.js';

/**
 * bin 진입점. detectTheme는 순수 함수라 실제 process.argv/process.env를 여기서 직접
 * 넘겨야 한다(art/theme.ts 참고) — platform은 세 번째 인자를 생략해 실제 process.platform을
 * 그대로 쓴다.
 *
 * SIGINT(Ctrl+C) 핸들러는 여기서 만들지 않는다: Ink가 내부적으로 signal-exit로 등록한
 * unmount가 이미 터미널 상태(raw mode 등)를 복원한다. 우리가 별도로 SIGINT를 잡으면 두
 * 핸들러가 종료 순서를 놓고 경쟁할 수 있다 — App.tsx의 정리 effect(cleanupResources)가
 * 바로 그 unmount 시점에 실행되어 리스닝 소켓(TCP 서버·UDP 디스커버리)을 닫는다.
 */
const theme = detectTheme(process.argv, process.env);

const instance = render(<App initialTheme={theme} />);

// render()는 예외를 삼키지 않는다 — 렌더 트리 안에서 처리되지 않은 에러로 unmount되면
// waitUntilExit()의 프라미스가 reject된다. 여기서 잡지 않으면 unhandledRejection으로
// 새어나가 사용자에게 스택 트레이스만 던지고 끝나므로, 최소한의 안내와 종료 코드를 남긴다.
instance.waitUntilExit().catch((err: unknown) => {
  console.error('[soft-puzzle] 예기치 않은 오류로 종료되었습니다:', err);
  process.exitCode = 1;
});
