import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { GameViewProps } from './types.js';

interface Board { nickname: string; eliminated?: boolean; tiles: { value: number | null; revealed: boolean }[]; }
interface DavinciViewState { yourActions: string[]; isTurn: boolean; boards: Board[]; }

export function DavinciView({ view, you, send }: GameViewProps): React.JSX.Element {
  const v = view as unknown as DavinciViewState;
  const targets = v.boards.filter((board) => board.nickname !== you).flatMap((board) => board.tiles.map((tile, index) => ({ board, tile, index })).filter(({ tile }) => !tile.revealed));
  const [cursor, setCursor] = useState(0); const [guess, setGuess] = useState(0);
  const canGuess = v.yourActions.includes('guess');
  useEffect(() => setCursor((current) => Math.min(current, Math.max(0, targets.length - 1))), [targets.length]);
  useInput((_input, key) => {
    if (!canGuess || targets.length === 0) return;
    if (key.upArrow) setCursor((current) => (current - 1 + targets.length) % targets.length);
    else if (key.downArrow) setCursor((current) => (current + 1) % targets.length);
    else if (key.leftArrow) setGuess((current) => Math.max(0, current - 1));
    else if (key.rightArrow) setGuess((current) => Math.min(11, current + 1));
    else if (key.return) { const target = targets[cursor]; if (target) send('guess', { player: target.board.nickname, index: target.index, value: guess }); }
  });
  return <Box flexDirection="column" paddingX={1}>
    <Text bold>{v.isTurn ? '내 차례 — 상대 타일의 숫자를 맞히세요.' : '상대가 추리 중입니다.'}</Text>
    {v.boards.map((board) => <Text key={board.nickname} dimColor={board.eliminated}>{board.nickname}{board.nickname === you ? ' (나)' : ''}{board.eliminated ? ' (탈락)' : ''}: {board.tiles.map((tile, index) => tile.value === null ? `[?${index + 1}]` : `[${tile.value}]`).join(' ')}</Text>)}
    <Text dimColor>{canGuess ? `↑↓ 타일 선택 · ←→ 숫자 ${guess} · Enter 추리` : '다른 참가자를 기다리는 중입니다.'}</Text>
  </Box>;
}
