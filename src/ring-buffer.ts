/** Fixed-capacity circular buffer used internally by all rolling windows. */
export class RingBuffer {
  private readonly _buf: Float64Array;
  private _head = 0;
  private _count = 0;

  constructor(readonly capacity: number) {
    this._buf = new Float64Array(capacity);
  }

  push(value: number): number | undefined {
    const evicted = this._count === this.capacity
      ? this._buf[this._head]
      : undefined;
    this._buf[this._head] = value;
    this._head = (this._head + 1) % this.capacity;
    if (this._count < this.capacity) this._count++;
    return evicted;
  }

  get count(): number { return this._count; }
  get isFull(): boolean { return this._count === this.capacity; }

  at(i: number): number {
    return this._buf[(this._head - this._count + i + this.capacity * 2) % this.capacity];
  }

  toArray(): number[] {
    const arr: number[] = new Array(this._count);
    for (let i = 0; i < this._count; i++) arr[i] = this.at(i);
    return arr;
  }

  clear(): void { this._head = 0; this._count = 0; }
}
