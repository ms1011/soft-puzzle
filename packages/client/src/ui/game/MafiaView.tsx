import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import { cursorGlyph, sep } from './glyphs.js';
import { useFocusBroadcast } from '../focus.js';
import type { GameViewProps } from './types.js';

interface MafiaPlayer {
  nickname: string;
  alive: boolean;
  role?: 'mafia' | 'citizen' | 'doctor' | 'police' | 'detective';
}

interface MafiaGameView {
  phase: 'night' | 'day' | 'result';
  yourActions: string[];
  yourRole: 'mafia' | 'citizen' | 'doctor' | 'police' | 'detective';
  phaseLabel: string;
  alive: MafiaPlayer[];
  hasActed: boolean;
  investigationResult?: string;
  /** 몇 일차인지. 이 필드가 없던 옛 서버와 붙으면 undefined다. */
  day?: number;
  /** 낮 투표를 마친 사람. 밤에는 비어 있다(밤 행동자가 보이면 역할이 드러난다). */
  voted?: string[];
}

const ROLE_LABELS = { mafia: '마피아', citizen: '시민', doctor: '의사', police: '경찰', detective: '탐정' } as const;

/** 마피아는 역할과 생존 여부가 핵심이라, 카드 아트 대신 투표 대상 선택을 크게 보여준다. */
export function MafiaView({ view, you, send, theme, focus, sendFocus }: GameViewProps): React.JSX.Element {
  const v = view as unknown as MafiaGameView;
  const action = v.yourActions[0];
  const canAct = action !== undefined;
  const targets = v.alive.filter((p) => p.alive && (action === 'protect' || p.nickname !== you));
  const [cursor, setCursor] = useState(0);

  useEffect(() => setCursor((i) => Math.min(i, Math.max(0, targets.length - 1))), [targets.length, canAct]);

  // 밤의 마피아 조준만 보낸다 — 낮 투표 커서는 숨긴다(투표는 비밀이다). 서버도 한 번 더 막는다.
  const aiming = canAct && action === 'mafiaVote' ? targets[Math.min(cursor, targets.length - 1)] : undefined;
  useFocusBroadcast(sendFocus, aiming !== undefined ? { target: aiming.nickname } : null, view);

  /** 이 대상을 겨누고 있는 동료 마피아들(서버는 마피아에게만 동료의 조준을 보낸다). */
  function comradesAiming(nickname: string): string[] {
    return Object.entries(focus ?? {})
      .filter(([, t]) => (t as { target?: unknown } | null)?.target === nickname)
      .map(([from]) => from);
  }

  useScreenInput((_input, key) => {
    if (!canAct || targets.length === 0) return;
    if (key.upArrow) setCursor((i) => (i - 1 + targets.length) % targets.length);
    else if (key.downArrow) setCursor((i) => (i + 1) % targets.length);
    else if (key.return) {
      const target = targets[cursor];
      if (target && action !== undefined) send(action, target.nickname);
    }
  });

  const roleLabel = ROLE_LABELS[v.yourRole];
  const isNight = v.phase === 'night';
  const phaseText = isNight
    ? ({ mafiaVote: '처치할 대상을 고르세요.', protect: '보호할 대상을 고르세요.', investigateMafia: '조사할 대상을 고르세요.', investigateRole: '직업을 확인할 대상을 고르세요.' }[action ?? ''] ?? '다른 플레이어의 행동을 기다리는 중입니다.')
    : '탈락시킬 사람에게 투표하세요.';
  const pointer = cursorGlyph(theme);
  const voted = v.voted ?? [];
  const aliveCount = v.alive.filter((p) => p.alive).length;
  const banner = `${theme.unicode ? (isNight ? '☾ ' : '☀ ') : ''}${v.day !== undefined ? `${v.day}일차 ` : ''}${isNight ? '밤' : '낮'}`;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={v.yourRole === 'mafia' ? 'red' : 'cyan'}>
        내 역할: {roleLabel}
      </Text>
      <Text>
        <Text bold color={isNight ? 'blue' : 'yellow'}>
          {banner}
        </Text>
        {'  '}
        {phaseText}
      </Text>
      {!isNight && (
        <Text dimColor>
          투표 {voted.length}/{aliveCount}명
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>참가자</Text>
        {v.alive.map((p) => {
          const targetIndex = targets.findIndex((target) => target.nickname === p.nickname);
          const selected = canAct && targetIndex === cursor;
          const comrades = comradesAiming(p.nickname);
          return (
            <Text key={p.nickname} inverse={selected} dimColor={!p.alive}>
              {selected ? `${pointer} ` : '  '}{p.nickname}{p.nickname === you ? ' (나)' : ''}
              {p.alive ? '  생존' : `  탈락 (${p.role === undefined ? '' : ROLE_LABELS[p.role]})`}
              {/* 살아 있는 사람의 역할은 서버가 마피아에게 동료 마피아만 알려준다. */}
              {p.alive && p.role === 'mafia' && p.nickname !== you && <Text color="red"> [동료 마피아]</Text>}
              {!isNight && voted.includes(p.nickname) && (
                <Text color="green">
                  {'  '}
                  {theme.unicode ? '✓' : 'v'} 투표 완료
                </Text>
              )}
              {comrades.length > 0 && (
                <Text color="red">
                  {'  '}
                  {theme.unicode ? '←' : '<-'} 동료 {comrades.join(', ')} 조준
                </Text>
              )}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        {canAct ? <Text dimColor>{theme.unicode ? '↑↓' : '위/아래'} 대상 선택{sep(theme)}Enter 확정</Text> : <Text dimColor>{v.hasActed ? '행동을 완료했습니다. 다른 플레이어를 기다리는 중입니다.' : '다른 플레이어를 기다리는 중입니다.'}</Text>}
      </Box>
      {v.investigationResult !== undefined && <Text color="yellow">조사 결과: {v.investigationResult}</Text>}
    </Box>
  );
}
