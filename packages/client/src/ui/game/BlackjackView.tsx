import React from 'react';
import { Box, Text } from 'ink';
import type { GameViewProps } from './types.js';

/**
 * 블랙잭 게임 화면 스텁. Task 13이 실제 화면(패·베팅·히트/스탠드 UI)으로 대체한다 — 지금은
 * App이 화면 라우팅 맵({blackjack, onecard, yacht})을 완성해 렌더 트리가 깨지지 않게 하는 것이
 * 이 파일의 유일한 목적이다.
 */
export function BlackjackView({ view }: GameViewProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text>블랙잭 화면 준비 중입니다 (phase: {view.phase})</Text>
    </Box>
  );
}
