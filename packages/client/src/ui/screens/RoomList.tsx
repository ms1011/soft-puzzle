import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { RoomInfo } from '@card-night/core';
import { GAME_LABELS } from '../gameLabels.js';
import { parseHostPort } from '../roomListUtils.js';

export interface RoomListProps {
  /** App이 이미 dedupeRooms()로 중복을 제거해 넘긴 목록 (결정 5 — 호스트 자신의 방이 두 번
   * 보이지 않게 하는 처리는 App 쪽 책임이고, 이 화면은 받은 목록을 그대로 그린다). */
  rooms: RoomInfo[];
  scanning: boolean;
  error?: string;
  onRefresh: () => void;
  onSelect: (room: RoomInfo) => void;
  onManualConnect: (host: string, port: number) => void;
  /** Esc/q — 방을 찾지 못했거나 마음이 바뀐 사용자가 메인 메뉴로 돌아간다. */
  onCancel: () => void;
}

/**
 * 방 목록 화면. 방향키로 목록을 고르고 Enter로 입장, r로 새로고침, i로 IP 직접 입력 모드로
 * 전환한다("192.168.0.5:7420" 형식). 목록이 비어 있으면 안내 문구를 보여준다. Esc/q로 메인
 * 메뉴로 돌아간다(수동 입력 모드에서는 Esc가 먼저 그 모드만 취소한다).
 */
export function RoomList({
  rooms,
  scanning,
  error,
  onRefresh,
  onSelect,
  onManualConnect,
  onCancel,
}: RoomListProps): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState<string | undefined>(undefined);

  useInput((input, key) => {
    if (manualMode) {
      if (key.escape) {
        setManualMode(false);
        setManualError(undefined);
      }
      return;
    }

    if (input === 'r') {
      onRefresh();
      return;
    }
    if (input === 'i') {
      setManualMode(true);
      setManualValue('');
      setManualError(undefined);
      return;
    }
    if (input === 'q' || key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelected((i) => (rooms.length === 0 ? 0 : (i - 1 + rooms.length) % rooms.length));
      return;
    }
    if (key.downArrow) {
      setSelected((i) => (rooms.length === 0 ? 0 : (i + 1) % rooms.length));
      return;
    }
    if (key.return && rooms.length > 0) {
      onSelect(rooms[selected]!);
    }
  });

  const handleManualSubmit = (raw: string): void => {
    const parsed = parseHostPort(raw);
    if (parsed === null) {
      setManualError('형식이 올바르지 않습니다. 예: 192.168.0.5:7420');
      return;
    }
    onManualConnect(parsed.host, parsed.port);
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>방 목록</Text>
      {scanning && <Text dimColor>검색 중...</Text>}
      {!scanning && rooms.length === 0 && !manualMode && <Text>발견된 방이 없습니다</Text>}

      {!manualMode &&
        rooms.map((room, i) => (
          <Text key={`${room.addr}-${room.room}`} inverse={i === selected}>
            {i === selected ? '> ' : '  '}
            {room.room} [{GAME_LABELS[room.game]}] {room.players} - {room.addr}
          </Text>
        ))}

      {manualMode && (
        <Box flexDirection="column">
          <Text>IP:포트를 입력하세요 (예: 192.168.0.5:7420, Esc로 취소):</Text>
          <Box>
            <Text>{'> '}</Text>
            <TextInput value={manualValue} onChange={setManualValue} onSubmit={handleManualSubmit} />
          </Box>
          {manualError !== undefined && <Text color="red">{manualError}</Text>}
        </Box>
      )}

      {error !== undefined && <Text color="red">{error}</Text>}

      {!manualMode && (
        <Text dimColor>[r] 새로고침 [i] IP 직접 입력 [Enter] 입장 [q] 메뉴로</Text>
      )}
    </Box>
  );
}
