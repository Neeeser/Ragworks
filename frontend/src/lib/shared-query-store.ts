import { getErrorMessage } from "@/lib/errors";

export interface SharedQuerySnapshot<Value> {
  data: Value | null;
  loading: boolean;
  error: string | null;
  invalidated: boolean;
}

interface QueryEntry<Key, Value> {
  key: Key;
  snapshot: SharedQuerySnapshot<Value>;
  listeners: Set<() => void>;
  request: Promise<void> | null;
  generation: number;
}

const EMPTY_SNAPSHOT: SharedQuerySnapshot<never> = Object.freeze({
  data: null,
  loading: false,
  error: null,
  invalidated: false,
});

/** Minimal retained query cache: stable snapshots, deduplication, and invalidation. */
export class SharedQueryStore<Key, Value> {
  private readonly entries = new Map<string, QueryEntry<Key, Value>>();

  constructor(private readonly identify: (key: Key) => string) {}

  snapshot(key: Key): SharedQuerySnapshot<Value> {
    return this.entry(key).snapshot;
  }

  subscribe(key: Key, listener: () => void): () => void {
    const entry = this.entry(key);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  revalidate(key: Key, loader: () => Promise<Value>): Promise<void> {
    const identifier = this.identify(key);
    const entry = this.entry(key);
    if (entry.request) return entry.request;

    const generation = entry.generation;
    this.publish(entry, {
      ...entry.snapshot,
      loading: true,
      error: null,
      invalidated: false,
    });

    const request = loader()
      .then((data) => {
        if (this.entries.get(identifier) !== entry || entry.generation !== generation) return;
        this.publish(entry, { data, loading: false, error: null, invalidated: false });
      })
      .catch((error: unknown) => {
        if (this.entries.get(identifier) !== entry || entry.generation !== generation) return;
        this.publish(entry, {
          ...entry.snapshot,
          loading: false,
          error: getErrorMessage(error, "Unable to load data."),
        });
      })
      .finally(() => {
        if (entry.request === request) entry.request = null;
      });
    entry.request = request;
    return request;
  }

  invalidate(predicate: (key: Key) => boolean): void {
    for (const entry of this.entries.values()) {
      if (!predicate(entry.key)) continue;
      entry.generation += 1;
      entry.request = null;
      this.publish(entry, { ...entry.snapshot, invalidated: true });
    }
  }

  removeMatching(predicate: (key: Key) => boolean): void {
    for (const [identifier, entry] of this.entries) {
      if (!predicate(entry.key)) continue;
      entry.generation += 1;
      entry.request = null;
      if (entry.listeners.size === 0) {
        this.entries.delete(identifier);
      } else {
        this.publish(entry, EMPTY_SNAPSHOT);
      }
    }
  }

  subscriberCount(key: Key): number {
    return this.entries.get(this.identify(key))?.listeners.size ?? 0;
  }

  has(key: Key): boolean {
    return this.entries.has(this.identify(key));
  }

  private entry(key: Key): QueryEntry<Key, Value> {
    const identifier = this.identify(key);
    let entry = this.entries.get(identifier);
    if (!entry) {
      entry = {
        key,
        snapshot: EMPTY_SNAPSHOT,
        listeners: new Set(),
        request: null,
        generation: 0,
      };
      this.entries.set(identifier, entry);
    }
    return entry;
  }

  private publish(entry: QueryEntry<Key, Value>, snapshot: SharedQuerySnapshot<Value>): void {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
  }
}
