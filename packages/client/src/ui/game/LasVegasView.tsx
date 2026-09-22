import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import { renderDie } from '../../art/dice.js';
import { displayWidth, truncateDisplay } from '../../art/width.js';
import { sep, turnGlyph } from './glyphs.js';
import type { GameViewProps } from './types.js';

interface LasVegasCasino {
  number: number;
  bills: number[];
  dice: { nickname: string; count: number }[];
}

interface LasVegasPlayer {
  nickname: string;
  diceLeft: number;
  money: number;
  bills?: number;
  isTurn: boolean;
}

interface LasVegasGameView {
  phase: 'place';
  yourActions: string[];
  round: number;
  totalRounds: number;
  turnPlayer: string | null;
  dice: number[];
  casinos: LasVegasCasino[];
  players: LasVegasPlayer[];
  lastPayout?: { casino: number; awards: { nickname: string; bill: number }[] }[] | null;
}

/** 카지노 한 칸의 폭(구분 공백 포함). 6곳 × 13 = 78칼럼이라 80칼럼 터미널에 한 줄로 들어간다. */
const CASINO_COL = 13;
/** 카지노 칸 안 닉네임 표시 폭 상한 — "닉네임 + 공백 + 개수"가 칸 안에 들어가야 한다. */
const CASINO_NICK_CAP = 8;
/** 플레이어 줄의 닉네임 표시 폭 상한. */
const PLAYER_NICK_CAP = 12;
const YOU_SUFFIX = ' (나)';

/** 천 달러 단위 금액을 `$60,000`로 적는다(엔진의 formatMoney와 같은 표기). */
function money(thousands: number): string {
  return '$' + String(Math.round(thousands * 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function padDisplay(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - displayWidth(str)));
}

/** 굴린 주사위에 있는 눈들(오름차순, 중복 제거). */
function facesOf(dice: number[]): number[] {
  return [...new Set(dice)].filter((d) => d >= 1 && d <= 6).sort((a, b) => a - b);
}

/** 엔진 defaultAction과 같은 기준 — 가장 많이 나온 눈, 동수면 큰 눈. 선택 커서의 시작 위치다. */
function bestFace(dice: number[]): number | undefined {
  let best: number | undefined;
  let bestCount = 0;
  for (const f of facesOf(dice)) {
    const n = dice.filter((d) => d === f).length;
    if (n >= bestCount) {
      best = f;
      bestCount = n;
    }
  }
  return best;
}

/**
 * 라스베가스 게임 화면. 위에서부터 라운드/차례 헤더, 차례인 사람이 굴린 주사위(모두에게 공개),
 * 카지노 6곳(세로 칸 — 지폐 목록과 플레이어별 주사위 수), 플레이어 목록, 조작 힌트 순이다.
 * 내 턴인지는 오직 yourActions에 'place'가 있는지로 판단한다.
 */
export function LasVegasView({ view, you, send, theme }: GameViewProps): React.JSX.Element {
  const v = view as unknown as LasVegasGameView;
  const canPlace = v.yourActions.includes('place');
  const dice = [...(v.dice ?? [])].sort((a, b) => a - b);
  const faces = facesOf(dice);
  const diceKey = dice.join(',');

  const [selected, setSelected] = useState<number | undefined>(() => bestFace(dice));
  // 굴림이 바뀌면(새 턴) 선택을 가장 많이 나온 눈으로 되돌린다.
  useEffect(() => {
    setSelected(bestFace(dice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diceKey]);
  const face = selected !== undefined && faces.includes(selected) ? selected : bestFace(dice);

  useScreenInput((input, key) => {
    if (!canPlace || faces.length === 0) return;
    const i = face === undefined ? 0 : faces.indexOf(face);
    if (key.leftArrow) {
      setSelected(faces[(i - 1 + faces.length) % faces.length]);
    } else if (key.rightArrow) {
      setSelected(faces[(i + 1) % faces.length]);
    } else if (input >= '1' && input <= '6') {
      const n = Number(input);
      if (faces.includes(n)) setSelected(n);
    } else if (key.return) {
      if (face !== undefined) send('place', face);
    }
  });

  const highlight = canPlace ? face : undefined;
  const fitNick = (nick: string, cap: number): string => truncateDisplay(nick, cap);

  // 주사위 아트: 선택한 눈의 주사위는 이중선(ascii는 #) 테두리로 그린다. 8개면 79칼럼.
  const dieArts = dice.map((d) => renderDie(d as 1 | 2 | 3 | 4 | 5 | 6, d === highlight, theme));
  const diceLines: string[] = [];
  if (dieArts.length > 0) {
    for (let row = 0; row < 5; row++) diceLines.push(dieArts.map((a) => a[row]).join(' '));
    diceLines.push(
      dice
        .map((d) => {
          const label = d === highlight ? `[${d}]` : String(d);
          const pad = 9 - label.length;
          return ' '.repeat(Math.floor(pad / 2)) + label + ' '.repeat(pad - Math.floor(pad / 2));
        })
        .join(' '),
    );
  }

  const maxBills = Math.max(1, ...v.casinos.map((c) => c.bills.length));
  const maxEntries = Math.max(1, ...v.casinos.map((c) => c.dice.filter((d) => d.count > 0).length));

  function casinoColumn(c: LasVegasCasino): React.JSX.Element {
    const isSel = c.number === highlight;
    const entries = c.dice.filter((d) => d.count > 0).sort((a, b) => b.count - a.count);
    // 같은 개수가 둘 이상이면 정산 때 무효가 되므로 흐리게 보여준다.
    const freq = new Map<number, number>();
    for (const e of entries) freq.set(e.count, (freq.get(e.count) ?? 0) + 1);
    const marker = isSel ? (theme.unicode ? '▶' : '>') : ' ';
    return (
      <Box key={c.number} flexDirection="column" width={CASINO_COL} flexShrink={0}>
        <Text bold={isSel} color={isSel ? 'yellow' : undefined}>
          {marker}
          {`${c.number}번 [${c.number}]`}
        </Text>
        {Array.from({ length: maxBills }, (_, i) => (
          <Text key={`b${i}`} color="green">
            {c.bills[i] !== undefined ? ` ${money(c.bills[i]!)}` : ' '}
          </Text>
        ))}
        <Text dimColor>{theme.unicode ? ' ──────────' : ' ----------'}</Text>
        {Array.from({ length: maxEntries }, (_, i) => {
          const e = entries[i];
          if (!e) return <Text key={`d${i}`}> </Text>;
          const isYou = e.nickname === you;
          const name = isYou ? '(나)' : fitNick(e.nickname, CASINO_NICK_CAP);
          const tied = (freq.get(e.count) ?? 0) > 1;
          return (
            <Text key={`d${i}`} dimColor={tied} color={isYou ? 'cyan' : undefined} bold={isYou}>
              {' '}
              {padDisplay(name, CASINO_NICK_CAP)} {e.count}
            </Text>
          );
        })}
      </Box>
    );
  }

  const nickWidth = Math.max(
    4,
    ...v.players.map((p) => displayWidth(fitNick(p.nickname, PLAYER_NICK_CAP)) + (p.nickname === you ? displayWidth(YOU_SUFFIX) : 0)),
  );

  // 지난 라운드에 각자 받은 금액(합계) — 한 줄 요약.
  const lastWon = new Map<string, number>();
  for (const p of v.lastPayout ?? []) for (const a of p.awards) lastWon.set(a.nickname, (lastWon.get(a.nickname) ?? 0) + a.bill);

  const turnName = v.turnPlayer === null ? null : v.turnPlayer === you ? '내' : `${fitNick(v.turnPlayer, PLAYER_NICK_CAP)}님의`;

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        라운드 {v.round}/{v.totalRounds}
        {turnName !== null && `${sep(theme)}${turnName} 차례`}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {diceLines.map((line, i) => (
          <Text key={i} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>

      <Box flexDirection="row" marginTop={1}>
        {v.casinos.map(casinoColumn)}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {v.players.map((p) => {
          const isYou = p.nickname === you;
          const name = `${p.isTurn ? turnGlyph(theme) : ' '} ${padDisplay(
            fitNick(p.nickname, PLAYER_NICK_CAP) + (isYou ? YOU_SUFFIX : ''),
            nickWidth,
          )}`;
          const won = lastWon.get(p.nickname);
          return (
            <Text key={p.nickname} bold={p.isTurn} color={isYou ? 'cyan' : undefined} wrap="truncate-end">
              {name} {padDisplay(money(p.money), 10)} 주사위 {p.diceLeft}개
              {p.bills !== undefined ? `${sep(theme)}지폐 ${p.bills}장` : ''}
              {won !== undefined ? `${sep(theme)}지난 라운드 +${money(won)}` : ''}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor wrap="truncate-end">
          {canPlace
            ? `${theme.unicode ? '←/→' : '좌/우'} 또는 1~6 눈 선택${sep(theme)}Enter ${face ?? ''}번 카지노에 걸기`
            : '다른 사람이 주사위를 거는 중입니다. 같은 개수는 정산 때 무효입니다.'}
        </Text>
      </Box>
    </Box>
  );
}
