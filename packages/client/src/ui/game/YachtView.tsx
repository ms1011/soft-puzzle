import React from 'react';
import { Box, Text } from 'ink';
import type { GameViewProps } from './types.js';

/**
 * 야추 게임 화면 스텁. Task 15가 실제 화면(주사위·홀드·점수표 UI)으로 대체한다 — 지금은 App의
 * 화면 라우팅 맵을 완성하는 것이 이 파일의 유일한 목적이다.
 */
export function YachtView({ view }: GameViewProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text>야추 화면 준비 중입니다 (phase: {view.phase})</Text>
    </Box>
  );
}
