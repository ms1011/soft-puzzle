import React from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import type { GameViewProps } from './types.js';

interface IndianView { yourActions: string[]; yourCard: string; isTurn: boolean; round: number; remainingCards: number; pot: number; scores: { nickname: string; score: number }[]; chips: { nickname: string; chips: number }[]; others: { nickname: string; card: string; folded: boolean; isTurn: boolean }[]; }

export function IndianPokerView({ view, send }: GameViewProps): React.JSX.Element {
  const v = view as unknown as IndianView;
  const canAct = v.yourActions.length > 0;
  useScreenInput((input, key) => { if (!canAct) return; if (key.return) send('call'); else if (input === 'f') send('fold'); });
  return <Box flexDirection="column" paddingX={1}>
    <Text bold>라운드 {v.round} · 팟 {v.pot}칩 · 남은 덱 {v.remainingCards}장</Text>
    <Text bold>내 카드: ?</Text><Text dimColor>내 카드는 볼 수 없고, 상대 카드만 보입니다.</Text>
    <Box flexDirection="column" marginTop={1}>{v.others.map((player) => <Text key={player.nickname}>{player.isTurn ? '> ' : '  '}{player.nickname}: {player.card}{player.folded ? ' (폴드)' : ''}</Text>)}</Box>
    <Text dimColor>보유 칩: {v.chips.map((player) => `${player.nickname} ${player.chips}`).join(' · ')}</Text>
    <Text dimColor>콜은 1칩을 더 걸고, 폴드는 이번 라운드 참가비 1칩만 잃습니다.</Text>
    <Text dimColor>{canAct ? 'Enter 콜 · f 폴드' : '상대의 선택을 기다리는 중입니다.'}</Text>
  </Box>;
}
