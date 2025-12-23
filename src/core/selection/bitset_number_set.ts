/**
 * Bitset-backed Set<number> implementation.
 *
 * Motivation:
 * - A JS `Set<number>` has very high per-element overhead (hash table entries,
 *   object headers, GC pressure). For very large selections (millions of
 *   points), this can easily OOM.
 * - A bitset uses 1 bit per point index: for 20M points ~ 2.5MB.
 *
 * This class implements the ES Set interface enough to behave like a normal
 * Set in our codebase (iteration, size, has). Mutating methods are provided so
 * it can be used as the concrete selection storage.
 */

export class BitsetNumberSet implements Set<number> {
  private readonly bits: Uint32Array;
  private _size = 0;

  readonly [Symbol.toStringTag] = 'BitsetNumberSet';

  constructor(readonly capacity: number) {
    const n = Math.max(0, capacity | 0);
    this.capacity = n;
    const words = Math.ceil(n / 32);
    this.bits = new Uint32Array(words);
  }

  get size(): number {
    return this._size;
  }

  private inRange(v: number): boolean {
    return v >= 0 && v < this.capacity;
  }

  private getWordBit(v: number): { w: number; mask: number } {
    const i = v | 0;
    const w = i >>> 5;
    const b = i & 31;
    return { w, mask: 1 << b };
  }

  has(value: number): boolean {
    if (!Number.isFinite(value)) return false;
    const v = value | 0;
    if (!this.inRange(v)) return false;
    const { w, mask } = this.getWordBit(v);
    return (this.bits[w] & mask) !== 0;
  }

  add(value: number): this {
    const v = value | 0;
    if (!this.inRange(v)) return this;
    const { w, mask } = this.getWordBit(v);
    const before = this.bits[w];
    if ((before & mask) === 0) {
      this.bits[w] = before | mask;
      this._size++;
    }
    return this;
  }

  delete(value: number): boolean {
    const v = value | 0;
    if (!this.inRange(v)) return false;
    const { w, mask } = this.getWordBit(v);
    const before = this.bits[w];
    if ((before & mask) !== 0) {
      this.bits[w] = before & ~mask;
      this._size--;
      return true;
    }
    return false;
  }

  clear(): void {
    this.bits.fill(0);
    this._size = 0;
  }

  // -------------------------------------------------------------------------
  // Iteration
  // -------------------------------------------------------------------------

  *values(): IterableIterator<number> {
    // Scan words. This is very fast for sparse sets too because we skip zeros.
    const words = this.bits;
    const n = this.capacity;

    for (let w = 0; w < words.length; w++) {
      let word = words[w];
      if (word === 0) continue;

      // Index base for this 32-bit block.
      const base = w << 5;
      while (word !== 0) {
        // Extract lowest set bit.
        const lsb = word & -word;
        const bit = 31 - Math.clz32(lsb);
        const idx = base + bit;
        if (idx < n) yield idx;
        word ^= lsb;
      }
    }
  }

  keys(): IterableIterator<number> {
    return this.values();
  }

  entries(): IterableIterator<[number, number]> {
    const it = this.values();
    return (function* () {
      for (const v of it) yield [v, v] as [number, number];
    })();
  }

  [Symbol.iterator](): IterableIterator<number> {
    return this.values();
  }

  forEach(callbackfn: (value: number, value2: number, set: Set<number>) => void, thisArg?: any): void {
    const cb = callbackfn.bind(thisArg);
    for (const v of this.values()) {
      cb(v, v, this);
    }
  }

  // -------------------------------------------------------------------------
  // Compatibility helpers
  // -------------------------------------------------------------------------

  /**
   * Create a plain JS Set for small selections (debugging, interop).
   * WARNING: Can OOM if called on a huge selection.
   */
  toJsSet(maxSize = 1_000_000): Set<number> {
    if (this._size > maxSize) {
      throw new Error(`BitsetNumberSet.toJsSet refused: size=${this._size} > maxSize=${maxSize}`);
    }
    return new Set<number>(this);
  }
}
