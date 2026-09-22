import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useScreenInput } from '../inputLock.js';
import { lasVegasPayout } from '@soft-puzzle/core';
import { useFocusBroadcast } from '../focus.js';
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
/** 카지노 칸 안 닉네임 표시 폭 상한 — " 닉네임 개수 $90k"(1+5+1+1+1+4=13)가 칸 안에 들어가야 한다. */
const CASINO_NICK_CAP = 5;
/**
 * 다른 플레이어 색(참가 순서대로). "나"는 다른 화면들과 같이 cyan이고, 노랑·자홍은 각각 내 선택과
 * 다른 사람이 고민 중인 선택의 미리보기 강조에 쓰므로 여기서 뺀다.
 */
const OTHER_COLORS = ['green', 'blue', 'red', 'white', 'gray'];
/** 플레이어 줄의 닉네임 표시 폭 상한. */
const PLAYER_NICK_CAP = 12;
const YOU_SUFFIX = ' (나)';

/** 천 달러 단위 금액을 `$60,000`로 적는다(엔진의 formatMoney와 같은 표기). */
function money(thousands: number): string {
  return '$' + String(Math.round(thousands * 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 카지노 칸에 들어가는 짧은 금액 표기(`$60k`). 지폐는 $10k~$90k라 항상 4칸이다. */
function shortMoney(thousands: number): string {
  return `$${thousands}k`;
}

interface Standing {
  nickname: string;
  count: number;
  /** 지금 정산하면 받는 지폐(천 달러). 동수로 무효거나 순위 밖이면 undefined. */
  bill?: number;
  tied: boolean;
}

/**
 * 카지노 한 곳을 지금 정산하면 누가 무엇을 받는지. 규칙은 엔진의 정산 함수(lasVegasPayout)를 그대로
 * 써서 화면과 실제 정산이 어긋나지 않게 한다. extra가 있으면 그 사람이 주사위를 더 건 뒤의 결과다.
 */
function standings(c: LasVegasCasino, extra?: { nickname: string; count: number }): Standing[] {
  const counts = c.dice.filter((d) => d.count > 0).map((d) => ({ ...d }));
  if (extra !== undefined) {
    const mine = counts.find((d) => d.nickname === extra.nickname);
    if (mine) mine.count += extra.count;
    else counts.push({ ...extra });
  }
  const awards = new Map(lasVegasPayout(c.bills, counts).map((a) => [a.nickname, a.bill]));
  const freq = new Map<number, number>();
  for (const d of counts) freq.set(d.count, (freq.get(d.count) ?? 0) + 1);
  return counts
    .sort((a, b) => b.count - a.count)
    .map((d) => ({ nickname: d.nickname, count: d.count, bill: awards.get(d.nickname), tied: (freq.get(d.count) ?? 0) > 1 }));
}

function totalDice(c: LasVegasCasino): number {
  return c.dice.reduce((sum, d) => sum + d.count, 0);
}

/** 가진 돈 순(같으면 지폐 수 순, 엔진 최종 순위와 같은 기준)으로 세우고 공동 순위를 매긴다. */
function ranked(players: LasVegasPlayer[]): (LasVegasPlayer & { rank: number })[] {
  const sorted = [...players].sort((a, b) => b.money - a.money || (b.bills ?? 0) - (a.bills ?? 0));
  return sorted.map((p, i) => {
    const firstSame = sorted.findIndex((q) => q.money === p.money && (q.bills ?? 0) === (p.bills ?? 0));
    return { ...p, rank: (firstSame === -1 ? i : firstSame) + 1 };
  });
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
export function LasVegasView({ view, you, send, theme, focus, sendFocus }: GameViewProps): React.JSX.Element {
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

  useFocusBroadcast(sendFocus, canPlace && face !== undefined ? { face } : null, view);
  // 차례인 다른 사람이 고민 중인 눈 — 내 차례의 선택과 같은 방식으로 카지노에 미리 반영해 보여준다.
  const theirFace = ((): number | undefined => {
    if (canPlace || v.turnPlayer === null || v.turnPlayer === you) return undefined;
    const f = (focus?.[v.turnPlayer] as { face?: unknown } | undefined)?.face;
    return typeof f === 'number' && faces.includes(f) ? f : undefined;
  })();
  const highlight = canPlace ? face : theirFace;
  /** 지금 미리보기 중인 사람(나 또는 차례인 다른 사람). */
  const placer = canPlace ? you : theirFace !== undefined ? v.turnPlayer! : undefined;
  const previewColor = canPlace ? 'yellow' : 'magenta';
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

  // 고른 눈(내 선택 또는 차례인 사람이 고민 중인 눈)을 걸면 그 카지노에 놓일 주사위 수 — 그 카지노만
  // 건 뒤의 결과로 미리 보여준다.
  const placing = highlight !== undefined && placer !== undefined ? { nickname: placer, count: dice.filter((d) => d === highlight).length } : undefined;
  const standingsOf = new Map(v.casinos.map((c) => [c.number, standings(c, c.number === highlight ? placing : undefined)]));
  const maxEntries = Math.max(1, ...[...standingsOf.values()].map((s) => s.length));

  // 다른 플레이어마다 고정 색 — 카지노 칸에서 닉네임을 읽지 않아도 누구 주사위인지 보인다.
  const colorOf = new Map(v.players.filter((p) => p.nickname !== you).map((p, i) => [p.nickname, OTHER_COLORS[i % OTHER_COLORS.length]!]));
  colorOf.set(you, 'cyan');

  /** 미리보기 문장: 고른 눈을 걸면 나는 무엇을 받게 되는가. */
  function previewText(): string | undefined {
    if (highlight === undefined || placing === undefined) return undefined;
    const mine = standingsOf.get(highlight)?.find((s) => s.nickname === you);
    if (mine === undefined) return undefined;
    const head = `${highlight}번에 ${placing.count}개 걸면 ${theme.unicode ? '→' : '->'} `;
    if (mine.bill !== undefined) return head + money(mine.bill);
    if (mine.tied) {
      const rivals = (standingsOf.get(highlight) ?? []).filter((s) => s.count === mine.count && s.nickname !== you).map((s) => fitNick(s.nickname, CASINO_NICK_CAP));
      return `${head}무효 (${rivals.join(theme.unicode ? '·' : ', ')}와 동수)`;
    }
    return `${head}받지 못함`;
  }

  /** 다른 사람이 고민 중인 선택을 한 문장으로. 그 선택으로 내가 받을 지폐가 사라지면 경고를 붙인다. */
  function theirsText(): string | undefined {
    if (canPlace || theirFace === undefined || placing === undefined) return undefined;
    const casino = v.casinos.find((c) => c.number === theirFace);
    const before = casino ? standings(casino).find((s) => s.nickname === you)?.bill : undefined;
    const after = standingsOf.get(theirFace)?.find((s) => s.nickname === you)?.bill;
    const threat = before !== undefined && after === undefined ? ` (걸면 내 ${shortMoney(before)}가 사라집니다)` : '';
    return `${fitNick(placing.nickname, PLAYER_NICK_CAP)}님이 ${theirFace}번에 ${placing.count}개 걸기를 고민 중${threat}`;
  }

  /** 지난 라운드 정산을 카지노별로 한 줄에 — 사람별 합계만으로는 어디서 무엇을 받았는지 사라진다. */
  function lastPayoutText(): string | undefined {
    const paid = (v.lastPayout ?? []).filter((p) => p.awards.length > 0);
    if (paid.length === 0) return undefined;
    const who = (nick: string): string => (nick === you ? '(나)' : fitNick(nick, CASINO_NICK_CAP));
    return `지난 정산: ${paid
      .map((p) => `${p.casino}번 ${p.awards.map((a) => `${who(a.nickname)} ${shortMoney(a.bill)}`).join(', ')}`)
      .join(sep(theme))}`;
  }

  function casinoColumn(c: LasVegasCasino): React.JSX.Element {
    const isSel = c.number === highlight;
    const entries = standingsOf.get(c.number) ?? [];
    const marker = isSel ? (theme.unicode ? '▶' : '>') : ' ';
    return (
      <Box key={c.number} flexDirection="column" width={CASINO_COL} flexShrink={0}>
        <Text bold={isSel} color={isSel ? previewColor : undefined}>
          {marker}
          {`${c.number}번`}
          {/* 카지노 번호가 곧 주사위 눈이라 [n]은 중복이다 — 대신 그 칸에 놓인 주사위 총수를 보여준다. */}
          {totalDice(c) > 0 ? ` ${totalDice(c)}개` : ''}
          {isSel && placing !== undefined ? ` +${placing.count}` : ''}
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
          // 같은 개수가 둘 이상이면 정산 때 무효 — 흐리게 그리고 '무효'라고 적는다.
          const outcome = e.bill !== undefined ? ` ${shortMoney(e.bill)}` : e.tied ? ' 무효' : '';
          // 미리보기 중인 내 줄은 노랑으로 — 아직 건 게 아니라 "걸면 이렇게 된다"는 뜻이다.
          const color = isYou && isSel && canPlace ? 'yellow' : colorOf.get(e.nickname);
          return (
            <Text key={`d${i}`} dimColor={e.tied} color={color} bold={isYou}>
              {' '}
              {padDisplay(name, CASINO_NICK_CAP)} {e.count}
              {outcome}
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
      {lastPayoutText() !== undefined && (
        <Text dimColor wrap="truncate-end">
          {lastPayoutText()}
        </Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        {ranked(v.players).map((p) => {
          const isYou = p.nickname === you;
          const name = `${p.isTurn ? turnGlyph(theme) : ' '} ${p.rank}위 ${padDisplay(
            fitNick(p.nickname, PLAYER_NICK_CAP) + (isYou ? YOU_SUFFIX : ''),
            nickWidth,
          )}`;
          const won = lastWon.get(p.nickname);
          return (
            <Text key={p.nickname} bold={p.isTurn} color={colorOf.get(p.nickname)} wrap="truncate-end">
              {name} {padDisplay(money(p.money), 10)} 주사위 {p.diceLeft}개
              {p.bills !== undefined ? `${sep(theme)}지폐 ${p.bills}장` : ''}
              {won !== undefined ? `${sep(theme)}지난 라운드 +${money(won)}` : ''}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        {/* 미리보기 문장을 안내 줄 앞에 둔다 — 줄을 늘리지 않고, 좁으면 키 안내부터 잘린다. */}
        <Text wrap="truncate-end">
          {theirsText() !== undefined && (
            <Text bold color="magenta">
              {theirsText()}
              {'  '}
            </Text>
          )}
          {canPlace && previewText() !== undefined && (
            <Text bold color="yellow">
              {previewText()}
              {'  '}
            </Text>
          )}
          <Text dimColor>
            {canPlace
              ? `${theme.unicode ? '←/→' : '좌/우'} 또는 1~6 눈 선택${sep(theme)}Enter 걸기`
              : '다른 사람이 주사위를 거는 중입니다. 같은 개수는 정산 때 무효입니다.'}
          </Text>
        </Text>
      </Box>
    </Box>
  );
}
