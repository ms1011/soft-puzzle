import React from 'react';
import { render as inkRender } from 'ink';
import { EventEmitter } from 'node:events';

/**
 * ink-testing-library의 Stdout은 columns를 100으로 고정해 놓아(node_modules/ink-testing-library/
 * build/index.js) 리뷰가 실측한 "3인 80칼럼·6인 100칼럼에서 표가 깨진다"를 그 라이브러리로는
 * 재현할 수 없다. ink-testing-library가 내부에서 하는 것과 똑같은 최소 Stdout/Stdin/Stderr
 * 스텁을 직접 만들되 columns만 주입 가능하게 열어 둔다.
 */
class FakeStdout extends EventEmitter {
  constructor(public columns: number) {
    super();
  }
  frames: string[] = [];
  private _lastFrame?: string;
  write = (frame: string): void => {
    this.frames.push(frame);
    this._lastFrame = frame;
  };
  lastFrame = (): string | undefined => this._lastFrame;
}

class FakeStderr extends EventEmitter {
  write = (): void => {};
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  setRawMode(): void {}
  ref(): void {}
  unref(): void {}
  setEncoding(): void {}
  resume(): void {}
  pause(): void {}
}

/** 지정한 터미널 폭(columns)으로 렌더한다 — 실제 터미널 폭에서의 줄바꿈/압축 동작을
 * 검증하기 위한 것으로, ink-testing-library의 고정 100칼럼 render()로는 할 수 없다. */
export function renderAtWidth(
  node: React.ReactElement,
  columns: number,
): { lastFrame: () => string | undefined; unmount: () => void } {
  const stdout = new FakeStdout(columns);
  const stderr = new FakeStderr();
  const stdin = new FakeStdin();
  const instance = inkRender(node, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stdout: stdout as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stderr: stderr as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stdin: stdin as any,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { lastFrame: () => stdout.lastFrame(), unmount: instance.unmount };
}

// 한글 자모·한글 음절 범위 — art/width.ts의 WIDE_RANGES 중 이 프로젝트의 한국어 UI 텍스트가
// 실제로 쓰는 범위만 허용 목록으로 다시 쓴다(예: CJK 한자·전각 기호는 이 앱에 나오지 않으므로
// "그 외 전부 금지"에 포함된다 — 곧 유니코드 전용 글리프가 새로 섞여도 잡아낸다).
const HANGUL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff],
  [0xac00, 0xd7a3],
];

function isAsciiOrHangul(codePoint: number): boolean {
  if (codePoint <= 0x7f) return true;
  return HANGUL_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** ASCII·한글이 아닌 코드포인트를 전부 모아 돌려준다(중복 제거). 빈 배열이면 순수하다는 뜻. */
export function findNonAsciiNonHangul(str: string): string[] {
  const found = new Set<string>();
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!isAsciiOrHangul(cp)) found.add(ch);
  }
  return [...found];
}
