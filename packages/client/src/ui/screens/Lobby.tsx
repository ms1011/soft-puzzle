import React from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import type { GameId } from '@soft-puzzle/core';
import { GAME_INFO } from '../gameLabels.js';

export interface LobbyProps {
  host: string;
  players: string[];
  /** connection.nickname(서버가 정규화한 형태) — 결정 2: 절대 사용자가 타이핑한 원본 문자열이
   * 아니다. players/host도 전부 서버가 보낸 정규화된 형태라 이 값과만 정확히 비교된다. */
  you: string;
  /** 내가 호스트일 때만 App이 채워 넘긴다 — os.networkInterfaces()에서 뽑은 비내부 IPv4:포트. */
  hostAddr?: string;
  game?: GameId;
  onStart: () => void;
  onLeave: () => void;
}

/**
 * 로비 화면: 참가자 목록(호스트는 ★ 표시), 방장이면 [Enter] 시작 안내, 전원에게 "방장이
 * 나가면 방이 사라집니다" 문구, 호스트에게는 자신의 접속 주소.
 *
 * 방 이름·게임 타이틀은 여기서 그리지 않는다 — App의 공통 레이아웃(상단 테두리 바)이 이미
 * 그린다. 리뷰에서 지적된 이중 렌더(같은 문자열이 테두리 바 안과 밖에 두 번 나오는) 회귀다.
 */
export function Lobby({ host, players, you, hostAddr, game, onStart, onLeave }: LobbyProps): React.JSX.Element {
  const youAreHost = you === host;

  useScreenInput((input, key) => {
    if (youAreHost && key.return) onStart();
    if (input === 'q' || key.escape) onLeave();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {hostAddr !== undefined && <Text dimColor>내 접속 주소: {hostAddr}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {players.map((p) => (
          <Text key={p}>
            {p === host ? '★ ' : '  '}
            {p}
            {p === you ? ' (나)' : ''}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {game !== undefined && players.length < GAME_INFO[game].minPlayers
            ? `시작하려면 ${GAME_INFO[game].minPlayers - players.length}명이 더 필요합니다 · `
            : ''}
          방장이 나가면 방이 사라집니다
        </Text>
      </Box>
      {youAreHost && <Text>[Enter] 시작 · [q] 방 닫기</Text>}
      {!youAreHost && <Text dimColor>방장이 시작하기를 기다리는 중입니다... [q] 나가기</Text>}
    </Box>
  );
}
