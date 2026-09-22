import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import type { YachtCategory } from '@soft-puzzle/core';
import { scoreCategory } from '@soft-puzzle/core';
import { renderDice } from '../../art/dice.js';
import { displayWidth, truncateDisplay } from '../../art/width.js';
import { cursorGlyph } from './glyphs.js';
import { useFocusBroadcast } from '../focus.js';
import { randomFace, useRollAnimation } from '../rollAnimation.js';
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
 * 점수표 닉네임의 표시 폭 상한. 서버(Room)는 닉네임을 최대 32자(표시 폭 최대 64칼럼)까지
 * 허용하는데, 점수표는 최대 인원(MAX_PLAYERS=6)에서도 터미널 폭 안에 들어와야 한다 —
 * 리뷰에서 3인 80칼럼·6인 100칼럼 모두 표가 깨지는 것으로 실측됐다. 닉네임 표시 폭에
 * 상한을 두는 것이 그 1차 방어선이다.
 */
const NICK_DISPLAY_CAP = 8;

/** "이게 나다" 표시 — 블랙잭·원카드와 같은 표기로 통일한다(리뷰 지적: 야추만 '*'를 썼다). */
const YOU_SUFFIX = ' (나)';

/** 턴마다 첫 굴림 뒤 리롤할 수 있는 횟수. 엔진이 턴 시작에 한 번 굴린 뒤 rollsLeft=2로 둔다. */
const MAX_REROLLS = 2;

/** 남은 굴림을 ●●○처럼 점으로 그린다(ascii는 [##-]). */
function rollPips(rollsLeft: number, theme: GameViewProps['theme']): string {
  const total = Math.max(MAX_REROLLS, rollsLeft);
  const left = Math.max(0, rollsLeft);
  if (theme.unicode) return '●'.repeat(left) + '○'.repeat(total - left);
  return `[${'#'.repeat(left)}${'-'.repeat(total - left)}]`;
}

/**
 * 야추 게임 화면. dice/held/rollsLeft는 "현재 턴 플레이어"의 것이지 나만의 것이 아니다 —
 * 내 턴인지는 오직 yourActions가 비어 있는지로 판단한다(엔진은 내 턴일 때만
 * toggleHold/score를 채워 넣는다).
 */
export function YachtView({ view, you, send, theme, focus, sendFocus }: GameViewProps): React.JSX.Element {
  const v = view as unknown as YachtGameView;
  const actions = v.yourActions;
  const isYourTurn = actions.length > 0;
  const canReroll = actions.includes('reroll');
  const canScore = actions.includes('score');
  const canHold = actions.includes('toggleHold');

  const [selecting, setSelecting] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!isYourTurn) setSelecting(false);
  }, [isYourTurn]);

  const mySheet = v.players.find((p) => p.nickname === you)?.sheet ?? {};
  const unscored = CATEGORY_ORDER.filter((c) => !(c in mySheet));

  // 새로 굴린 주사위는 잠깐 굴리다가 결과에서 멈춘다. 굴림은 턴마다(차례·기록한 칸 수) 그리고 리롤마다
  // (남은 굴림) 바뀌므로 그 조합으로 "던지기 한 번"을 구분한다.
  const filled = v.players.reduce((n, p) => n + Object.keys(p.sheet).length, 0);
  const { rolling } = useRollAnimation(`${v.turnPlayer}:${v.rollsLeft}:${filled}`);
  const shownDice = rolling ? v.dice.map((d, i) => (v.held[i] ? d : randomFace())) : v.dice;

  useScreenInput((input, key) => {
    // 굴리는 동안에는 아직 보이지 않는 결과로 행동하지 않게 입력을 받지 않는다.
    if (!isYourTurn || rolling) return;

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
      } else if (key.escape) {
        // 취소 키는 Esc로 세 화면 전체에서 통일한다(리뷰 지적: 예전엔 야추만 c로 취소했다).
        setSelecting(false);
      }
      return;
    }

    if (input >= '1' && input <= '5') {
      if (canHold) send('toggleHold', Number(input) - 1);
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
  useFocusBroadcast(sendFocus, cursorCat !== undefined ? { category: cursorCat } : null, view);

  // 차례인 다른 사람이 점수 칸 선택 모드에서 보고 있는 칸.
  const focusCategory = ((): YachtCategory | undefined => {
    if (v.turnPlayer === null || v.turnPlayer === you) return undefined;
    const category = (focus?.[v.turnPlayer] as { category?: unknown } | undefined)?.category;
    return typeof category === 'string' && (CATEGORY_ORDER as string[]).includes(category)
      ? (category as YachtCategory)
      : undefined;
  })();

  // 턴/커서 마커는 블랙잭·원카드와 같은 ◀(ascii: <)로 통일한다(리뷰 지적: 예전엔 야추만
  // ▶를 썼다). 이 화면에서는 "누구 턴인지"(헤더)와 "카테고리 선택 커서"(행) 두 곳에 쓴다.
  const turnGlyph = theme.unicode ? '◀' : '<';

  function fitNick(nick: string): string {
    return truncateDisplay(nick, NICK_DISPLAY_CAP);
  }

  // 각 플레이어 칸의 폭은 그 플레이어 자신의 내용(커서 1칸 + 잘라낸 닉네임 + 본인이면
  // ' (나)')만으로 정한다 — 리뷰 실측 중 발견: 처음엔 전원에게 같은 폭(전체 중 최댓값)을
  // 썼는데, 그러면 플레이어 한 명의 닉네임이 길 때(설령 8칸으로 잘렸어도 ' (나)'가 붙는
  // "나"라면) 그 폭이 나머지 5개 칸에도 그대로 강제되어 6인 표가 순식간에 100칼럼을
  // 넘겼다. 칸마다 자기 몫만 쓰게 하면 긴 닉네임 하나가 표 전체를 부풀리지 않는다.
  function colWidth(p: YachtPlayerView): number {
    return Math.max(
      4,
      1 + displayWidth(fitNick(p.nickname)) + (p.nickname === you ? displayWidth(YOU_SUFFIX) : 0),
    );
  }

  // 리뷰 지적(회귀): 예전엔 카테고리 행이 padDisplay(label, labelWidth - 1)로 패딩해 12칼럼
  // 라벨(S.스트레이트/L.스트레이트)이 정확히 한 칸 넘쳐 그 뒤 모든 칸이 밀렸다. 이제는
  // 모든 행(헤더·카테고리·소계/보너스/총점)이 "커서 1칸 + 라벨을 labelWidth로 패딩 + 구분
  // 공백 1칸"이라는 같은 함수(rowLine)로만 만들어져 라벨 길이와 무관하게 폭이 고정된다.
  const labelWidth = Math.max(...Object.values(CATEGORY_LABELS).map(displayWidth), 4);

  function rowLine(marker: string, label: string, cells: string): string {
    return `${marker}${padDisplay(label, labelWidth)} ${cells}`;
  }

  // 주사위는 모두에게 공개된 "차례인 사람"의 것이므로, 그 사람의 빈 칸에만 지금 주사위로 받을
  // 점수를 미리 보여준다(누가 보든 같다). 기록된 점수와 헷갈리지 않게 괄호로 감싸고 흐리게 그린다
  // — 색이 없는 터미널에서도 괄호로 구분된다. 칸 최소 폭이 4라 최대 점수 (50)도 들어간다.
  // 굴리는 중에는 결과가 정해지기 전처럼 보여야 하므로 미리보기를 숨긴다.
  const diceReady = !rolling && v.dice.length === 5 && v.dice.every((d) => d >= 1 && d <= 6);

  function scoreCell(p: YachtPlayerView, cat: YachtCategory): { text: string; preview: boolean } {
    const score = p.sheet[cat];
    if (score !== undefined) return { text: String(score), preview: false };
    if (p.isTurn && diceReady) return { text: `(${scoreCategory(v.dice, cat)})`, preview: true };
    return { text: '-', preview: false };
  }

  function playerHeader(p: YachtPlayerView): string {
    const name = `${p.isTurn ? turnGlyph : ' '}${fitNick(p.nickname)}${p.nickname === you ? YOU_SUFFIX : ''}`;
    return padDisplay(name, colWidth(p));
  }

  const headerCells = v.players.map(playerHeader).join(' ');

  return (
    <Box flexDirection="column">
      <Box>
        {/* 점수표(flexShrink=0, 아래)가 폭을 다 못 채우면 이 칸이 대신 줄어든다. wrap
         * "truncate-end"가 없으면 Ink가 각 줄을 여러 줄로 접어(reflow) 주사위 아트가
         * 대각선으로 흩어지는 형태가 된다 — 한 줄로 유지하고 넘치는 부분만 자르는 편이
         * 훨씬 덜 깨져 보인다. */}
        <Box flexDirection="column" marginRight={2} flexShrink={1}>
          {renderDice(shownDice, v.held, theme).map((line, i) => (
            <Text key={i} wrap="truncate-end">
              {line}
            </Text>
          ))}
          <Text wrap="truncate-end">
            {rolling ? `굴리는 중${theme.unicode ? '…' : '...'}` : `남은 굴림: ${rollPips(v.rollsLeft, theme)} ${v.rollsLeft}회`}
          </Text>
          {v.turnPlayer !== null && (
            <Text dimColor wrap="truncate-end">
              {v.turnPlayer}님의 차례
            </Text>
          )}
          {/* 왼쪽 칸은 8줄, 점수표는 17줄이라 한 줄 늘어도 전체 높이는 그대로다. */}
          {focusCategory !== undefined && v.turnPlayer !== null && (
            <Text color="yellow" wrap="truncate-end">
              {v.turnPlayer}님이 {CATEGORY_LABELS[focusCategory]} 칸을 고민 중
            </Text>
          )}
        </Box>

        {/* 점수표는 절대 압축되면 안 된다 — flexShrink 기본값(1)대로 두면 터미널 폭이
         * 모자랄 때 Yoga가 이 칸을 줄이고, 그러면 각 Text가 자기 칸 폭에 맞춰 줄바꿈되며
         * 표 전체가 행 사이에 빈 줄이 끼는 식으로 깨진다(리뷰 실측: 3인 80칼럼, 6인
         * 100칼럼). 압축이 필요하면 대신 왼쪽 주사위 칸이 줄어들게 한다. */}
        <Box flexDirection="column" flexShrink={0}>
          <Text>{rowLine(' ', '', headerCells)}</Text>
          {CATEGORY_ORDER.map((cat) => {
            const isCursorRow = cursorCat === cat;
            const isFocusRow = focusCategory === cat;
            return (
              <Text key={cat} bold={isCursorRow || isFocusRow}>
                {rowLine(isCursorRow ? turnGlyph : isFocusRow ? cursorGlyph(theme) : ' ', CATEGORY_LABELS[cat], '')}
                {v.players.map((p, i) => {
                  const cell = scoreCell(p, cat);
                  return (
                    <Text key={p.nickname} dimColor={cell.preview}>
                      {i > 0 ? ' ' : ''}
                      {padDisplay(cell.text, colWidth(p))}
                    </Text>
                  );
                })}
              </Text>
            );
          })}
          <Text dimColor>
            {rowLine(' ', '소계', v.players.map((p) => padDisplay(String(p.upperTotal), colWidth(p))).join(' '))}
          </Text>
          <Text dimColor>
            {rowLine(' ', '보너스', v.players.map((p) => padDisplay(String(p.bonus), colWidth(p))).join(' '))}
          </Text>
          <Text bold>
            {rowLine(' ', '총점', v.players.map((p) => padDisplay(String(p.total), colWidth(p))).join(' '))}
          </Text>
        </Box>
      </Box>

      {/* ActionBar가 [1-5] 홀드/[r] 리롤/[c] 점수 기록을 한 칸씩 보여주지만, 1~5가 각각
       * "몇 번 주사위"인지·c가 무엇을 여는지는 여기서 한 번 더 풀어서 설명한다 —
       * yourActions에 실제로 있는 것만(요구사항 1). */}
      {!selecting && isYourTurn && (
        <Box marginTop={1}>
          <Text dimColor>
            {[
              canHold && '1~5 주사위 홀드 전환',
              canReroll && 'r 리롤',
              canScore && 'c 점수 카테고리 선택',
            ]
              .filter((s): s is string => typeof s === 'string')
              .join('  ')}
          </Text>
        </Box>
      )}

      {selecting && (
        <Box marginTop={1}>
          <Text>카테고리 선택: {theme.unicode ? '↑↓' : '위/아래'} 이동, Enter 확정, Esc 취소</Text>
        </Box>
      )}
    </Box>
  );
}
