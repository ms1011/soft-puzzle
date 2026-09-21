import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { GameViewProps } from './types.js';

interface MafiaPlayer {
  nickname: string;
  alive: boolean;
  role?: 'mafia' | 'citizen';
}

interface MafiaGameView {
  phase: 'night' | 'day' | 'result';
  yourActions: string[];
  yourRole: 'mafia' | 'citizen';
  phaseLabel: string;
  alive: MafiaPlayer[];
  hasVoted: boolean;
}

/** 마피아는 역할과 생존 여부가 핵심이라, 카드 아트 대신 투표 대상 선택을 크게 보여준다. */
export function MafiaView({ view, you, send, theme }: GameViewProps): React.JSX.Element {
  const v = view as unknown as MafiaGameView;
  const canVote = v.yourActions.includes('vote');
  const targets = v.alive.filter((p) => p.alive && p.nickname !== you);
  const [cursor, setCursor] = useState(0);

  useEffect(() => setCursor((i) => Math.min(i, Math.max(0, targets.length - 1))), [targets.length, canVote]);

  useInput((_input, key) => {
    if (!canVote || targets.length === 0) return;
    if (key.upArrow) setCursor((i) => (i - 1 + targets.length) % targets.length);
    else if (key.downArrow) setCursor((i) => (i + 1) % targets.length);
    else if (key.return) {
      const target = targets[cursor];
      if (target) send('vote', target.nickname);
    }
  });

  const roleLabel = v.yourRole === 'mafia' ? '마피아' : '시민';
  const phaseText = v.phase === 'night'
    ? (v.yourRole === 'mafia' ? '밤: 처치할 대상을 고르세요.' : '밤: 마피아의 선택을 기다리는 중입니다.')
    : '낮: 탈락시킬 사람에게 투표하세요.';
  const pointer = theme.unicode ? '▶' : '>';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={v.yourRole === 'mafia' ? 'red' : 'cyan'}>
        내 역할: {roleLabel}
      </Text>
      <Text bold>{v.phaseLabel} — {phaseText}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>참가자</Text>
        {v.alive.map((p) => {
          const targetIndex = targets.findIndex((target) => target.nickname === p.nickname);
          const selected = canVote && targetIndex === cursor;
          return (
            <Text key={p.nickname} inverse={selected} dimColor={!p.alive}>
              {selected ? `${pointer} ` : '  '}{p.nickname}{p.nickname === you ? ' (나)' : ''}
              {p.alive ? '  생존' : `  탈락 (${p.role === 'mafia' ? '마피아' : '시민'})`}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        {canVote ? <Text dimColor>↑↓ 대상 선택 · Enter 투표</Text> : <Text dimColor>{v.hasVoted ? '투표를 완료했습니다. 다른 플레이어를 기다리는 중입니다.' : '다른 플레이어를 기다리는 중입니다.'}</Text>}
      </Box>
    </Box>
  );
}
