import type { Card, Suit } from '@card-night/core';
import { suitOf, rankOf } from '@card-night/core';
import type { Theme } from './theme.js';

const CARD_HEIGHT = 5;
const CONTENT_WIDTH = 5; // 테두리 사이 내용 폭 (전체 카드 폭 7 - 좌우 테두리 2)
const OVERLAP_WIDTH = 2; // 겹친 손패에서, 마지막 카드가 아닌 카드가 보여주는 왼쪽 칸 수

interface CardGlyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
  back: string;
  suits: Record<Suit, string>;
  joker: string;
}

const UNICODE_GLYPHS: CardGlyphs = {
  tl: '┌',
  tr: '┐',
  bl: '└',
  br: '┘',
  h: '─',
  v: '│',
  back: '▒',
  suits: { S: '♠', H: '♥', D: '♦', C: '♣' },
  joker: '★',
};

const ASCII_GLYPHS: CardGlyphs = {
  tl: '+',
  tr: '+',
  bl: '+',
  br: '+',
  h: '-',
  v: '|',
  back: '#',
  suits: { S: 'S', H: 'H', D: 'D', C: 'C' },
  joker: '*',
};

function glyphsFor(theme: Theme): CardGlyphs {
  return theme.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;
}

/**
 * 조커 카드('JB' 검은 조커 / 'JR' 붉은 조커) 여부. rankOf()는 둘 다 'JOKER'를
 * 돌려줘 폭 7칸에 들어가지 않으므로, 원래 카드 코드('JB'/'JR') 자체를 표시 랭크로
 * 써서 두 조커가 서로 다르게 보이도록 한다 (원카드 규칙상 공격력·색 제약이 다르다).
 */
function isJoker(card: string): card is 'JB' | 'JR' {
  return card === 'JB' || card === 'JR';
}

function displayRank(card: Card): string {
  if (isJoker(card)) return card;
  return rankOf(card);
}

/** 내용 폭(5칸) 안에 문자 하나를 가운데 정렬한다. */
function centerOne(ch: string, width: number): string {
  const pad = width - 1;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return ' '.repeat(left) + ch + ' '.repeat(right);
}

/**
 * 카드 한 장을 7칸×5줄 문자열 배열로 렌더링한다. 색은 입히지 않는다(UI 레이어 몫).
 * 'back'이면 뒷면(theme.back으로 채운 3줄)을 그린다.
 */
export function renderCard(card: Card | 'back', theme: Theme): string[] {
  const g = glyphsFor(theme);
  const top = g.tl + g.h.repeat(CONTENT_WIDTH) + g.tr;
  const bottom = g.bl + g.h.repeat(CONTENT_WIDTH) + g.br;

  if (card === 'back') {
    const row = g.v + g.back.repeat(CONTENT_WIDTH) + g.v;
    return [top, row, row, row, bottom];
  }

  const rank = displayRank(card);
  const suit = suitOf(card);
  const middle = suit === null ? g.joker : g.suits[suit];

  const line1 = g.v + rank.padEnd(CONTENT_WIDTH, ' ') + g.v;
  const line2 = g.v + centerOne(middle, CONTENT_WIDTH) + g.v;
  const line3 = g.v + rank.padStart(CONTENT_WIDTH, ' ') + g.v;

  return [top, line1, line2, line3, bottom];
}

/**
 * 손패를 겹쳐서 렌더링한다: 마지막 카드만 온전히 보이고, 그 앞의 카드들은 왼쪽
 * 2칸만 보인다. n장의 전체 폭은 2(n-1)+7. 빈 손패(원카드 승리 등으로 발생 가능)는
 * 예외를 던지지 않고 5줄의 빈 문자열을 돌려준다 — 호출부가 "카드가 0장이면
 * 그릴 게 없다"는 뜻으로 바로 쓸 수 있게.
 */
export function renderHand(cards: (Card | 'back')[], theme: Theme): string[] {
  if (cards.length === 0) {
    return Array.from({ length: CARD_HEIGHT }, () => '');
  }

  const rendered = cards.map((c) => renderCard(c, theme));
  const lines = Array.from({ length: CARD_HEIGHT }, () => '');

  rendered.forEach((cardLines, i) => {
    const isLast = i === rendered.length - 1;
    cardLines.forEach((fullLine, row) => {
      const slice = isLast ? fullLine : [...fullLine].slice(0, OVERLAP_WIDTH).join('');
      lines[row] += slice;
    });
  });

  return lines;
}
