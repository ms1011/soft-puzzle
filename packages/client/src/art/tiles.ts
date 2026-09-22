import type { Theme } from './theme.js';

/** 다빈치 코드 타일 한 장의 상태. hidden=남이 모르는 타일(내 눈에도 숫자 없음), mine=나만 아는
 * 내 타일(남에게는 숨김), revealed=모두에게 공개된 타일. */
export type TileKind = 'hidden' | 'mine' | 'revealed';

export const TILE_WIDTH = 4;
export const TILE_HEIGHT = 3;

interface TileGlyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
  back: string;
}

// 공개된 타일은 이중선 — 야추에서 "홀드된 주사위"를 이중선으로 구분한 것과 같은 규칙이다.
const UNICODE_NORMAL: TileGlyphs = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', back: '▒' };
const UNICODE_REVEALED: TileGlyphs = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', back: '▒' };
// ascii는 구형 콘솔용 — 이중선이 없으니 공개 타일은 테두리 전체를 #으로 그린다(ascii 홀드 주사위와 같다).
const ASCII_NORMAL: TileGlyphs = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', back: '?' };
const ASCII_REVEALED: TileGlyphs = { tl: '#', tr: '#', bl: '#', br: '#', h: '#', v: '#', back: '?' };

function glyphsFor(kind: TileKind, theme: Theme): TileGlyphs {
  if (theme.unicode) return kind === 'revealed' ? UNICODE_REVEALED : UNICODE_NORMAL;
  return kind === 'revealed' ? ASCII_REVEALED : ASCII_NORMAL;
}

/**
 * 타일 한 장을 4칸×3줄로 그린다. 숫자(0~11)는 오른쪽 정렬 2칸. value가 null이면(남의 숨김
 * 타일) 뒷면 무늬로 채운다.
 */
export function renderTile(value: number | null, kind: TileKind, theme: Theme): string[] {
  const g = glyphsFor(kind, theme);
  const inner = value === null ? g.back.repeat(TILE_WIDTH - 2) : String(value).padStart(TILE_WIDTH - 2, ' ');
  return [g.tl + g.h.repeat(TILE_WIDTH - 2) + g.tr, g.v + inner + g.v, g.bl + g.h.repeat(TILE_WIDTH - 2) + g.br];
}
