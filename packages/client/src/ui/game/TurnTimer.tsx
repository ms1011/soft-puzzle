import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import { TURN_TIMEOUT_MS } from '@soft-puzzle/core';
import type { Theme } from '../../art/theme.js';

const BAR_CELLS = 10;
/** 이 초 이하로 남으면 빨간색으로 경고한다. */
const WARN_SECONDS = 15;

/**
 * 남은 시간을 10칸 막대로 그린다. 남은 시간이 0보다 크면 최소 한 칸은 채운다 — 1초가 남았는데
 * 막대가 비어 있으면 이미 끝난 것처럼 보이기 때문이다. ascii 테마는 구형 콘솔용이라 [##---]로 그린다.
 */
export function timerBar(remaining: number, total: number, theme: Theme): string {
  const ratio = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  const filled = remaining > 0 ? Math.max(1, Math.round(ratio * BAR_CELLS)) : 0;
  if (theme.unicode) return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
  return `[${'#'.repeat(filled)}${'-'.repeat(BAR_CELLS - filled)}]`;
}

/** 현재 입력 단계가 자동 처리되기까지 남은 시간. */
export function TurnTimer({ deadline, theme }: { deadline: number; theme: Theme }): React.JSX.Element {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const update = (): void => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return (
    <Text color={remaining <= WARN_SECONDS ? 'red' : undefined}>
      {theme.unicode ? '⏱ ' : ''}
      {timerBar(remaining, TURN_TIMEOUT_MS / 1000, theme)} 자동 처리까지 {remaining}초
    </Text>
  );
}
