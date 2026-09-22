import React from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import type { Card } from '@soft-puzzle/core';
import { renderHandSegments } from '../../art/cards.js';
import { truncateDisplay } from '../../art/width.js';
import { CardRows } from './CardRows.js';
import { sep, turnGlyph } from './glyphs.js';
import type { GameViewProps } from './types.js';

interface IndianView {
  yourActions: string[];
  yourCard: string;
  isTurn: boolean;
  round: number;
  remainingCards: number;
  pot: number;
  scores: { nickname: string; score: number }[];
  chips: { nickname: string; chips: number }[];
  others: { nickname: string; card: Card; folded: boolean; isTurn: boolean }[];
}

/** 좌석 한 칸 폭 — 6인이면 78칼럼으로 80칼럼 터미널에 한 줄로 들어간다. */
const SEAT_WIDTH = 13;
/** 좌석 닉네임 표시 폭 상한(차례 표시 2칸을 뺀 나머지). */
const SEAT_NICK_CAP = SEAT_WIDTH - 3;

interface SeatProps {
  label: string;
  card: Card | 'back';
  chips: number;
  wins: number;
  isYou: boolean;
  isTurn: boolean;
  folded: boolean;
  theme: GameViewProps['theme'];
}

/** 좌석 하나: 닉네임(차례 표시) · 카드 아트 · 칩과 승수 · 폴드 여부. 폴드한 좌석은 통째로 흐리게 그린다. */
function Seat({ label, card, chips, wins, isYou, isTurn, folded, theme }: SeatProps): React.JSX.Element {
  const rows = renderHandSegments([card], theme).map((row) => row.map((seg) => ({ ...seg, dim: folded })));
  return (
    <Box flexDirection="column" width={SEAT_WIDTH}>
      <Text bold={isYou || isTurn} color={isYou ? 'cyan' : undefined} dimColor={folded} wrap="truncate-end">
        {isTurn ? `${turnGlyph(theme)} ` : '  '}
        {truncateDisplay(label, SEAT_NICK_CAP)}
      </Text>
      <CardRows rows={rows} color={isYou ? 'cyan' : undefined} />
      <Text dimColor wrap="truncate-end">
        칩 {chips}{sep(theme)}{wins}승
      </Text>
      <Text color={folded ? 'gray' : undefined}>{folded ? '폴드' : ' '}</Text>
    </Box>
  );
}

export function IndianPokerView({ view, you, send, theme }: GameViewProps): React.JSX.Element {
  const v = view as unknown as IndianView;
  const canAct = v.yourActions.length > 0;
  useScreenInput((input, key) => {
    if (!canAct) return;
    if (key.return) send('call');
    else if (input === 'f') send('fold');
  });

  const chipsOf = (nickname: string): number => v.chips.find((p) => p.nickname === nickname)?.chips ?? 0;
  const winsOf = (nickname: string): number => v.scores.find((p) => p.nickname === nickname)?.score ?? 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        라운드 {v.round}
        {sep(theme)}팟 <Text color="yellow">{v.pot}칩</Text>
        {sep(theme)}남은 덱 {v.remainingCards}장
      </Text>
      <Box flexDirection="row" marginTop={1}>
        {/* 내 카드는 끝까지 뒷면이다 — 서버도 yourCard를 '?'로만 보낸다. */}
        <Seat label={`${you} (나)`} card="back" chips={chipsOf(you)} wins={winsOf(you)} isYou isTurn={v.isTurn} folded={false} theme={theme} />
        {v.others.map((player) => (
          <Seat
            key={player.nickname}
            label={player.nickname}
            card={player.card}
            chips={chipsOf(player.nickname)}
            wins={winsOf(player.nickname)}
            isYou={false}
            isTurn={player.isTurn}
            folded={player.folded}
            theme={theme}
          />
        ))}
      </Box>
      <Text dimColor>내 카드는 볼 수 없고, 상대 카드만 보입니다.</Text>
      <Text dimColor>콜은 1칩을 더 걸고, 폴드는 이번 라운드 참가비 1칩만 잃습니다.</Text>
      <Text dimColor>{canAct ? `Enter 콜${sep(theme)}f 폴드` : '상대의 선택을 기다리는 중입니다.'}</Text>
    </Box>
  );
}
