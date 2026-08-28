import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { YachtCategory } from '@card-night/core';
import { renderDice } from '../../art/dice.js';
import { displayWidth } from '../../art/width.js';
import type { GameViewProps } from './types.js';

/** 13칸의 고정 표시 순서와 브리프가 지정한 한글 라벨. core의 CATEGORY_LABELS(이벤트 로그용
 * 짧은 문구)와는 다른, 화면 표에 쓰는 라벨이다. */
const CATEGORY_ORDER: YachtCategory[] = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yacht',
  'chance',
];

const CATEGORY_LABELS: Record<YachtCategory, string> = {
  ones: '1(에이스)',
  twos: '2',
  threes: '3',
  fours: '4',
  fives: '5',
  sixes: '6',
  threeKind: '트리플',
  fourKind: '포카드',
  fullHouse: '풀하우스',
  smallStraight: 'S.스트레이트',
  largeStraight: 'L.스트레이트',
  yacht: '야추!',
  chance: '찬스',
};

interface YachtPlayerView {
  nickname: string;
  sheet: Partial<Record<YachtCategory, number>>;
  upperTotal: number;
  bonus: number;
  total: number;
  isTurn: boolean;
}

interface YachtGameView {
  phase: 'turn';
  yourActions: string[];
  turnPlayer: string | null;
  dice: number[];
  held: boolean[];
  rollsLeft: number;
  players: YachtPlayerView[];
}

/** 표시 폭(한글 2칼럼) 기준으로 오른쪽 공백을 채운다 — 닉네임/라벨 열 정렬에 쓴다. */
function padDisplay(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - displayWidth(str)));
}

/**
 * 야추 게임 화면. dice/held/rollsLeft는 "현재 턴 플레이어"의 것이지 나만의 것이 아니다 —
 * 내 턴인지는 오직 yourActions가 비어 있는지로 판단한다(엔진은 내 턴일 때만
 * toggleHold/score를 채워 넣는다).
 */
export function YachtView({ view, you, send, theme }: GameViewProps): React.JSX.Element {
  const v = view as unknown as YachtGameView;
  const actions = v.yourActions;
  const isYourTurn = actions.length > 0;
  const canReroll = actions.includes('reroll');
  const canScore = actions.includes('score');

  const [selecting, setSelecting] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!isYourTurn) setSelecting(false);
  }, [isYourTurn]);

  const mySheet = v.players.find((p) => p.nickname === you)?.sheet ?? {};
  const unscored = CATEGORY_ORDER.filter((c) => !(c in mySheet));

  useInput((input, key) => {
    if (!isYourTurn) return;

    if (selecting) {
      if (key.upArrow) {
        setCursor((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setCursor((i) => Math.min(unscored.length - 1, i + 1));
      } else if (key.return) {
        const cat = unscored[Math.min(cursor, unscored.length - 1)];
        if (canScore && cat !== undefined) {
          send('score', cat);
          setSelecting(false);
        }
      } else if (input === 'c') {
        setSelecting(false);
      }
      return;
    }

    if (input >= '1' && input <= '5') {
      if (actions.includes('toggleHold')) send('toggleHold', Number(input) - 1);
    } else if (input === 'r') {
      if (canReroll) send('reroll');
    } else if (input === 'c') {
      if (canScore) {
        setCursor(0);
        setSelecting(true);
      }
    }
  });

  const safeCursor = Math.min(cursor, Math.max(0, unscored.length - 1));
  const cursorCat = selecting ? unscored[safeCursor] : undefined;

  const nameWidth = Math.max(4, ...v.players.map((p) => displayWidth(p.nickname) + (p.isTurn ? 2 : 0)));
  const labelWidth = Math.max(...Object.values(CATEGORY_LABELS).map(displayWidth), 4);

  function scoreCell(p: YachtPlayerView, cat: YachtCategory): string {
    const score = p.sheet[cat];
    return score === undefined ? '-' : String(score);
  }

  function playerHeader(p: YachtPlayerView): string {
    const name = `${p.isTurn ? '▶' : ' '}${p.nickname}${p.nickname === you ? '*' : ''}`;
    return padDisplay(name, nameWidth);
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Box flexDirection="column" marginRight={2}>
          {renderDice(v.dice, v.held, theme).map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
          <Text>남은 굴림: {v.rollsLeft}회</Text>
          {v.turnPlayer !== null && <Text dimColor>{v.turnPlayer}님의 차례</Text>}
        </Box>

        <Box flexDirection="column">
          <Text>
            {padDisplay('', labelWidth)} {v.players.map(playerHeader).join(' ')}
          </Text>
          {CATEGORY_ORDER.map((cat) => {
            const isCursorRow = cursorCat === cat;
            return (
              <Text key={cat} bold={isCursorRow}>
                {isCursorRow ? '▶' : ' '}
                {padDisplay(CATEGORY_LABELS[cat], labelWidth - 1)}{' '}
                {v.players.map((p) => padDisplay(scoreCell(p, cat), nameWidth)).join(' ')}
              </Text>
            );
          })}
          <Text dimColor>
            {padDisplay('소계', labelWidth)} {v.players.map((p) => padDisplay(String(p.upperTotal), nameWidth)).join(' ')}
          </Text>
          <Text dimColor>
            {padDisplay('보너스', labelWidth)} {v.players.map((p) => padDisplay(String(p.bonus), nameWidth)).join(' ')}
          </Text>
          <Text bold>
            {padDisplay('총점', labelWidth)} {v.players.map((p) => padDisplay(String(p.total), nameWidth)).join(' ')}
          </Text>
        </Box>
      </Box>

      {selecting && (
        <Box marginTop={1}>
          <Text>카테고리 선택: ↑↓ 이동, Enter 확정, c 취소</Text>
        </Box>
      )}
    </Box>
  );
}
