import { it, expect } from 'vitest';
import { encodeMsg, NdjsonDecoder } from '../src/ndjson.js';
it('쪼개진 청크를 이어붙여 메시지 단위로 파싱한다', () => {
  const d = new NdjsonDecoder();
  expect(d.push('{"type":"jo')).toEqual([]);
  expect(d.push('in","nickname":"철수"}\n{"type":"chat"')).toEqual([
    { type: 'join', nickname: '철수' },
  ]);
  expect(d.push(',"text":"ㄱㄱ"}\n')).toEqual([{ type: 'chat', text: 'ㄱㄱ' }]);
});
it('깨진 JSON 줄은 무시한다', () => {
  const d = new NdjsonDecoder();
  expect(d.push('not-json\n{"type":"chat","text":"hi"}\n'))
    .toEqual([{ type: 'chat', text: 'hi' }]);
});
it('encodeMsg는 개행으로 끝난다', () => {
  expect(encodeMsg({ a: 1 })).toBe('{"a":1}\n');
});
it('Buffer 메시지가 완전하면 파싱된다', () => {
  const d = new NdjsonDecoder();
  const msg = { type: 'join', nickname: 'alice' };
  const buf = Buffer.from(encodeMsg(msg), 'utf8');
  expect(d.push(buf)).toEqual([msg]);
});
it('한글이 청크 경계에서 잘려도 올바르게 복원된다', () => {
  const d = new NdjsonDecoder();
  const msg = { type: 'join', nickname: '철수' };
  const encoded = encodeMsg(msg);
  const buf = Buffer.from(encoded, 'utf8');
  // "철" is 3 UTF-8 bytes. Find where it starts in the buffer and split mid-character.
  const jsonStr = JSON.stringify(msg);
  const chulIdx = jsonStr.indexOf('철');
  const bytesBefore = Buffer.from(jsonStr.substring(0, chulIdx), 'utf8').length;
  // Split after 1 byte of the 3-byte "철" character
  const splitPoint = bytesBefore + 1;
  const chunk1 = buf.subarray(0, splitPoint);
  const chunk2 = buf.subarray(splitPoint);
  expect(d.push(chunk1)).toEqual([]);
  expect(d.push(chunk2)).toEqual([msg]);
});
it('빈 줄(개행만)은 무시하고 주변 메시지는 정상 파싱된다', () => {
  const d = new NdjsonDecoder();
  expect(d.push('{"type":"chat","text":"hi"}\n\n{"type":"chat","text":"bye"}\n'))
    .toEqual([
      { type: 'chat', text: 'hi' },
      { type: 'chat', text: 'bye' },
    ]);
});
