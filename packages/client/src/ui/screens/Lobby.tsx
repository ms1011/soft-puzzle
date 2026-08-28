import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { GameId } from '@card-night/core';
import { GAME_LABELS } from '../gameLabels.js';

export interface LobbyProps {
  roomName: string;
  game: GameId;
  host: string;
  players: string[];
  /** connection.nickname(서버가 정규화한 형태) — 결정 2: 절대 사용자가 타이핑한 원본 문자열이
   * 아니다. players/host도 전부 서버가 보낸 정규화된 형태라 이 값과만 정확히 비교된다. */
  you: string;
  /** 내가 호스트일 때만 App이 채워 넘긴다 — os.networkInterfaces()에서 뽑은 비내부 IPv4:포트. */
  hostAddr?: string;
  onStart: () => void;
}

/**
 * 로비 화면: 참가자 목록(호스트는 ★ 표시), 방장이면 [Enter] 시작 안내, 전원에게 "방장이
 * 나가면 방이 사라집니다" 문구, 호스트에게는 자신의 접속 주소.
 */
export function Lobby({ roomName, game, host, players, you, hostAddr, onStart }: LobbyProps): React.JSX.Element {
  const youAreHost = you === host;

  useInput((_input, key) => {
    if (youAreHost && key.return) onStart();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        {roomName} [{GAME_LABELS[game]}]
      </Text>
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
        <Text dimColor>방장이 나가면 방이 사라집니다</Text>
      </Box>
      {youAreHost && <Text>[Enter] 시작</Text>}
      {!youAreHost && <Text dimColor>방장이 시작하기를 기다리는 중입니다...</Text>}
    </Box>
  );
}
