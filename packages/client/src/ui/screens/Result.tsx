import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface ResultProps {
  /** 서버가 이미 순위대로 정렬해 보낸다 — 이 화면은 받은 순서 그대로 그린다. */
  ranking: { nickname: string; detail: string }[];
  youAreHost: boolean;
  onReplay: () => void;
  onLeave: () => void;
}

/**
 * 결과 화면. 방장에게만 [r] 다시하기 / [q] 나가기가 있다 — 참가자는 대기 안내만 본다(브리프
 * 명세 그대로: 참가자에게는 별도 인터랙션이 없다. 전체 종료는 Ctrl+C로 가능하다).
 */
export function Result({ ranking, youAreHost, onReplay, onLeave }: ResultProps): React.JSX.Element {
  useInput((input) => {
    if (!youAreHost) return;
    if (input === 'r') onReplay();
    else if (input === 'q') onLeave();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>결과</Text>
      {ranking.map((entry, i) => (
        <Text key={entry.nickname}>
          {i + 1}위 {entry.nickname} — {entry.detail}
        </Text>
      ))}
      {youAreHost ? (
        <Text>[r] 다시하기 [q] 나가기</Text>
      ) : (
        <Text dimColor>방장이 다시 시작하기를 기다리는 중입니다...</Text>
      )}
    </Box>
  );
}
