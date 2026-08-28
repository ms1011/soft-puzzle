import React from 'react';
import { Box, Text } from 'ink';
import { ACTION_KEYS } from '../gameLabels.js';

export interface ActionBarProps {
  /** 지금 이 순간 서버가 허용하는 액션 이름 목록 — 보통 GameView.yourActions를 그대로 넘긴다. */
  actions: string[];
  /** 액션 이름 → 한국어 표시 라벨. 매핑이 없는 액션은 이름 자체를 라벨로 쓴다. */
  labels: Record<string, string>;
  /** 액션 이름 → 그 액션을 실제로 보내는 키 표시. 기본값은 세 게임 화면이 실제로 바인딩한
   * 키 전체를 담은 ACTION_KEYS다 — App.tsx는 이 prop을 넘기지 않고 호출하므로(계약 고정),
   * 여기서 직접 기본값을 잡아야 실제 화면에도 반영된다. 매핑이 없는 액션은 여전히 이름의
   * 첫 글자로 폴백한다. */
  keys?: Record<string, string>;
}

/**
 * 하단 키 안내 바. actions에 있는 것만, 그 순서 그대로 표시한다 — 서버가 지금 허용하지 않는
 * 액션은 절대 보여주지 않는다(브리프 요구사항 4: "행동 바는 yourActions에서만, 하드코딩된
 * 목록에서가 아니라"). 키 힌트는 ACTION_KEYS에서 그 액션의 실제 키를 찾고, 없으면 액션
 * 이름의 첫 글자로 폴백한다 — 예: 'bet' → [Enter](ACTION_KEYS), 매핑에 없는 액션은
 * 여전히 첫 글자([b] 등)로 대체된다.
 *
 * 리뷰 지적(브리프 §3): 예전에는 항상 `action.charAt(0)`만 썼는데, 이는 이름과 실제 키가
 * 우연히 같은 액션에서만 맞았다 — 'bet'의 실제 키는 Enter인데 바는 [b]를 보여줬고,
 * 'ready'는 Enter인데 [r]을, 'toggleHold'는 1~5인데 [t]를, 'score'는 c인데 [s]를
 * 보여줬다. 화면이 실제로 반응하지 않는 키를 안내하면 플레이어는 들어갈 방법이 없다.
 */
export function ActionBar({ actions, labels, keys = ACTION_KEYS }: ActionBarProps): React.JSX.Element {
  if (actions.length === 0) {
    return <Text dimColor>(지금은 할 수 있는 행동이 없습니다)</Text>;
  }

  return (
    <Box>
      <Text>
        {actions
          .map((action) => `[${keys[action] ?? action.charAt(0)}] ${labels[action] ?? action}`)
          .join('  ')}
      </Text>
    </Box>
  );
}
