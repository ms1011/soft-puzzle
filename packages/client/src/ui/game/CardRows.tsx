import React from 'react';
import { Text } from 'ink';
import type { CardSegment } from '../../art/cards.js';

/**
 * renderHandSegments(또는 같은 모양의 조각)를 줄마다 그린다. 빨간 카드 조각은 red로, 나머지는
 * color(주로 "나"를 뜻하는 cyan, 없으면 기본색)로 칠한다. dim인 조각은 흐리게 — 원카드의
 * "낼 수 없는 카드" 힌트, 인디언 포커의 폴드 좌석처럼 카드 단위로 흐려야 할 때 쓴다.
 */
export function CardRows({
  rows,
  color,
  bold,
}: {
  rows: (CardSegment & { dim?: boolean })[][];
  color?: string;
  bold?: boolean;
}): React.JSX.Element {
  return (
    <>
      {rows.map((row, r) => (
        <Text key={r} bold={bold}>
          {row.map((seg, i) => (
            <Text key={i} color={seg.red ? 'red' : color} dimColor={seg.dim === true}>
              {seg.text}
            </Text>
          ))}
        </Text>
      ))}
    </>
  );
}
