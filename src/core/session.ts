/**
 * VelocitySession — encrypted, signed, stateless cookie session.
 *
 * Data is AES-256-GCM encrypted + HMAC-SHA256 signed in a single httpOnly cookie.
 * Zero server-side state — everything lives in the cookie. Decryption is lazy:
 * if the handler never reads `session.data`, no crypto runs.
 *
 * Cost when unused (session not in config): 0 memory, 0 CPU.
 * Cost when configured but handler doesn't use `session` param: 0.
 * Cost per-request when used: ~3μs (one AES decrypt + one HMAC verify).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { VelocityResponse } from '../types';

export interface SessionConfig {
  /** Secret key for encryption + signing. */
  secret: string;
  /** Cookie name. Default: 'velocity.sid' */
  cookieName?: string;
  /** Max age in seconds. Default: 3600 (1 hour) */
  maxAge?: number;
}

// ─── Crypto helpers (AES-256-GCM + HMAC-SHA256) ─────────────────────────────

/** Derives a 32-byte encryption key + 32-byte signing key from the secret. */
function deriveKeys(secret: string): { encKey: Buffer; sigKey: Buffer } {
  const material = scryptSync(secret, 'velocity-session', 64);
  return {
    encKey: material.subarray(0, 32),
    sigKey: material.subarray(32, 64),
  };
}

function encrypt(data: string, encKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv (12) + tag (16) + ciphertext — all base64url encoded
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function decrypt(payload: string, encKey: Buffer): string | null {
  try {
    const buf = Buffer.from(payload, 'base64url');
    if (buf.length < 29) return null; // 12 (iv) + 16 (tag) + 1 (min ciphertext)
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  } catch {
    return null;
  }
}

function sign(value: string, sigKey: Buffer): string {
  return createHmac('sha256', sigKey).update(value).digest('base64url');
}

function verify(value: string, signature: string, sigKey: Buffer): boolean {
  const expected = createHmac('sha256', sigKey).update(value).digest('base64url');
  try {
    if (signature.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Compiled session config (created once at startup) ───────────────────────

export interface CompiledSession {
  encKey: Buffer;
  sigKey: Buffer;
  cookieName: string;
  maxAge: number;
}

export function compileSessionConfig(config: SessionConfig): CompiledSession {
  const { encKey, sigKey } = deriveKeys(config.secret);
  return {
    encKey,
    sigKey,
    cookieName: config.cookieName ?? 'velocity.sid',
    maxAge: config.maxAge ?? 3600,
  };
}

// ─── VelocitySession class ─────────────��─────────────────────────────────────

export class VelocitySession<T = Record<string, unknown>> {
  private _data: T | null | undefined = undefined; // undefined = not yet decrypted
  private _rawCookie: string | undefined;
  private _compiled: CompiledSession;
  private _res: VelocityResponse;
  private _dirty = false;

  constructor(rawCookie: string | undefined, compiled: CompiledSession, res: VelocityResponse) {
    this._rawCookie = rawCookie;
    this._compiled = compiled;
    this._res = res;
  }

  /** Session data — decrypted lazily on first access. null if no valid session. */
  get data(): T | null {
    if (this._data === undefined) {
      this._data = this._decrypt();
    }
    return this._data;
  }

  /** True if a valid session exists. */
  get valid(): boolean {
    return this.data !== null;
  }

  /** Set session data — encrypts + signs + sets cookie on the response. */
  set(data: T): void {
    this._data = data;
    this._dirty = true;
    const json = JSON.stringify(data);
    const encrypted = encrypt(json, this._compiled.encKey);
    const sig = sign(encrypted, this._compiled.sigKey);
    const cookieValue = `${encrypted}.${sig}`;
    this._res.setCookie(this._compiled.cookieName, cookieValue, {
      httpOnly: true,
      path: '/',
      maxAge: this._compiled.maxAge,
      sameSite: 'Lax',
    });
  }

  /** Destroy the session — clears the cookie. */
  destroy(): void {
    this._data = null;
    this._res.clearCookie(this._compiled.cookieName, { path: '/' });
  }

  private _decrypt(): T | null {
    if (!this._rawCookie) return null;

    const dot = this._rawCookie.lastIndexOf('.');
    if (dot === -1) return null;

    const encrypted = this._rawCookie.slice(0, dot);
    const sig = this._rawCookie.slice(dot + 1);

    if (!verify(encrypted, sig, this._compiled.sigKey)) return null;

    const json = decrypt(encrypted, this._compiled.encKey);
    if (!json) return null;

    try {
      return JSON.parse(json) as T;
    } catch {
      return null;
    }
  }
}
