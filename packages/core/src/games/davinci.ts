import type { EngineAction, EngineEvent, GameEngine } from '../engine.js';
import type { GameId, GameView } from '../protocol.js';
import type { Rng } from '../rng.js';
import { shuffle } from '../rng.js';

interface Tile { value: number; revealed: boolean; }

/** 상대의 숫자 타일을 추리해 모두 공개하면 이기는 간결한 다빈치 코드. */
export class DavinciEngine implements GameEngine {
  readonly game: GameId = 'davinci';
  readonly minPlayers = 2;
  private players: string[] = [];
  private tiles = new Map<string, Tile[]>();
  private turn = 0;
  private finished = false;
  private winner = '';

  start(players: string[], _host: string, rng: Rng): void {
    this.players = [...players];
    const deck = shuffle(Array.from({ length: 24 }, (_, i) => i % 12), rng);
    this.tiles = new Map(players.map((p, i) => [p, deck.slice(i * 4, i * 4 + 4).sort((a, b) => a - b).map((value) => ({ value, revealed: false }))]));
    this.turn = 0; this.finished = false; this.winner = '';
  }
  setHost(_host: string): void {}
  handleAction(player: string, action: EngineAction): EngineEvent[] {
    if (this.finished || this.players[this.turn] !== player || action.name !== 'guess' || !isGuess(action.arg)) return [];
    const targetTiles = this.tiles.get(action.arg.player);
    if (!targetTiles || action.arg.player === player || !targetTiles[action.arg.index] || targetTiles[action.arg.index]!.revealed) return [];
    const tile = targetTiles[action.arg.index]!;
    if (tile.value === action.arg.value) {
      tile.revealed = true;
      if (targetTiles.every((item) => item.revealed)) {
        const active = this.activePlayers();
        if (active.length === 1) {
          this.finished = true; this.winner = active[0]!;
          return [{ text: `${action.arg.player}님이 탈락했습니다. ${this.winner}님이 최후까지 남아 승리했습니다!` }];
        }
        return [{ text: `정답입니다! ${action.arg.player}님의 타일이 모두 공개되어 탈락했습니다.` }];
      }
      return [{ text: '정답입니다! 계속 추리하세요.' }];
    }
    const own = this.tiles.get(player)!.find((item) => !item.revealed);
    if (own) own.revealed = true;
    const active = this.activePlayers();
    if (active.length === 1) {
      this.finished = true;
      this.winner = active[0]!;
      return [{ text: `오답으로 ${player}님의 마지막 타일이 공개되었습니다. ${this.winner}님이 승리했습니다!` }];
    }
    this.advanceTurn();
    return [{ text: `오답입니다. ${player}님의 타일 하나가 공개되고 다음 차례로 넘어갑니다.` }];
  }
  getViewFor(player: string): GameView {
    return {
      phase: this.finished ? 'result' : 'guessing',
      yourActions: !this.finished && this.players[this.turn] === player ? ['guess'] : [],
      isTurn: this.players[this.turn] === player,
      turnPlayer: this.finished ? null : (this.players[this.turn] ?? null),
      boards: this.players.map((p) => ({ nickname: p, eliminated: this.isEliminated(p), tiles: (this.tiles.get(p) ?? []).map((tile) => ({ value: p === player || tile.revealed ? tile.value : null, revealed: tile.revealed })) })),
    };
  }
  pendingPlayers(): string[] { return this.finished ? [] : [this.players[this.turn]!]; }
  defaultAction(player: string): EngineAction | null {
    if (this.players[this.turn] !== player) return null;
    const target = this.players.find((p) => p !== player && this.tiles.get(p)?.some((tile) => !tile.revealed));
    const index = target === undefined ? -1 : this.tiles.get(target)!.findIndex((tile) => !tile.revealed);
    return target === undefined || index < 0 ? null : { name: 'guess', arg: { player: target, index, value: 0 } };
  }
  removePlayer(player: string): EngineEvent[] {
    if (!this.players.includes(player) || this.finished) return [];
    const current = this.players[this.turn];
    this.players = this.players.filter((p) => p !== player); this.tiles.delete(player);
    if (this.players.length === 1) { this.finished = true; this.winner = this.players[0]!; return [{ text: `${this.winner}님이 승리했습니다.` }]; }
    this.turn = current === player ? Math.min(this.turn, this.players.length - 1) : Math.max(0, this.players.indexOf(current!));
    if (this.isEliminated(this.players[this.turn]!)) this.advanceTurn();
    return [{ text: `${player}님이 게임을 떠났습니다.` }];
  }
  isFinished(): boolean { return this.finished; }
  result(): { ranking: { nickname: string; detail: string }[] } | null { return this.finished ? { ranking: this.players.map((p) => ({ nickname: p, detail: p === this.winner ? '승리' : '패배' })) } : null; }

  private isEliminated(player: string): boolean {
    const tiles = this.tiles.get(player);
    return tiles !== undefined && tiles.every((tile) => tile.revealed);
  }

  private activePlayers(): string[] { return this.players.filter((player) => !this.isEliminated(player)); }

  private advanceTurn(): void {
    if (this.players.length === 0) return;
    do { this.turn = (this.turn + 1) % this.players.length; } while (this.isEliminated(this.players[this.turn]!));
  }
}

function isGuess(value: unknown): value is { player: string; index: number; value: number } {
  if (typeof value !== 'object' || value === null) return false;
  const guess = value as Record<string, unknown>;
  return typeof guess.player === 'string' && Number.isInteger(guess.index) && Number.isInteger(guess.value) && Number(guess.value) >= 0 && Number(guess.value) <= 11;
}
