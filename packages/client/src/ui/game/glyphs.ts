import type { Theme } from '../../art/theme.js';

/**
 * 게임 화면 공통 표시 기호. 게임마다 ◀/▶/>를 제각각 쓰던 것을 두 가지 뜻으로만 통일한다 —
 * "지금 이 사람 차례"는 TURN, "내가 고르고 있는 대상"은 CURSOR. ascii 테마(구형 콘솔)에는
 * 순수 ASCII만 쓴다.
 */
export function turnGlyph(theme: Theme): string {
  return theme.unicode ? '◀' : '<';
}

export function cursorGlyph(theme: Theme): string {
  return theme.unicode ? '▶' : '>';
}

/** 한 줄 안의 항목 구분자. 가운뎃점(·)은 ascii 테마에서 쓸 수 없다. */
export function sep(theme: Theme): string {
  return theme.unicode ? ' · ' : ' / ';
}
