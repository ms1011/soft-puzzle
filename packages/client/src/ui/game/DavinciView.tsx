import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import { renderTile, TILE_HEIGHT, TILE_WIDTH } from '../../art/tiles.js';
import type { TileKind } from '../../art/tiles.js';
import { cursorGlyph, turnGlyph } from './glyphs.js';
import { useFocusBroadcast } from '../focus.js';
import type { GameViewProps } from './types.js';

interface Tile { value: number | null; revealed: boolean; }
interface Board { nickname: string; eliminated?: boolean; tiles: Tile[]; }
interface DavinciViewState { yourActions: string[]; isTurn: boolean; turnPlayer?: string | null; boards: Board[]; }

const MAX_VALUE = 11;
/** 보드 한 칸 폭 — 타일 4장(4칸 + 사이 1칸 = 19)과 닉네임 줄이 들어가면서, 80칼럼에 3명씩 나란히
 * 놓인다. 6인도 두 줄이면 끝나 짧은 터미널에서 화면이 위로 밀려나지 않는다. */
const BOARD_WIDTH = 26;

function tileKind(tile: Tile): TileKind {
  if (tile.revealed) return 'revealed';
  return tile.value === null ? 'hidden' : 'mine';
}

/** 타일 한 장이 한 줄에서 차지하는 조각 — 선택된 타일만 색을 달리 칠하려고 조각으로 나눈다. */
export interface TileSegment {
  text: string;
  kind: TileKind;
  selected: boolean;
}

/**
 * 한 사람의 타일 줄을 그린다. 전체 격자는 5줄(타일 3줄 + 들어 올린 만큼의 여유 1줄 + 번호 1줄)
 * — 겨누고 있는 타일만 0~2행, 나머지는 1~3행을 차지해 한 칸 위로 떠 보인다(원카드의 선택 카드와
 * 같은 표현). 마지막 줄은 타일 번호다.
 */
export function renderTileRow(tiles: Tile[], selectedIndex: number | null, theme: GameViewProps['theme']): TileSegment[][] {
  const rows: TileSegment[][] = Array.from({ length: TILE_HEIGHT + 2 }, () => []);
  tiles.forEach((tile, i) => {
    const kind = tileKind(tile);
    const selected = i === selectedIndex;
    const art = renderTile(tile.value, kind, theme);
    const offset = selected ? 0 : 1;
    for (let r = 0; r < TILE_HEIGHT + 1; r++) {
      const artRow = r - offset;
      const text = artRow >= 0 && artRow < TILE_HEIGHT ? art[artRow]! : ' '.repeat(TILE_WIDTH);
      rows[r]!.push({ text: i === 0 ? text : ` ${text}`, kind, selected });
    }
    const label = String(i + 1).padStart(Math.ceil(TILE_WIDTH / 2) + 1, ' ').padEnd(TILE_WIDTH, ' ');
    rows[TILE_HEIGHT + 1]!.push({ text: i === 0 ? label : ` ${label}`, kind, selected });
  });
  return rows;
}

/** 추리할 숫자 줄 — 고른 숫자만 [ ]로 감싼다. */
export function guessStrip(guess: number): string {
  return Array.from({ length: MAX_VALUE + 1 }, (_, n) => (n === guess ? `[${n}]` : ` ${n} `)).join('');
}

export function DavinciView({ view, you, send, theme, focus, sendFocus }: GameViewProps): React.JSX.Element {
  const v = view as unknown as DavinciViewState;
  const targets = v.boards
    .filter((board) => board.nickname !== you && !board.eliminated)
    .flatMap((board) => board.tiles.map((tile, index) => ({ board, tile, index })).filter(({ tile }) => !tile.revealed));
  const [cursor, setCursor] = useState(0);
  const [guess, setGuess] = useState(0);
  const canGuess = v.yourActions.includes('guess');
  useEffect(() => setCursor((current) => Math.min(current, Math.max(0, targets.length - 1))), [targets.length]);
  useScreenInput((_input, key) => {
    if (!canGuess || targets.length === 0) return;
    if (key.upArrow) setCursor((current) => (current - 1 + targets.length) % targets.length);
    else if (key.downArrow) setCursor((current) => (current + 1) % targets.length);
    else if (key.leftArrow) setGuess((current) => Math.max(0, current - 1));
    else if (key.rightArrow) setGuess((current) => Math.min(MAX_VALUE, current + 1));
    else if (key.return) {
      const target = targets[cursor];
      if (target) send('guess', { player: target.board.nickname, index: target.index, value: guess });
    }
  });

  const selected = canGuess ? targets[cursor] : undefined;
  useFocusBroadcast(sendFocus, selected !== undefined ? { player: selected.board.nickname, index: selected.index } : null, view);

  // 차례인 다른 사람이 겨누는 타일. 내 선택과 동시에 있을 수 없다(차례는 한 명뿐이다).
  const aimer = v.turnPlayer !== null && v.turnPlayer !== undefined && v.turnPlayer !== you ? v.turnPlayer : null;
  const rawAim = aimer !== null ? (focus?.[aimer] as { player?: unknown; index?: unknown } | undefined) : undefined;
  const aimed =
    rawAim !== undefined && typeof rawAim.player === 'string' && typeof rawAim.index === 'number'
      ? { player: rawAim.player, index: rawAim.index }
      : null;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{v.isTurn ? '내 차례: 상대 타일의 숫자를 맞히세요.' : `${v.turnPlayer ?? '상대'}님이 추리 중입니다.`}</Text>
      <Box flexDirection="row" flexWrap="wrap">
      {v.boards.map((board) => {
        const isYou = board.nickname === you;
        const isTurn = v.turnPlayer === board.nickname;
        const mine = selected !== undefined && selected.board.nickname === board.nickname ? selected.index : null;
        const theirs = aimed !== null && aimed.player === board.nickname ? aimed.index : null;
        const selectedIndex = mine ?? theirs;
        return (
          <Box key={board.nickname} flexDirection="column" marginTop={1} width={BOARD_WIDTH}>
            <Text bold={isYou || isTurn} color={isYou ? 'cyan' : undefined} dimColor={board.eliminated} wrap="truncate-end">
              {isTurn ? `${turnGlyph(theme)} ` : '  '}
              {board.nickname}
              {isYou ? ' (나)' : ''}
              {board.eliminated ? ' (탈락)' : ''}
            </Text>
            {renderTileRow(board.tiles, selectedIndex, theme).map((row, r) => (
              <Text key={r} dimColor={board.eliminated}>
                {'  '}
                {row.map((seg, i) => (
                  <Text
                    key={i}
                    color={seg.selected ? (mine !== null ? 'cyan' : 'magenta') : seg.kind === 'revealed' ? 'yellow' : undefined}
                    bold={seg.selected}
                    dimColor={seg.kind === 'mine'}
                  >
                    {seg.text}
                  </Text>
                ))}
              </Text>
            ))}
          </Box>
        );
      })}
      </Box>
      {aimed !== null && aimer !== null && (
        <Box marginTop={1}>
          {aimed.player === you ? (
            <Text bold color="magenta">
              {aimer}님이 내 {aimed.index + 1}번 타일을 노리고 있습니다!
            </Text>
          ) : (
            <Text color="magenta">
              {aimer}님이 {aimed.player}님의 {aimed.index + 1}번 타일을 노리는 중
            </Text>
          )}
        </Box>
      )}
      {canGuess && selected !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {cursorGlyph(theme)} 대상: {selected.board.nickname}님의 {selected.index + 1}번 타일
          </Text>
          <Text>
            추리: <Text bold color="cyan">{guessStrip(guess)}</Text>
          </Text>
        </Box>
      )}
      <Text dimColor>흐린 숫자 = 나만 보이는 내 타일, {theme.unicode ? '두 줄' : '#'} 테두리 = 공개된 타일</Text>
      <Text dimColor>
        {canGuess
          ? [`${theme.unicode ? '↑↓' : '위/아래'} 타일 선택`, `${theme.unicode ? '←→' : '좌/우'} 숫자`, 'Enter 추리'].join(theme.unicode ? ' · ' : '  ')
          : '다른 참가자를 기다리는 중입니다.'}
      </Text>
    </Box>
  );
}
