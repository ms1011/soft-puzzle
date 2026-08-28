import React from 'react';
import { Box, Text } from 'ink';

export interface ActionBarProps {
  /** 지금 이 순간 서버가 허용하는 액션 이름 목록 — 보통 GameView.yourActions를 그대로 넘긴다. */
  actions: string[];
  /** 액션 이름 → 한국어 표시 라벨. 매핑이 없는 액션은 이름 자체를 라벨로 쓴다. */
  labels: Record<string, string>;
}

/**
 * 하단 키 안내 바. actions에 있는 것만, 그 순서 그대로 표시한다 — 서버가 지금 허용하지 않는
 * 액션은 절대 보여주지 않는다(브리프 요구사항 4: "행동 바는 yourActions에서만, 하드코딩된
 * 목록에서가 아니라"). 키 힌트는 액션 이름의 첫 글자를 쓴다 — 예: 'bet' → [b], 'hit' → [h].
 */
export function ActionBar({ actions, labels }: ActionBarProps): React.JSX.Element {
  if (actions.length === 0) {
    return <Text dimColor>(지금은 할 수 있는 행동이 없습니다)</Text>;
  }

  return (
    <Box>
      <Text>
        {actions
          .map((action) => `[${action.charAt(0)}] ${labels[action] ?? action}`)
          .join('  ')}
      </Text>
    </Box>
  );
}
