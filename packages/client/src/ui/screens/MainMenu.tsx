import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { GameId } from '@soft-puzzle/core';
import { GAME_IDS, GAME_LABELS } from '../gameLabels.js';

export interface MainMenuProps {
  onCreateRoom: (game: GameId) => void;
  onJoinRoom: () => void;
  onChangeNickname: () => void;
  onQuit: () => void;
  /** 방 만들기 도중 실패(서버/디스커버리 기동 실패 등)했다면 그 메시지. */
  error?: string;
}

const MAIN_ITEMS = ['방 만들기', '방 참가', '닉네임 설정', '종료'] as const;

/**
 * 메인 메뉴. "방 만들기"를 고르면 이 컴포넌트 내부 상태만으로 게임 선택 하위 화면으로 전환한다
 * (브리프의 화면 목록에 별도 GameSelect.tsx가 없다 — nickname→menu→(create: gameSelect) 전이의
 * gameSelect는 MainMenu의 내부 모드다). 최종적으로 game id 하나를 골랐을 때만 onCreateRoom을
 * 호출해 App으로 결정을 넘긴다 — 그 전까지는 소켓도 Room도 전혀 모른다(순수 컴포넌트).
 */
export function MainMenu({ onCreateRoom, onJoinRoom, onChangeNickname, onQuit, error }: MainMenuProps): React.JSX.Element {
  const [mode, setMode] = useState<'main' | 'gameSelect'>('main');
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    const items = mode === 'main' ? MAIN_ITEMS : GAME_IDS;

    if (key.upArrow) {
      setSelected((i) => (i - 1 + items.length) % items.length);
      return;
    }
    if (key.downArrow) {
      setSelected((i) => (i + 1) % items.length);
      return;
    }
    if (mode === 'gameSelect' && key.escape) {
      setMode('main');
      setSelected(0);
      return;
    }

    const digit = Number(input);
    const jumpIndex = Number.isInteger(digit) && digit >= 1 && digit <= items.length ? digit - 1 : null;
    const confirmIndex = key.return ? selected : jumpIndex;
    if (confirmIndex === null) return;

    if (mode === 'main') {
      if (confirmIndex === 0) {
        setMode('gameSelect');
        setSelected(0);
      } else if (confirmIndex === 1) {
        onJoinRoom();
      } else if (confirmIndex === 2) {
        onChangeNickname();
      } else {
        onQuit();
      }
      return;
    }

    onCreateRoom(GAME_IDS[confirmIndex]!);
  });

  const items: readonly string[] = mode === 'main' ? MAIN_ITEMS : GAME_IDS.map((g) => GAME_LABELS[g]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>소프트퍼즐</Text>
      {mode === 'gameSelect' && <Text>게임을 선택하세요 (Esc로 뒤로):</Text>}
      {items.map((label, i) => (
        <Text key={label} inverse={i === selected}>
          {i === selected ? '> ' : '  '}
          {label}
        </Text>
      ))}
      {error !== undefined && <Text color="red">{error}</Text>}
    </Box>
  );
}
