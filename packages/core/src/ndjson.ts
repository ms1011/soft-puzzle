import { StringDecoder } from 'node:string_decoder';

export function encodeMsg(msg: object): string {
  return JSON.stringify(msg) + '\n';
}

export class NdjsonDecoder {
  private buf: string = '';
  private decoder: StringDecoder;

  constructor() {
    this.decoder = new StringDecoder('utf8');
  }

  push(chunk: Buffer | string): unknown[] {
    // Use StringDecoder to properly handle multi-byte UTF-8 sequences split across chunks
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.buf += text;
    const lines = this.buf.split('\n');
    // Keep the last incomplete line (if buf doesn't end with \n)
    this.buf = lines[lines.length - 1];

    const results: unknown[] = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      try {
        results.push(JSON.parse(line));
      } catch {
        // Silently discard unparseable lines
      }
    }
    return results;
  }
}
