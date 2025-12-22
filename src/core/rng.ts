/**
 * Seeded pseudo-random number generator for deterministic datasets.
 * Uses a simple xoshiro128** algorithm.
 */

export class SeededRNG {
  private state: Uint32Array;

  constructor(seed: number) {
    // Initialize state from seed using splitmix64
    this.state = new Uint32Array(4);
    let s = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = ((z ^ (z >>> 16)) * 0x85ebca6b) >>> 0;
      z = ((z ^ (z >>> 13)) * 0xc2b2ae35) >>> 0;
      z = (z ^ (z >>> 16)) >>> 0;
      this.state[i] = z;
    }
  }

  /** Returns a float in [0, 1) */
  random(): number {
    const result = this.rotl(this.state[1] * 5, 7) * 9;
    const t = this.state[1] << 9;

    this.state[2] ^= this.state[0];
    this.state[3] ^= this.state[1];
    this.state[1] ^= this.state[2];
    this.state[0] ^= this.state[3];
    this.state[2] ^= t;
    this.state[3] = this.rotl(this.state[3], 11);

    return (result >>> 0) / 0x100000000;
  }

  /** Returns a float in [min, max) */
  range(min: number, max: number): number {
    return min + this.random() * (max - min);
  }

  /** Returns an integer in [0, max) */
  int(max: number): number {
    return Math.floor(this.random() * max);
  }

  /** Returns a normally distributed value (Box-Muller) */
  gaussian(mean = 0, std = 1): number {
    // Clamp u1 away from 0 to avoid log(0) = -Infinity
    const u1 = Math.max(this.random(), 1e-10);
    const u2 = this.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * std;
  }

  private rotl(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }
}
