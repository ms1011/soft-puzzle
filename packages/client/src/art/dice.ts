import type { Theme } from './theme.js';
import { displayWidth } from './width.js';

type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

const CONTENT_WIDTH = 7; // 테두리 사이 내용 폭 (전체 주사위 폭 9 - 좌우 테두리 2)
const DIE_WIDTH = CONTENT_WIDTH + 2; // 9
const DIE_HEIGHT = 5;
// 내용 폭 7칸 안에서 눈이 놓일 수 있는 세 개의 열 위치(좌/중/우). 세로 칸이
// 가로 칸의 약 2배 높이인 터미널에서, 9×5가 "시각적으로 정사각형"으로 읽히도록
// 고른 폭이다(브리프 §요구사항).
const PIP_COLS = [1, 3, 5] as const;

// 표준 주사위 눈 배치: 1=중앙, 2=대각선, 3=대각선+중앙, 4=네 모서리,
// 5=네 모서리+중앙, 6=좌우 두 열(각 3개). grid[row][col] — row 0~2가 내용의
// 3줄(위/중/아래), col 0~2가 PIP_COLS의 좌/중/우에 대응한다.
const PIP_GRIDS: Record<DieValue, readonly (readonly boolean[])[]> = {
  1: [
    [false, false, false],
    [false, true, false],
    [false, false, false],
  ],
  2: [
    [true, false, false],
    [false, false, false],
    [false, false, true],
  ],
  3: [
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ],
  4: [
    [true, false, true],
    [false, false, false],
    [true, false, true],
  ],
  5: [
    [true, false, true],
    [false, true, false],
    [true, false, true],
  ],
  6: [
    [true, false, true],
    [true, false, true],
    [true, false, true],
  ],
};

interface DieGlyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
  pip: string;
}

// 유니코드: 일반 주사위는 단일선, 홀드된 주사위는 이중선(╔═╗║╚╝) — 사용자가
// 별도로 요청한 "홀드는 눈에 띄게" 요구사항.
const UNICODE_UNHELD: DieGlyphs = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', pip: '●' };
const UNICODE_HELD: DieGlyphs = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', pip: '●' };
// ascii: 구형 콘솔에는 이중선 문자가 없으므로 홀드는 전체를 #으로 그려 구분한다.
const ASCII_UNHELD: DieGlyphs = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', pip: 'o' };
const ASCII_HELD: DieGlyphs = { tl: '#', tr: '#', bl: '#', br: '#', h: '#', v: '#', pip: 'o' };

function glyphsFor(theme: Theme, held: boolean): DieGlyphs {
  if (theme.unicode) return held ? UNICODE_HELD : UNICODE_UNHELD;
  return held ? ASCII_HELD : ASCII_UNHELD;
}

function pipRowString(row: readonly boolean[], pip: string): string {
  const chars = new Array(CONTENT_WIDTH).fill(' ');
  row.forEach((on, col) => {
    if (on) chars[PIP_COLS[col]] = pip;
  });
  return chars.join('');
}

/** 주사위 하나를 9칸×5줄 문자열 배열로 렌더링한다. held면 이중선(또는 ascii에서는 #) 테두리. */
export function renderDie(value: DieValue, held: boolean, theme: Theme): string[] {
  const g = glyphsFor(theme, held);
  const top = g.tl + g.h.repeat(CONTENT_WIDTH) + g.tr;
  const bottom = g.bl + g.h.repeat(CONTENT_WIDTH) + g.br;
  const grid = PIP_GRIDS[value];
  const contentRows = grid.map((row) => g.v + pipRowString(row, g.pip) + g.v);

  return [top, contentRows[0], contentRows[1], contentRows[2], bottom];
}

// 표시 폭(칼럼) 기준으로 가운데 정렬한다. 코드포인트 개수로 재면 한글이 섞인
// 라벨('[잡음]')의 패딩이 실제 칼럼 수보다 부족해져 뒤따르는 주사위 라벨이
// 오른쪽으로 밀린다 — displayWidth()가 한글 음절을 2칼럼으로 센다.
function centerLabel(str: string, width: number): string {
  const w = displayWidth(str);
  const pad = Math.max(0, width - w);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
}

const HELD_LABEL_UNICODE = '[잡음]';
// ascii 테마는 구형 콘솔(conhost) 대상이므로 라벨도 순수 ASCII여야 한다 — 한글을
// 그대로 쓰면 renderCard/renderDie와 달리 renderDice만 ascii 순수성이 깨진다.
const HELD_LABEL_ASCII = '[HELD]';

/**
 * 주사위 여러 개를 가로로 나란히(칸 사이 공백 1칸) 그리고, 그 아래 한 줄에
 * 라벨을 붙인다: 홀드되지 않은 주사위는 면 값 숫자, 홀드된 주사위는 '[잡음]'
 * (ascii 테마에서는 '[HELD]'). 반환은 항상 6줄(주사위 아트 5줄 + 라벨 1줄).
 * 빈 배열이면 예외 없이 6줄의 빈 문자열을 돌려준다.
 */
export function renderDice(values: number[], held: boolean[], theme: Theme): string[] {
  if (values.length === 0) {
    return Array.from({ length: DIE_HEIGHT + 1 }, () => '');
  }

  const dice = values.map((v, i) => renderDie(v as DieValue, held[i] ?? false, theme));
  const lines: string[] = [];
  for (let row = 0; row < DIE_HEIGHT; row++) {
    lines.push(dice.map((d) => d[row]).join(' '));
  }

  const heldLabel = theme.unicode ? HELD_LABEL_UNICODE : HELD_LABEL_ASCII;
  const labels = values.map((v, i) => (held[i] ? heldLabel : String(v)));
  lines.push(labels.map((l) => centerLabel(l, DIE_WIDTH)).join(' '));

  return lines;
}
