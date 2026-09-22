import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import { cursorGlyph, sep } from './glyphs.js';
import type { GameViewProps } from './types.js';

interface LiarViewState {
  yourActions: string[];
  yourWord: string;
  players: string[];
  hasVoted: boolean;
  /** 투표를 마친 사람. 이 필드가 없던 옛 서버와 붙으면 undefined다. */
  voted?: string[];
}

/** 엔진은 라이어에게 제시어 대신 이 문구로 시작하는 안내를 보낸다. */
const LIAR_PREFIX = '라이어';

export function LiarView({ view, you, send, theme }: GameViewProps): React.JSX.Element {
  const v = view as unknown as LiarViewState;
  const targets = v.players.filter((player) => player !== you);
  const [cursor, setCursor] = useState(0);
  const canVote = v.yourActions.includes('vote');
  const voted = v.voted ?? [];
  const isLiar = v.yourWord.startsWith(LIAR_PREFIX);
  useEffect(() => setCursor((current) => Math.min(current, Math.max(0, targets.length - 1))), [targets.length]);
  useScreenInput((_input, key) => {
    if (!canVote) return;
    if (key.upArrow) setCursor((current) => (current - 1 + targets.length) % targets.length);
    else if (key.downArrow) setCursor((current) => (current + 1) % targets.length);
    else if (key.return && targets[cursor] !== undefined) send('vote', targets[cursor]);
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* 제시어는 이 게임에서 가장 중요한 정보라 테두리 상자로 크게 보여준다. */}
      <Box borderStyle={theme.unicode ? 'round' : 'classic'} borderColor={isLiar ? 'red' : 'cyan'} paddingX={2} alignSelf="flex-start">
        {isLiar ? (
          <Text bold color="red">
            당신은 라이어입니다. 제시어: ???
          </Text>
        ) : (
          <Text bold>
            제시어: <Text color="cyan">{v.yourWord}</Text>
          </Text>
        )}
      </Box>
      <Text dimColor>
        서로 대화한 뒤 라이어라고 생각하는 사람에게 투표하세요.{sep(theme)}투표 {voted.length}/{v.players.length}명
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {v.players.map((player) => {
          const index = targets.indexOf(player);
          const selected = canVote && index === cursor;
          return (
            <Text key={player} inverse={selected}>
              {selected ? `${cursorGlyph(theme)} ` : '  '}
              {player}
              {player === you ? ' (나)' : ''}
              {voted.includes(player) && (
                <Text color="green">
                  {'  '}
                  {theme.unicode ? '✓' : 'v'} 투표 완료
                </Text>
              )}
            </Text>
          );
        })}
      </Box>
      <Text dimColor>
        {canVote
          ? `${theme.unicode ? '↑↓' : '위/아래'} 선택${sep(theme)}Enter 투표`
          : v.hasVoted
            ? '투표 완료. 다른 참가자를 기다리는 중입니다.'
            : '다른 참가자를 기다리는 중입니다.'}
      </Text>
    </Box>
  );
}
