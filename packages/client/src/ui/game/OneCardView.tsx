import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Card, Suit } from '@card-night/core';
import { canPlay, rankOf } from '@card-night/core';
import { renderCard, renderHand } from '../../art/cards.js';
import type { GameViewProps } from './types.js';

/** cards.ts의 카드 아트 상수(테두리 사이 5칸 + 좌우 테두리 2칸)를 그대로 따른다 — 겹친 손패에서
 * 카드 한 장을 한 줄 들어 올려 강조하려면 renderHand가 감춘 개별 카드 폭을 직접 알아야 한다. */
const CARD_HEIGHT = 5;
const CARD_WIDTH = 7;
const OVERLAP_WIDTH = 2;

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const SUIT_GLYPH: Record<Suit, { unicode: string; ascii: string }> = {
  S: { unicode: '♠', ascii: 'S' },
  H: { unicode: '♥', ascii: 'H' },
  D: { unicode: '♦', ascii: 'D' },
  C: { unicode: '♣', ascii: 'C' },
};

function suitGlyph(s: Suit, unicode: boolean): string {
  return unicode ? SUIT_GLYPH[s].unicode : SUIT_GLYPH[s].ascii;
}

interface OtherPlayer {
  nickname: string;
  handCount: number;
  isTurn: boolean;
}

interface OneCardGameView {
  phase: 'playing' | 'result';
  yourActions: string[];
  you: { hand: Card[]; handCount: number; isTurn: boolean };
  others: OtherPlayer[];
  top: Card;
  declaredSuit: Suit | null;
  attackStack: number;
  direction: 1 | -1;
}

/**
 * 손패를 겹쳐 그리되, selectedIndex의 카드만 한 줄 위로 들어 올려 강조한다. renderHand는
 * 이런 "한 장만 다른 높이"를 표현할 수 없어(카드마다 완전히 같은 5줄 밴드를 가정) 여기서
 * renderCard를 카드별로 다시 합성한다. 전체 격자는 6줄(카드 5줄 + 들어 올린 만큼의 여유
 * 1줄) — 선택된 카드는 0~4행, 나머지는 1~5행을 차지해 상대적으로 한 칸 위에 떠 보인다.
 *
 * 마지막 카드뿐 아니라 선택된 카드도 항상 온전한 폭(7칸)으로 그린다 — 그렇지 않으면
 * 손패 중간에 있는 카드를 선택했을 때 왼쪽 2칸만 보이는 겹침 규칙에 가려 "무엇을
 * 골랐는지" 거의 안 보이는 상태가 된다. 강조가 곧 이 함수의 목적이므로 선택 카드는
 * 예외로 둔다.
 */
function renderLiftedHand(cards: Card[], selectedIndex: number, theme: GameViewProps['theme']): string[] {
  const rows: string[] = Array.from({ length: CARD_HEIGHT + 1 }, () => '');
  cards.forEach((card, i) => {
    const isLast = i === cards.length - 1;
    const isSelected = i === selectedIndex;
    const full = isLast || isSelected;
    const width = full ? CARD_WIDTH : OVERLAP_WIDTH;
    const lines = renderCard(card, theme);
    const sliceLine = (line: string): string => (full ? line : [...line].slice(0, OVERLAP_WIDTH).join(''));
    const offset = isSelected ? 0 : 1;
    for (let r = 0; r < rows.length; r++) {
      const cardRow = r - offset;
      rows[r] += cardRow >= 0 && cardRow < CARD_HEIGHT ? sliceLine(lines[cardRow]) : ' '.repeat(width);
    }
  });
  return rows;
}

/**
 * 원카드 게임 화면. 서버는 상대의 손패 내용을 절대 보내지 않는다(handCount만) — 그러니
 * 여기서도 상대 카드는 뒷면 장수로만 그린다. canPlay는 어디까지나 "낼 수 없어 보이는 카드를
 * 미리 알려주는" 클라이언트 힌트일 뿐이다: 서버가 최종 판정을 내리고, 이 화면은 그 힌트로
 * Enter를 미리 무시할 뿐 규칙을 스스로 강제하지 않는다.
 */
export function OneCardView({ view, you, send, theme }: GameViewProps): React.JSX.Element {
  const v = view as unknown as OneCardGameView;
  const actions = v.yourActions;
  const hand = v.you.hand;

  const [cursor, setCursor] = useState(0);
  const [suitPrompt, setSuitPrompt] = useState<{ card: Card } | null>(null);
  const [suitCursor, setSuitCursor] = useState(0);

  const canAct = actions.length > 0;
  const canPlayAction = actions.includes('play');
  const canDraw = actions.includes('draw');

  // 턴이 넘어가거나 손패가 바뀌면(내가 카드를 냈다/뽑았다) 옛 커서·팝업 상태가 새 손패
  // 범위 밖을 가리키며 남아있지 않도록 정리한다.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, hand.length - 1)));
    if (!canAct) setSuitPrompt(null);
  }, [hand.length, canAct]);

  useInput((input, key) => {
    if (!canAct) return;

    if (suitPrompt) {
      if (key.leftArrow) {
        setSuitCursor((i) => (i + SUITS.length - 1) % SUITS.length);
      } else if (key.rightArrow) {
        setSuitCursor((i) => (i + 1) % SUITS.length);
      } else if (key.return) {
        if (canPlayAction) {
          send('play', { card: suitPrompt.card, declareSuit: SUITS[suitCursor] });
        }
        setSuitPrompt(null);
      } else if (key.escape) {
        setSuitPrompt(null);
      }
      return;
    }

    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(Math.max(0, hand.length - 1), c + 1));
      return;
    }
    if (key.return) {
      const card = hand[cursor];
      if (!canPlayAction || card === undefined) return;
      if (!canPlay(card, v.top, v.declaredSuit, v.attackStack)) return;
      if (rankOf(card) === '7') {
        setSuitCursor(0);
        setSuitPrompt({ card });
      } else {
        send('play', { card });
      }
      return;
    }
    if (input === 'd' && canDraw) {
      send('draw');
    }
  });

  const attackGlyph = theme.unicode ? '⚡' : '!';
  const dirGlyph = theme.unicode
    ? v.direction === 1
      ? '↻'
      : '↺'
    : v.direction === 1
      ? '(->)'
      : '(<-)';

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          방향 {dirGlyph}
          {v.declaredSuit !== null && `  무늬: ${suitGlyph(v.declaredSuit, theme.unicode)}`}
          {v.attackStack > 0 && `  ${attackGlyph}+${v.attackStack}`}
        </Text>
        {renderCard(v.top, theme).map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {v.others.map((o) => (
          <Text key={o.nickname}>
            {o.isTurn ? (theme.unicode ? '◀ ' : '< ') : '  '}
            {o.nickname} - {o.handCount}장
          </Text>
        ))}
      </Box>

      <Box flexDirection="column">
        <Text bold>
          {you} (나){v.you.isTurn ? (theme.unicode ? ' ◀' : ' <') : ''}
        </Text>
        {hand.length === 0 ? (
          <Text dimColor>(손패 없음)</Text>
        ) : (
          renderLiftedHand(hand, cursor, theme).map((line, i) => <Text key={i}>{line}</Text>)
        )}
      </Box>

      {suitPrompt !== null && (
        <Box marginTop={1}>
          <Text>
            무늬 선택: {SUITS.map((s, i) => (i === suitCursor ? `[${suitGlyph(s, theme.unicode)}]` : ` ${suitGlyph(s, theme.unicode)} `)).join(' ')}
            {'  '}({theme.unicode ? '←→' : '좌/우'} 이동, Enter 확정)
          </Text>
        </Box>
      )}
    </Box>
  );
}
