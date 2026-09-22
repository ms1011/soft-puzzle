import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import { truncateDisplay } from '../../art/width.js';
import { cursorGlyph, sep, turnGlyph } from './glyphs.js';
import { useFocusBroadcast } from '../focus.js';
import type { GameViewProps } from './types.js';

interface YutPieceView {
  state: 'home' | 'board' | 'done';
  station?: number;
}

interface YutPlayerView {
  nickname: string;
  marker: string;
  pieces: YutPieceView[];
  finished: number;
  home: number;
  isTurn: boolean;
}

interface YutMoveView {
  throwIndex: number;
  piece: number;
  to: number | 'done';
  stack: number;
  capture: number;
  /** 이번 이동에서 밟는 칸(도착 칸 포함). 이 필드가 없던 옛 서버와 붙으면 undefined다. */
  path?: number[];
}

interface YutGameView {
  phase: 'throw' | 'move';
  yourActions: string[];
  turnPlayer: string | null;
  throws: { name: string; steps: number }[];
  throwsLeft: number;
  players: YutPlayerView[];
  lastThrow: { player: string; name: string; steps: number; sticks: boolean[] } | null;
  moves: YutMoveView[];
}

/** 플레이어 기호(A~F)별 색. 기호는 엔진이 시작 순서로 고정해 준다. */
const MARKER_COLORS: Record<string, string> = {
  A: 'red',
  B: 'cyan',
  C: 'yellow',
  D: 'green',
  E: 'magenta',
  F: 'blue',
};

const NICK_CAP = 8;

/**
 * 윷판 29칸의 화면 좌표 [줄, 칸 가운데 칼럼]. 판은 11줄 × 53칼럼이고 각 칸은 3칼럼을 쓴다.
 * 참먹이(0)가 오른쪽 아래, 반시계 방향으로 오른쪽 변을 올라가 모(5)=오른쪽 위, 뒷모(10)=왼쪽 위,
 * 찌모(15)=왼쪽 아래. 대각선 20·21 → 방(22) → 23·24는 5에서 15로, 25·26 → 방 → 27·28은
 * 10에서 0으로 이어진다(엔진 yut.ts의 칸 번호와 같다).
 */
const STATION_POS: ReadonlyArray<readonly [number, number]> = [
  [10, 51], [8, 51], [6, 51], [4, 51], [2, 51], [0, 51], // 0..5
  [0, 41], [0, 31], [0, 21], [0, 11], [0, 1], // 6..10
  [2, 1], [4, 1], [6, 1], [8, 1], [10, 1], // 11..15
  [10, 11], [10, 21], [10, 31], [10, 41], // 16..19
  [2, 41], [3, 36], [5, 26], [7, 16], [8, 11], // 20..24
  [2, 11], [3, 16], [7, 36], [8, 41], // 25..28
];
const BOARD_ROWS = 11;
const BOARD_COLS = 53;
const BIG_STATIONS = new Set([0, 5, 10, 15, 22]);
/** 이름이 있는 칸 — 도착 안내에 쓴다. 나머지 칸은 판의 * 표시로 가리킨다. */
const STATION_NAMES: Record<number, string> = { 0: '참먹이', 5: '모', 10: '뒷모', 15: '찌모', 22: '방' };
/** 이 결과가 나오면 한 번 더 던진다. */
const BONUS_THROWS = new Set(['윷', '모']);

/**
 * 윷가락 4개를 3줄 아트로 그린다. 배(평평한 면)가 위면 빈 가락, 등(둥근 면)이 위면 채운 가락이다.
 * 빽도 표시(x)는 0번 가락의 배에 그려져 있어, 0번 가락이 배를 보일 때만 보인다.
 */
export function renderSticks(sticks: boolean[], theme: GameViewProps['theme']): string[] {
  const [tl, tr, bl, br, h, v] = theme.unicode ? ['╭', '╮', '╰', '╯', '─', '│'] : ['+', '+', '+', '+', '-', '|'];
  const fill = theme.unicode ? '█' : '#';
  const top = sticks.map(() => `${tl}${h}${tr}`).join(' ');
  const mid = sticks.map((flat, i) => `${v}${flat ? (i === 0 ? 'x' : ' ') : fill}${v}`).join(' ');
  const bottom = sticks.map(() => `${bl}${h}${br}`).join(' ');
  return [top, mid, bottom];
}

interface Seg {
  text: string;
  color?: string;
  bold?: boolean;
  inverse?: boolean;
}

interface StationMark {
  label: string;
  color?: string;
  inverse?: boolean;
}

/** 말 4개를 완주·판·집 순서의 아이콘으로 — 누가 앞서는지 숫자를 읽지 않아도 보인다. */
export function pieceIcons(p: YutPlayerView, theme: GameViewProps['theme']): string {
  const [done, board, home] = theme.unicode ? ['★', '●', '○'] : ['*', 'o', '.'];
  const onBoard = p.pieces.length - p.home - p.finished;
  return done.repeat(p.finished) + board.repeat(Math.max(0, onBoard)) + home.repeat(p.home);
}

/** 칸 하나의 3칼럼 라벨. 말이 있으면 기호(+업힌 수), 없으면 빈 칸 표시. */
function padCell(s: string): string {
  return s.length === 1 ? ` ${s} ` : s.padEnd(3).slice(0, 3);
}

/** 판 아트를 줄마다 스타일 조각(Seg) 배열로 만든다. marks는 칸 번호 → 표시. */
function renderBoard(marks: Map<number, StationMark>, theme: GameViewProps['theme']): Seg[][] {
  const h = theme.unicode ? '─' : '-';
  const vch = theme.unicode ? '│' : '|';
  const back = theme.unicode ? '╲' : '\\';
  const fwd = theme.unicode ? '╱' : '/';
  const grid: string[][] = Array.from({ length: BOARD_ROWS }, () => Array.from({ length: BOARD_COLS }, () => ' '));
  for (let x = 0; x < BOARD_COLS; x++) {
    grid[0]![x] = h;
    grid[BOARD_ROWS - 1]![x] = h;
  }
  for (let y = 1; y < BOARD_ROWS - 1; y++) {
    grid[y]![1] = vch;
    grid[y]![BOARD_COLS - 2] = vch;
    // 두 대각선: 왼쪽 위(1,0) → 오른쪽 아래(51,10), 오른쪽 위 → 왼쪽 아래. 한 줄에 5칼럼씩 기운다.
    grid[y]![1 + 5 * y] = back;
    grid[y]![BOARD_COLS - 2 - 5 * y] = fwd;
  }
  // 진행 방향: 참먹이(오른쪽 아래)에서 오른쪽 변을 따라 위로 올라간다.
  grid[BOARD_ROWS - 2]![BOARD_COLS - 2] = theme.unicode ? '↑' : '^';
  // 줄마다 칸 시작 칼럼 → 칸 번호.
  const starts = new Map<string, number>();
  STATION_POS.forEach(([y, x], s) => starts.set(`${y}:${x - 1}`, s));

  return grid.map((row, y) => {
    const segs: Seg[] = [];
    let plain = '';
    for (let x = 0; x < BOARD_COLS; x++) {
      const s = starts.get(`${y}:${x}`);
      if (s === undefined) {
        plain += row[x];
        continue;
      }
      if (plain) segs.push({ text: plain });
      plain = '';
      const mark = marks.get(s);
      const empty = BIG_STATIONS.has(s) ? (theme.unicode ? '◎' : '@') : theme.unicode ? '○' : 'o';
      segs.push({
        text: padCell(mark?.label ?? empty),
        color: mark?.color,
        bold: mark !== undefined,
        inverse: mark?.inverse,
      });
      x += 2;
    }
    if (plain) segs.push({ text: plain });
    return segs;
  });
}

/**
 * 윷놀이 화면. 내 차례인지는 yourActions로만 판단한다(throw 또는 move). 합법 수(moves)와 그
 * 도착 칸은 엔진이 계산해 보내므로 클라이언트는 윷판 경로를 다시 계산하지 않는다.
 */
export function YutView({ view, you, send, theme, focus, sendFocus }: GameViewProps): React.JSX.Element {
  const v = view as unknown as YutGameView;
  const canThrow = v.yourActions.includes('throw');
  const canMove = v.yourActions.includes('move');
  const moves = canMove ? v.moves : [];

  // 합법 수가 하나라도 있는 결과만 고를 수 있다(판에 말이 없을 때의 빽도 등은 건너뛴다).
  const usableThrows = [...new Set(moves.map((m) => m.throwIndex))].sort((a, b) => a - b);
  const [throwSel, setThrowSel] = useState(0);
  const [pieceSel, setPieceSel] = useState(0);
  const tSel = Math.min(throwSel, Math.max(0, usableThrows.length - 1));
  const selThrowIndex = usableThrows[tSel];
  const pieceOptions = moves.filter((m) => m.throwIndex === selThrowIndex);
  const pSel = Math.min(pieceSel, Math.max(0, pieceOptions.length - 1));
  const selMove = pieceOptions[pSel];

  useScreenInput((input, key) => {
    if (canThrow) {
      if (input === ' ') send('throw');
      return;
    }
    if (!canMove || usableThrows.length === 0) return;
    if (key.leftArrow) {
      setThrowSel((tSel - 1 + usableThrows.length) % usableThrows.length);
      setPieceSel(0);
    } else if (key.rightArrow) {
      setThrowSel((tSel + 1) % usableThrows.length);
      setPieceSel(0);
    } else if (key.upArrow) {
      setPieceSel(Math.max(0, pSel - 1));
    } else if (key.downArrow) {
      setPieceSel(Math.min(pieceOptions.length - 1, pSel + 1));
    } else if (key.return && selMove) {
      send('move', { throwIndex: selMove.throwIndex, piece: selMove.piece });
      setPieceSel(0);
      setThrowSel(0);
    }
  });

  // 판 위 표시: 칸마다 한 사람의 말만 있을 수 있다(다른 사람 말이 오면 잡히므로).
  const marks = new Map<number, StationMark>();
  for (const p of v.players) {
    const counts = new Map<number, number>();
    for (const pc of p.pieces) {
      if (pc.state === 'board' && pc.station !== undefined) counts.set(pc.station, (counts.get(pc.station) ?? 0) + 1);
    }
    for (const [s, n] of counts) {
      marks.set(s, { label: n > 1 ? `${p.marker}${n}` : p.marker, color: MARKER_COLORS[p.marker] });
    }
  }
  const me = v.players.find((p) => p.nickname === you);

  // 내가 고르는 수는 서버로 보내고, 차례인 다른 사람이 고민 중인 수는 받아서 같은 방식으로 판에 그린다.
  useFocusBroadcast(sendFocus, canMove && selMove ? { throwIndex: selMove.throwIndex, piece: selMove.piece } : null, view);
  const theirs = ((): { owner: YutPlayerView; throwIndex: number; piece: number; to: number | 'done'; path: number[] } | null => {
    const owner = v.players.find((p) => p.nickname === v.turnPlayer);
    if (owner === undefined || owner.nickname === you) return null;
    const f = focus?.[owner.nickname] as { throwIndex?: unknown; piece?: unknown; to?: unknown; path?: unknown } | undefined;
    if (f === undefined || typeof f.throwIndex !== 'number' || typeof f.piece !== 'number') return null;
    if (typeof f.to !== 'number' && f.to !== 'done') return null;
    const path = Array.isArray(f.path) ? f.path.filter((s): s is number => typeof s === 'number') : [];
    return { owner, throwIndex: f.throwIndex, piece: f.piece, to: f.to, path };
  })();
  const preview = selMove && me ? { owner: me, ...selMove, path: selMove.path ?? [], color: 'yellow' } : theirs ? { ...theirs, color: 'magenta' } : null;

  if (preview) {
    const from = preview.owner.pieces[preview.piece];
    if (from?.state === 'board' && from.station !== undefined) {
      const m = marks.get(from.station);
      if (m) marks.set(from.station, { ...m, inverse: true });
    }
    // 지나가는 빈 칸에 경로 표시 — 모서리에서 지름길로 꺾는지가 윷놀이의 핵심 판단이다.
    for (const s of preview.path) {
      if (s !== preview.to && !marks.has(s)) marks.set(s, { label: theme.unicode ? '·' : '+', color: preview.color });
    }
    if (preview.to !== 'done') {
      // 도착 칸에는 항상 *를 붙인다 — 잡는 칸(상대 말이 있는 칸)도 반전만으로는 색 없는 터미널에서 안 보인다.
      const existing = marks.get(preview.to);
      marks.set(preview.to, existing ? { ...existing, label: `*${existing.label}`, inverse: true } : { label: '*', color: preview.color, inverse: true });
    }
  }
  const board = renderBoard(marks, theme);

  /** 움직이는 말 표시 — 업힌 수는 그 말과 같은 칸에 있는 owner의 말 수다. */
  function pieceLabel(m: { piece: number }, owner: YutPlayerView | undefined = me): string {
    const pc = owner?.pieces[m.piece];
    if (!pc || pc.state === 'home') return '새 말';
    const stack = owner!.pieces.filter((o) => o.state === 'board' && o.station === pc.station).length;
    return stack > 1 ? `말${m.piece + 1}(${stack}개)` : `말${m.piece + 1}`;
  }

  /** 다른 사람이 고민 중인 수를 한 문장으로. 도착 칸에 내 말이 있으면 경고를 붙인다. */
  function theirsText(t: NonNullable<typeof theirs>): string {
    const dest = t.to === 'done' ? '나기(완주)' : (STATION_NAMES[t.to] ?? '* 칸');
    const threatened = t.to !== 'done' && (me?.pieces.some((pc) => pc.state === 'board' && pc.station === t.to) ?? false);
    return `${truncateDisplay(t.owner.nickname, NICK_CAP)}님이 [${v.throws[t.throwIndex]?.name ?? '?'}] ${pieceLabel(t, t.owner)} ${arrow} ${dest} 고민 중${threatened ? ' (내 말을 잡을 수 있습니다!)' : ''}`;
  }

  function destLabel(m: YutMoveView): string {
    if (m.to === 'done') return '나기(완주)';
    const name = STATION_NAMES[m.to] ?? '* 칸';
    return m.capture > 0 ? `${name}, 잡기!` : name;
  }

  const arrow = theme.unicode ? '→' : '->';
  const lr = theme.unicode ? '←→' : 'Left/Right';
  const ud = theme.unicode ? '↑↓' : 'Up/Down';

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexShrink={0}>
        {board.map((row, y) => (
          <Text key={y}>
            {row.map((seg, i) => (
              <Text key={i} color={seg.color} bold={seg.bold} inverse={seg.inverse}>
                {seg.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
      <Text dimColor wrap="truncate-end">
        오른쪽 아래 {theme.unicode ? '◎' : '@'} = 참먹이(출발/도착)
      </Text>

      {/* 플레이어 목록 오른쪽 빈 공간에 마지막 윷가락을 둔다 — 아래에 쌓으면 화면이 4줄 길어져
       * 짧은 터미널에서 윷판이 위로 밀려난다. */}
      <Box flexDirection="row" marginTop={1}>
      <Box flexDirection="column" flexGrow={1}>
        {v.players.map((p) => (
          <Text key={p.nickname} wrap="truncate-end" bold={p.isTurn}>
            <Text color={MARKER_COLORS[p.marker]} bold>
              {p.marker}
            </Text>{' '}
            {truncateDisplay(p.nickname, NICK_CAP)}
            {p.nickname === you ? ' (나)' : ''}
            {p.isTurn ? ` ${turnGlyph(theme)}` : ''}
            <Text color={MARKER_COLORS[p.marker]}>
              {'  '}
              {pieceIcons(p, theme)}
            </Text>
            <Text dimColor>
              {'  '}집 {p.home}
              {sep(theme)}판 {p.pieces.length - p.home - p.finished}
              {sep(theme)}완주 {p.finished}
            </Text>
          </Text>
        ))}
      </Box>
      {v.lastThrow && (
        <Box flexDirection="column" flexShrink={0} marginLeft={2}>
          {renderSticks(v.lastThrow.sticks, theme).map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
          <Text bold color={BONUS_THROWS.has(v.lastThrow.name) ? 'yellow' : undefined}>
            {truncateDisplay(v.lastThrow.player, NICK_CAP)}: {v.lastThrow.name}! ({v.lastThrow.steps}칸)
            {BONUS_THROWS.has(v.lastThrow.name) ? ' 한 번 더!' : ''}
          </Text>
        </Box>
      )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          나온 윷:{' '}
          {v.throws.length === 0 && <Text dimColor>없음</Text>}
          {v.throws.map((t, i) => {
            const selected = canMove && i === selThrowIndex;
            const unusable = canMove && !usableThrows.includes(i);
            return (
              <Text key={i} inverse={selected} bold={selected} dimColor={unusable}>
                {i > 0 ? ' ' : ''}[{t.name} {t.steps}]
              </Text>
            );
          })}
          {v.throwsLeft > 0 && <Text dimColor>{`  (던질 기회 ${v.throwsLeft}번)`}</Text>}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {canThrow && <Text color="yellow">Space 윷 던지기</Text>}
        {canMove && selMove && (
          <>
            <Text wrap="truncate-end">
              말 고르기:{' '}
              {pieceOptions.map((m, i) => (
                <Text key={m.piece} inverse={i === pSel} bold={i === pSel}>
                  {i > 0 ? ' ' : ''}
                  {i === pSel ? cursorGlyph(theme) : ' '}
                  {pieceLabel(m)}
                </Text>
              ))}
            </Text>
            <Text color="yellow" wrap="truncate-end">
              [{v.throws[selMove.throwIndex]?.name}] {pieceLabel(selMove)} {arrow} {destLabel(selMove)}
            </Text>
            <Text dimColor wrap="truncate-end">
              {lr} 윷 고르기  {ud} 말 고르기  Enter 이동
            </Text>
          </>
        )}
        {!canThrow && !canMove && v.turnPlayer !== null && theirs !== null && (
          <Text color="magenta" wrap="truncate-end">
            {theirsText(theirs)}
          </Text>
        )}
        {!canThrow && !canMove && v.turnPlayer !== null && theirs === null && (
          <Text dimColor wrap="truncate-end">
            {truncateDisplay(v.turnPlayer, NICK_CAP)}님의 차례입니다.
          </Text>
        )}
      </Box>
    </Box>
  );
}
