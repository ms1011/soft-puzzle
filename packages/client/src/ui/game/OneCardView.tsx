import React from 'react';
import { Box, Text } from 'ink';
import type { GameViewProps } from './types.js';

/**
 * 원카드 게임 화면 스텁. Task 14가 실제 화면(패·공격 카드 선택 UI)으로 대체한다 — 지금은 App의
 * 화면 라우팅 맵을 완성하는 것이 이 파일의 유일한 목적이다.
 */
export function OneCardView({ view }: GameViewProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text>원카드 화면 준비 중입니다 (phase: {view.phase})</Text>
    </Box>
  );
}
