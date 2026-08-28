/**
 * 문자열의 터미널 표시 폭(칼럼 수)을 계산한다.
 *
 * 대부분의 문자(ASCII, 박스 드로잉 문자, 카드 무늬 기호 등)는 터미널에서 1칼럼을
 * 차지하지만, 한글 음절·자모와 CJK 표의문자, 전각(fullwidth) 문자는 2칼럼을
 * 차지한다(East Asian Wide). 코드포인트 개수(`[...str].length`)만으로 폭을 재면
 * 한글이 섞인 문자열의 패딩 계산이 항상 부족해진다 — 예: `[잡음]`은 코드포인트
 * 4개지만 실제로는 6칼럼이다.
 *
 * Task 12 이후 한글 닉네임을 고정폭 칼럼에 넣을 일이 많아 이 계산을 여기 한
 * 곳에 모아 공유한다.
 */

// [시작, 끝] 코드포인트 범위(포함). 이 프로젝트가 실제로 다루는 폭 문자만 다룬다:
// 한글 자모, 한글 음절, CJK 통합 표의문자(및 확장 A, 호환 영역), 전각 형식.
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff], // 한글 자모(Hangul Jamo)
  [0x3400, 0x4dbf], // CJK 통합 표의문자 확장 A
  [0x4e00, 0x9fff], // CJK 통합 표의문자(CJK Unified Ideographs)
  [0xac00, 0xd7a3], // 한글 음절(Hangul Syllables)
  [0xf900, 0xfaff], // CJK 호환 표의문자(CJK Compatibility Ideographs)
  [0xff00, 0xff60], // 전각 형식(Fullwidth Forms) — 예: ａ-ｚ, ！-～
  [0xffe0, 0xffe6], // 전각 기호(Fullwidth Signs)
];

function isWide(codePoint: number): boolean {
  return WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** 문자열이 터미널에서 차지할 칼럼 수. 서로게이트 쌍을 code point 단위로 올바르게 순회한다. */
export function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const codePoint = ch.codePointAt(0) ?? 0;
    width += isWide(codePoint) ? 2 : 1;
  }
  return width;
}
