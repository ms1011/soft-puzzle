import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { GameId, MafiaSettings, MafiaSpecialRole } from '@soft-puzzle/core';
import { GAME_IDS, GAME_INFO, GAME_LABELS } from '../gameLabels.js';

export interface MainMenuProps {
  onCreateRoom: (game: GameId, mafiaSettings?: MafiaSettings) => void;
  onJoinRoom: () => void;
  onChangeNickname: () => void;
  onQuit: () => void;
  /** 방 만들기 도중 실패(서버/디스커버리 기동 실패 등)했다면 그 메시지. */
  error?: string;
}

const MAIN_ITEMS = ['방 만들기', '방 참가', '닉네임 설정', '종료'] as const;
const SPECIAL_ROLE_LABELS: Record<MafiaSpecialRole, string> = { doctor: '의사', police: '경찰', detective: '탐정' };
const SPECIAL_ROLES: readonly MafiaSpecialRole[] = ['doctor', 'police', 'detective'];
const MAFIA_SETUP_ITEMS = ['마피아 수', ...SPECIAL_ROLES, '방 만들기'] as const;

/**
 * 메인 메뉴. "방 만들기"를 고르면 이 컴포넌트 내부 상태만으로 게임 선택 하위 화면으로 전환한다
 * (브리프의 화면 목록에 별도 GameSelect.tsx가 없다 — nickname→menu→(create: gameSelect) 전이의
 * gameSelect는 MainMenu의 내부 모드다). 최종적으로 game id 하나를 골랐을 때만 onCreateRoom을
 * 호출해 App으로 결정을 넘긴다 — 그 전까지는 소켓도 Room도 전혀 모른다(순수 컴포넌트).
 */
export function MainMenu({ onCreateRoom, onJoinRoom, onChangeNickname, onQuit, error }: MainMenuProps): React.JSX.Element {
  const [mode, setMode] = useState<'main' | 'gameSelect' | 'mafiaSetup'>('main');
  const [selected, setSelected] = useState(0);
  const [mafiaSettings, setMafiaSettings] = useState<MafiaSettings>({ mafiaCount: 1, specialRoles: [] });

  useInput((input, key) => {
    const items = mode === 'main' ? MAIN_ITEMS : mode === 'gameSelect' ? GAME_IDS : MAFIA_SETUP_ITEMS;

    if (key.upArrow) {
      setSelected((i) => (i - 1 + items.length) % items.length);
      return;
    }
    if (key.downArrow) {
      setSelected((i) => (i + 1) % items.length);
      return;
    }
    if (mode !== 'main' && key.escape) {
      setMode('main');
      setSelected(0);
      return;
    }

    if (mode === 'mafiaSetup' && selected === 0 && (key.leftArrow || key.rightArrow)) {
      setMafiaSettings((prev) => ({ ...prev, mafiaCount: key.leftArrow ? Math.max(1, prev.mafiaCount - 1) : Math.min(2, prev.mafiaCount + 1) }));
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

    if (mode === 'gameSelect') {
      const game = GAME_IDS[confirmIndex]!;
      if (game === 'mafia') {
        setMode('mafiaSetup');
        setSelected(0);
      } else onCreateRoom(game);
      return;
    }

    if (confirmIndex === 0) {
      setMafiaSettings((prev) => ({ ...prev, mafiaCount: prev.mafiaCount === 1 ? 2 : 1 }));
    } else if (confirmIndex <= SPECIAL_ROLES.length) {
      const role = SPECIAL_ROLES[confirmIndex - 1]!;
      setMafiaSettings((prev) => ({
        ...prev,
        specialRoles: prev.specialRoles.includes(role) ? prev.specialRoles.filter((item) => item !== role) : [...prev.specialRoles, role],
      }));
    } else {
      onCreateRoom('mafia', mafiaSettings);
    }
  });

  const items: readonly string[] = mode === 'main'
    ? MAIN_ITEMS
    : mode === 'gameSelect'
      ? GAME_IDS.map((g) => GAME_LABELS[g])
      : MAFIA_SETUP_ITEMS.map((item) => item === '마피아 수' ? `마피아 수: ${mafiaSettings.mafiaCount}명` : item === '방 만들기' ? item : `${mafiaSettings.specialRoles.includes(item) ? '[x]' : '[ ]'} ${SPECIAL_ROLE_LABELS[item]}`);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>소프트퍼즐</Text>
      {mode === 'gameSelect' && <Text>게임을 선택하세요 (Esc로 뒤로):</Text>}
      {mode === 'mafiaSetup' && <Text>마피아 설정 (↑↓ 선택 · Enter 토글 · ←→ 인원 · Esc 뒤로)</Text>}
      {items.map((label, i) => (
        <Text key={label} inverse={i === selected}>
          {i === selected ? '> ' : '  '}
          {label}
        </Text>
      ))}
      {mode === 'gameSelect' && (
        <Text dimColor>
          최소 {GAME_INFO[GAME_IDS[selected]!].minPlayers}명 · {GAME_INFO[GAME_IDS[selected]!].duration} · {GAME_INFO[GAME_IDS[selected]!].summary}
        </Text>
      )}
      {error !== undefined && <Text color="red">{error}</Text>}
    </Box>
  );
}
