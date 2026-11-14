import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

// Renew and release only if we still hold the lock (compare-and-set on the token).
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export interface LeaderLockOptions {
  key?: string;
  ttlMs?: number;
  onAcquired?: () => void;
  onLost?: () => void;
}

/**
 * Single-leader lock for agentor-scheduler (produktspecifikation §10.1: exactly one instance).
 * The holder renews every ttl/3; if it dies, another instance takes over after ttl.
 */
export class LeaderLock {
  readonly token = randomUUID();
  private readonly key: string;
  private readonly ttlMs: number;
  private timer: NodeJS.Timeout | undefined;
  private leader = false;

  constructor(
    private readonly redis: Redis,
    private readonly options: LeaderLockOptions = {},
  ) {
    this.key = options.key ?? 'agentor:scheduler:leader';
    this.ttlMs = options.ttlMs ?? 15_000;
  }

  get isLeader(): boolean {
    return this.leader;
  }

  /** One acquisition/renewal attempt. Returns whether this instance is leader afterwards. */
  async tick(): Promise<boolean> {
    if (this.leader) {
      const renewed = (await this.redis.eval(RENEW, 1, this.key, this.token, this.ttlMs)) === 1;
      if (!renewed) {
        this.leader = false;
        this.options.onLost?.();
      }
    } else {
      const acquired =
        (await this.redis.set(this.key, this.token, 'PX', this.ttlMs, 'NX')) === 'OK';
      if (acquired) {
        this.leader = true;
        this.options.onAcquired?.();
      }
    }
    return this.leader;
  }

  start(): void {
    const loop = () => {
      this.tick()
        .catch(() => {
          // Redis unreachable: assume we lost leadership rather than risk two leaders.
          if (this.leader) {
            this.leader = false;
            this.options.onLost?.();
          }
        })
        .finally(() => {
          this.timer = setTimeout(loop, Math.floor(this.ttlMs / 3));
        });
    };
    loop();
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.leader) {
      await this.redis.eval(RELEASE, 1, this.key, this.token);
      this.leader = false;
    }
  }
}
