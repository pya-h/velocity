/**
 * VelocityChannel<T> — Go-style typed channel backed by BroadcastChannel.
 *
 * Works transparently across Bun Worker threads and the main thread.
 * Two channels created with the same name — even in different threads — are
 * automatically connected: sending on one delivers to all others.
 *
 * API mirrors Go channels:
 *   ch.send(value)          — non-blocking send
 *   await ch.receive()      — block until next value
 *   for await (const v of ch) — range over incoming values
 *   ch.close()              — close (no further sends allowed)
 *
 * Note: BroadcastChannel is one-to-many, not one-to-one.
 * For a single-consumer pattern, ensure only one receiver has the channel open.
 * Messages sent before any receiver is listening are NOT queued — they are lost.
 */
export class VelocityChannel<T = any> {
  private readonly bc: BroadcastChannel;
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(value: T) => void> = [];
  private _closed = false;

  constructor(public readonly name: string) {
    this.bc = new BroadcastChannel(name);
    this.bc.onmessage = (e: any) => {
      const value = (e as MessageEvent<T>).data;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(value);
      } else {
        this.buffer.push(value);
      }
    };
  }

  /** Send a value to all receivers on this channel. Non-blocking. */
  send(value: T): void {
    if (this._closed) throw new Error(`VelocityChannel "${this.name}" is closed`);
    this.bc.postMessage(value);
  }

  /**
   * Receive the next value. Resolves immediately if a buffered value exists,
   * otherwise suspends until the next send.
   */
  receive(): Promise<T> {
    if (this.buffer.length > 0) return Promise.resolve(this.buffer.shift()!);
    return new Promise(resolve => this.waiters.push(resolve));
  }

  /**
   * Async iterator — receive values in a for-await loop.
   *
   * @example
   * for await (const job of jobChannel) {
   *   await process(job);
   * }
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (!this._closed) {
      yield await this.receive();
    }
  }

  /** Close the channel. Pending receivers will never resolve after this. */
  close(): void {
    this._closed = true;
    this.bc.close();
  }

  get closed(): boolean { return this._closed; }
}
