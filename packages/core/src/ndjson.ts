export function encodeMsg(msg: object): string {
  return JSON.stringify(msg) + '\n';
}

export class NdjsonDecoder {
  private buf: string = '';

  push(chunk: Buffer | string): unknown[] {
    this.buf += chunk.toString();
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
