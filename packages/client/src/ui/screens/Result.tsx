import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { GameId } from '@soft-puzzle/core';

export interface ResultProps {
  /** 서버가 이미 순위대로 정렬해 보낸다 — 이 화면은 받은 순서 그대로 그린다. */
  ranking: { nickname: string; detail: string }[];
  game?: GameId;
  youAreHost: boolean;
  onReplay: () => void;
  onLeave: () => void;
  /** 방장이 [l]을 누르면 room을 lobby phase로 되돌린다(중요사항 2 — 스펙 §7이 약속하는
   * "같은 닉네임으로 로비 복귀"의 유일한 진입점. Room.tryToLobby는 이미 구현·테스트돼 있었지만
   * 이 키를 달기 전에는 어떤 화면도 toLobby를 보내지 않아 도달 불가능했다). */
  onToLobby: () => void;
}

/**
 * 결과 화면. 방장은 다시하기와 로비 복귀를 결정하고, 모든 참가자는 q로 방을 나갈 수 있다.
 */
export function Result({
  ranking,
  game,
  youAreHost,
  onReplay,
  onLeave,
  onToLobby,
}: ResultProps): React.JSX.Element {
  useInput((input) => {
    if (input === 'q') onLeave();
    else if (youAreHost && input === 'r') onReplay();
    else if (youAreHost && input === 'l') onToLobby();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="double" borderColor="yellow" paddingX={2} marginBottom={1}>
        <Box flexDirection="column" alignItems="center">
          <Text bold color="yellow">
            ★ 게임 종료 ★
          </Text>
          <Text bold>최종 결과</Text>
        </Box>
      </Box>
      {ranking.map((entry, i) => (
        <Text key={entry.nickname}>
          {game === 'liar' ? '• ' : `${i + 1}위 `}{entry.nickname} — {entry.detail}
        </Text>
      ))}
      {youAreHost ? (
        <Text>[r] 다시하기 [l] 로비로 [q] 나가기</Text>
      ) : (
        <Text dimColor>방장이 다음 게임을 선택하기를 기다리는 중입니다... [q] 나가기</Text>
      )}
    </Box>
  );
}
