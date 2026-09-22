import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import type { GameViewProps } from './types.js';

interface LiarViewState { yourActions: string[]; yourWord: string; players: string[]; hasVoted: boolean; }

export function LiarView({ view, you, send }: GameViewProps): React.JSX.Element {
  const v = view as unknown as LiarViewState;
  const targets = v.players.filter((player) => player !== you);
  const [cursor, setCursor] = useState(0);
  const canVote = v.yourActions.includes('vote');
  useEffect(() => setCursor((current) => Math.min(current, Math.max(0, targets.length - 1))), [targets.length]);
  useScreenInput((_input, key) => {
    if (!canVote) return;
    if (key.upArrow) setCursor((current) => (current - 1 + targets.length) % targets.length);
    else if (key.downArrow) setCursor((current) => (current + 1) % targets.length);
    else if (key.return && targets[cursor] !== undefined) send('vote', targets[cursor]);
  });
  return <Box flexDirection="column" paddingX={1}>
    <Text bold>내 제시어: {v.yourWord}</Text>
    <Text dimColor>서로 대화한 뒤 라이어라고 생각하는 사람에게 투표하세요.</Text>
    <Box flexDirection="column" marginTop={1}>{targets.map((player, index) => <Text key={player} inverse={canVote && index === cursor}>{index === cursor && canVote ? '> ' : '  '}{player}</Text>)}</Box>
    <Text dimColor>{canVote ? '↑↓ 선택 · Enter 투표' : v.hasVoted ? '투표 완료. 다른 참가자를 기다리는 중입니다.' : '다른 참가자를 기다리는 중입니다.'}</Text>
  </Box>;
}
