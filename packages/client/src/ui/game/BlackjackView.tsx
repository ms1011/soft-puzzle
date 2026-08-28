import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { handValue } from '@card-night/core';
import type { Card } from '@card-night/core';
import { renderHand } from '../../art/cards.js';
import type { GameViewProps } from './types.js';

const MIN_BET = 10;
const BET_STEP = 10;

interface Seat {
  hand: Card[];
  chips: number;
  bet: number;
  spectating: boolean;
}

interface OtherSeat extends Seat {
  nickname: string;
  isTurn: boolean;
}

interface BlackjackGameView {
  phase: 'betting' | 'acting' | 'settle';
  yourActions: string[];
  you: Seat;
  others: OtherSeat[];
  dealer: { hand: Card[]; hiddenCount: number };
}

function fmtChips(n: number): string {
  return `칩 ${n.toLocaleString('ko-KR')}`;
}

/** dealer.hand(공개된 카드) 뒤에 hiddenCount만큼 'back'을 이어붙인 렌더용 배열. */
function dealerCards(dealer: { hand: Card[]; hiddenCount: number }): (Card | 'back')[] {
  return [...dealer.hand, ...Array(Math.max(0, dealer.hiddenCount)).fill('back' as const)];
}

/**
 * 한 명(딜러 포함)의 패 아트 + 라벨 한 줄을 그린다. hand가 비어 있으면(베팅 단계 등)
 * 아트를 아예 그리지 않는다 — renderHand가 예외 없이 빈 줄을 돌려주긴 하지만, 카드가
 * 없는데 빈 상자를 그리는 것은 시각적으로 의미가 없다.
 */
function SeatRows({
  label,
  cards,
  totalText,
  isYou,
  isTurn,
  theme,
}: {
  label: string;
  cards: (Card | 'back')[];
  totalText?: string;
  isYou: boolean;
  isTurn: boolean;
  theme: GameViewProps['theme'];
}): React.JSX.Element {
  const marker = theme.unicode ? '◀' : '<';
  const lines = renderHand(cards, theme);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold={isYou} color={isYou ? 'cyan' : undefined}>
        {isTurn ? `${marker} ` : '  '}
        {label}
        {totalText !== undefined ? ` ${totalText}` : ''}
      </Text>
      {cards.length > 0 &&
        lines.map((line, i) => (
          <Text key={i} bold={isYou} color={isYou ? 'cyan' : undefined}>
            {line}
          </Text>
        ))}
    </Box>
  );
}

/**
 * 블랙잭 게임 화면. 서버가 보낸 view.yourActions만이 어떤 키가 동작할지 결정한다 —
 * phase별로 무엇이 "규칙상 가능해 보이는지"를 이 화면이 스스로 판단하지 않는다.
 */
export function BlackjackView({ view, you, send, theme }: GameViewProps): React.JSX.Element {
  const v = view as unknown as BlackjackGameView;
  const actions = v.yourActions;
  const [betAmount, setBetAmount] = useState(MIN_BET);

  const canBet = actions.includes('bet');
  const maxBet = Math.max(MIN_BET, v.you.chips);
  const clampedBet = Math.min(Math.max(betAmount, MIN_BET), maxBet);

  useInput((input, key) => {
    if (canBet) {
      if (key.upArrow) {
        setBetAmount((a) => Math.min(maxBet, a + BET_STEP));
        return;
      }
      if (key.downArrow) {
        setBetAmount((a) => Math.max(MIN_BET, a - BET_STEP));
        return;
      }
      if (key.return) {
        send('bet', clampedBet);
        return;
      }
      return;
    }

    if (key.return && actions.includes('ready')) {
      send('ready');
      return;
    }
    if (input === 'e' && actions.includes('endGame')) {
      send('endGame');
      return;
    }
    if (input === 'h' && actions.includes('hit')) {
      send('hit');
      return;
    }
    if (input === 's' && actions.includes('stand')) {
      send('stand');
      return;
    }
    if (input === 'd' && actions.includes('double')) {
      send('double');
      return;
    }
  });

  const dealerHiddenAny = v.dealer.hiddenCount > 0;
  const dealerCardList = dealerCards(v.dealer);
  const dealerTotal = !dealerHiddenAny && v.dealer.hand.length > 0 ? handValue(v.dealer.hand).total : undefined;

  const rows: (OtherSeat & { nickname: string })[] = [
    { nickname: you, ...v.you, isTurn: v.phase === 'acting' && actions.includes('hit') },
    ...v.others,
  ];

  return (
    <Box flexDirection="column">
      <SeatRows
        label="딜러"
        cards={dealerCardList}
        totalText={dealerTotal !== undefined ? `(${dealerTotal})` : undefined}
        isYou={false}
        isTurn={false}
        theme={theme}
      />

      <Box flexDirection="column" marginTop={1}>
        {rows.map((seat) => {
          const isYou = seat.nickname === you;
          const total = seat.hand.length > 0 ? handValue(seat.hand).total : undefined;
          const parts = [fmtChips(seat.chips)];
          if (seat.bet > 0) parts.push(`베팅 ${seat.bet.toLocaleString('ko-KR')}`);
          if (seat.spectating) parts.push('(관전)');
          return (
            <SeatRows
              key={seat.nickname}
              label={`${seat.nickname}${isYou ? ' (나)' : ''} ${parts.join(' ')}`}
              cards={seat.hand}
              totalText={total !== undefined ? `(${total})` : undefined}
              isYou={isYou}
              isTurn={seat.isTurn}
              theme={theme}
            />
          );
        })}
      </Box>

      {canBet && (
        <Box marginTop={1}>
          <Text>
            베팅액: {clampedBet.toLocaleString('ko-KR')} (↑↓ 10단위 조절, Enter로 베팅, 최대{' '}
            {maxBet.toLocaleString('ko-KR')})
          </Text>
        </Box>
      )}
    </Box>
  );
}
