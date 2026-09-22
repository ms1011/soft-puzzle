import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import { handValue } from '@soft-puzzle/core';
import type { Card } from '@soft-puzzle/core';
import { renderHand } from '../../art/cards.js';
import type { GameViewProps } from './types.js';

const MIN_BET = 10;
const BET_STEP = 10;
const BET_COARSE_STEP = 100;

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

/**
 * dealer.hand(공개된 카드) 앞에 hiddenCount만큼 'back'을 붙인 렌더용 배열. renderHand는
 * 배열의 마지막 카드만 온전히(폭 7) 그리고 나머지는 왼쪽 2칸만 보여준다 — 뒷면을 뒤에
 * 두면 정작 알아야 할 공개 카드가 잘려 보이는 반전이 생기므로, 뒷면을 앞에 둬서 항상
 * 실제로 공개된 카드(있다면)가 마지막 자리에서 온전히 보이게 한다.
 */
function dealerCards(dealer: { hand: Card[]; hiddenCount: number }): (Card | 'back')[] {
  return [...Array(Math.max(0, dealer.hiddenCount)).fill('back' as const), ...dealer.hand];
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
  // 리뷰 지적: chips를 그대로 상한으로 쓰면 안 된다 — 자연 블랙잭 배당(bet + round(bet*1.5))처럼
  // 10의 배수가 아닌 칩 액수가 실제로 나온다(예: 10칩 베팅 후 자연 블랙잭 승리 → 1,015칩).
  // 엔진 doBet은 `arg % 10 !== 0`이면 조용히 거부하므로, chips를 그대로 최대값으로 보여주고
  // Enter를 누르면 서버가 무시해 화면이 멈춘 것처럼 보인다 — 10의 배수로 내림한다. 스펙터가
  // 아닌 한 chips는 항상 >= MIN_BET이 보장되므로(엔진의 spectating 판정) 별도 하한 보정은
  // 필요 없다.
  const maxBet = Math.floor(v.you.chips / BET_STEP) * BET_STEP;
  const clampedBet = Math.min(Math.max(betAmount, MIN_BET), maxBet);

  useScreenInput((input, key) => {
    if (canBet) {
      if (key.upArrow) {
        setBetAmount((a) => Math.min(maxBet, a + BET_STEP));
        return;
      }
      if (key.downArrow) {
        setBetAmount((a) => Math.max(MIN_BET, a - BET_STEP));
        return;
      }
      // 굵은 단위 조절 — 1,000칩을 10단위로만 조절하면 500 베팅에 49번 키를 눌러야 한다.
      if (key.rightArrow) {
        setBetAmount((a) => Math.min(maxBet, a + BET_COARSE_STEP));
        return;
      }
      if (key.leftArrow) {
        setBetAmount((a) => Math.max(MIN_BET, a - BET_COARSE_STEP));
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
            베팅액: {clampedBet.toLocaleString('ko-KR')} ({theme.unicode ? '↑↓' : '위/아래'} 10단위,{' '}
            {theme.unicode ? '←→' : '좌/우'} 100단위 조절, Enter로 베팅, 최대{' '}
            {maxBet.toLocaleString('ko-KR')})
          </Text>
        </Box>
      )}

      {/* ActionBar가 액션마다 한 칸씩 [키] 힌트를 보여주지만, 여기서 한 줄로 다시 짚어준다
       * — betting의 베팅 컨트롤 힌트와 같은 패턴이다. yourActions에 실제로 있는 것만
       * 보여준다(요구사항 1). */}
      {v.phase === 'acting' && (
        <Box marginTop={1}>
          <Text dimColor>
            {[
              actions.includes('hit') && 'h 히트',
              actions.includes('stand') && 's 스탠드',
              actions.includes('double') && 'd 더블다운',
            ]
              .filter((s): s is string => typeof s === 'string')
              .join('  ')}
          </Text>
        </Box>
      )}

      {v.phase === 'settle' && (actions.includes('ready') || actions.includes('endGame')) && (
        <Box marginTop={1}>
          <Text dimColor>
            {[
              actions.includes('ready') && 'Enter 다음 판',
              actions.includes('endGame') && 'e 게임 종료',
            ]
              .filter((s): s is string => typeof s === 'string')
              .join('  ')}
          </Text>
        </Box>
      )}
    </Box>
  );
}
