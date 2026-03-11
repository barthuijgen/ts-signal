/** Thrown by {@link Signal.waitFor} when the timeout elapses before the signal emits. */
export class SignalTimeoutError extends Error {
  constructor(message = "Timeout") {
    super(message);
    this.name = "SignalTimeoutError";
  }
}

/** Thrown by {@link Signal.waitFor} when the provided AbortSignal is aborted. */
export class SignalAbortError extends Error {
  constructor(message = "Aborted") {
    super(message);
    this.name = "SignalAbortError";
  }
}

/** Wraps a function so that calling the wrapper nulls out the inner reference */
function disposable(fn: () => void): () => void {
  let inner: (() => void) | undefined = fn;
  return () => {
    if (inner) {
      const f = inner;
      inner = undefined;
      f();
    }
  };
}

/**
 * A type-safe event signal. Use `Signal<void>` for signals with no payload.
 *
 * @example
 * ```ts
 * const onLogin = new Signal<{ id: string; name: string }>();
 *
 * const unsub = onLogin.attach((user) => {
 *   console.log(`Welcome, ${user.name}!`);
 * });
 *
 * onLogin.post({ id: "123", name: "Alice" });
 * unsub();
 * ```
 */
export class Signal<T = void> {
  #handlers = new Set<(payload: T) => void>();
  #maxHandlers = 20;

  // Lifecycle hooks for derived signals
  protected onFirstAttach?(): void;
  protected onLastDetach?(): void;

  /**
   * Sets the maximum number of handlers before a console warning is emitted.
   * Useful for detecting memory leaks. Defaults to `20`. Set to `0` to disable.
   */
  public setMaxHandlers(count: number): void {
    this.#maxHandlers = count;
  }

  /**
   * Registers a handler to be called whenever the signal emits.
   * Returns an unsubscribe function. Pass an `AbortSignal` for automatic cleanup.
   *
   * @example
   * ```ts
   * const onData = new Signal<string>();
   *
   * const unsub = onData.attach((data) => console.log(data));
   * onData.post("Hello!"); // Logs: "Hello!"
   *
   * unsub();
   * onData.post("World!"); // Nothing logged
   * ```
   *
   * @example Using an AbortSignal for automatic cleanup:
   * ```ts
   * const ac = new AbortController();
   * const onData = new Signal<string>();
   *
   * onData.attach((data) => console.log(data), ac.signal);
   * ac.abort(); // Automatically unsubscribes
   * ```
   */
  public attach(
    handler: (payload: T) => void,
    signal?: AbortSignal,
  ): () => void {
    if (signal?.aborted) {
      return () => {};
    }

    const isFirst = this.#handlers.size === 0;

    this.#handlers.add(handler);

    if (this.#maxHandlers > 0 && this.#handlers.size > this.#maxHandlers) {
      console.warn(
        `Warning: Signal has exceeded the maximum of ${this.#maxHandlers} handlers. This could indicate a memory leak. Use signal.setMaxHandlers(n) to increase the limit.`,
      );
    }

    // Trigger lazy setup for cold signals
    if (isFirst && this.onFirstAttach) {
      this.onFirstAttach();
    }

    const unsub = disposable(() => {
      this.#handlers.delete(handler);

      // Trigger lazy teardown if we hit 0 listeners
      if (this.#handlers.size === 0 && this.onLastDetach) {
        this.onLastDetach();
      }

      signal?.removeEventListener("abort", unsub);
    });

    signal?.addEventListener("abort", unsub);
    return unsub;
  }

  /**
   * Registers a handler that fires once and then automatically unsubscribes.
   *
   * @example
   * ```ts
   * const onReady = new Signal<void>();
   *
   * onReady.attachOnce(() => console.log("Ready!"));
   * onReady.post(); // Logs: "Ready!"
   * onReady.post(); // Nothing logged
   * ```
   */
  public attachOnce(
    handler: (payload: T) => void,
    signal?: AbortSignal,
  ): () => void {
    if (signal?.aborted) {
      return () => {};
    }

    let fired = false;
    let unsubscribe: (() => void) | undefined;

    unsubscribe = this.attach((payload) => {
      fired = true;
      if (unsubscribe) unsubscribe();
      handler(payload);
    }, signal);

    if (fired && unsubscribe) {
      unsubscribe();
    }

    return unsubscribe;
  }

  /**
   * Returns a Promise that resolves with the next emitted value.
   *
   * @param timeout - Optional timeout in milliseconds. Rejects with {@link SignalTimeoutError} if elapsed.
   * @param signal - Optional AbortSignal. Rejects with {@link SignalAbortError} if aborted.
   *
   * @example
   * ```ts
   * const onReady = new Signal<void>();
   *
   * try {
   *   await onReady.waitFor(5000);
   * } catch (e) {
   *   if (e instanceof SignalTimeoutError) {
   *     console.error("Operation timed out!");
   *   }
   * }
   * ```
   */
  public waitFor(timeout?: number, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new SignalAbortError(signal.reason));
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let fired = false;

      const abortHandler = () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        unsubscribe();
        reject(new SignalAbortError(signal?.reason));
      };

      signal?.addEventListener("abort", abortHandler);

      const unsubscribe = this.attachOnce((payload) => {
        fired = true;
        signal?.removeEventListener("abort", abortHandler);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        resolve(payload);
      }, signal);

      if (!fired && timeout !== undefined) {
        timeoutId = setTimeout(() => {
          signal?.removeEventListener("abort", abortHandler);
          unsubscribe();
          reject(new SignalTimeoutError());
        }, timeout);
      }
    });
  }

  /**
   * Removes a specific handler, or clears all handlers if none is provided.
   * On derived signals (`filter`, `pipe`, `toStateful`), this also tears down
   * the parent subscription when handlers drop to zero.
   */
  public detach(handler?: (payload: T) => void): void {
    if (handler) {
      this.#handlers.delete(handler);
    } else {
      this.#handlers.clear();
    }

    if (this.#handlers.size === 0 && this.onLastDetach) {
      this.onLastDetach();
    }
  }

  /**
   * Emits the payload synchronously to all attached handlers.
   * Safe to call even if handlers attach or detach other handlers during emission.
   */
  public post(payload: T): void {
    for (const handler of [...this.#handlers]) {
      handler(payload);
    }
  }

  /**
   * Returns a derived Signal that only emits values matching the predicate.
   * The derived signal is cold: it only subscribes to the parent while it has active handlers.
   *
   * Supports TypeScript type guards to narrow the payload type.
   *
   * @example
   * ```ts
   * const incoming = new Signal<string | number>();
   *
   * const strings = incoming.filter((p): p is string => typeof p === "string");
   * strings.attach((str) => console.log(str.toUpperCase()));
   *
   * incoming.post(42);      // Nothing logged
   * incoming.post("hello"); // Logs: "HELLO"
   * ```
   *
   * @example Narrowing discriminated unions (no type guard needed):
   * ```ts
   * type Event =
   *   | { type: "message"; text: string }
   *   | { type: "error"; code: number };
   *
   * const events = new Signal<Event>();
   *
   * const errors = events.filter((e) => e.type === "error");
   * errors.attach((e) => console.log(e.code)); // `e` is narrowed, `code` is available
   * ```
   */
  public filter<U extends T>(
    predicate: (payload: T) => payload is U,
  ): Signal<U>;
  public filter(predicate: (payload: T) => boolean): Signal<T>;
  public filter(predicate: (payload: T) => boolean): any {
    const filteredSignal = new Signal<any>();
    let sub: (() => void) | undefined;

    filteredSignal.onFirstAttach = () => {
      sub = this.attach((payload) => {
        if (predicate(payload)) {
          filteredSignal.post(payload);
        }
      });
    };

    filteredSignal.onLastDetach = () => {
      if (sub) {
        sub();
        sub = undefined;
      }
    };

    return filteredSignal;
  }

  /**
   * Returns a derived Signal by piping emitted values through one or more transform functions.
   * Strongly typed for up to 9 functions. The derived signal is cold.
   *
   * @example
   * ```ts
   * const signal = new Signal<number>();
   *
   * const labels = signal.pipe(
   *   (n) => n * 2,
   *   (n) => `Value: ${n}`,
   * );
   *
   * labels.attach(console.log);
   * signal.post(5);  // Logs: "Value: 10"
   * signal.post(15); // Logs: "Value: 30"
   * ```
   */
  public pipe<A>(fn1: (payload: T) => A): Signal<A>;
  public pipe<A, B>(fn1: (payload: T) => A, fn2: (payload: A) => B): Signal<B>;
  public pipe<A, B, C>(
    fn1: (payload: T) => A,
    fn2: (payload: A) => B,
    fn3: (payload: B) => C,
  ): Signal<C>;
  public pipe<A, B, C, D>(
    fn1: (payload: T) => A,
    fn2: (payload: A) => B,
    fn3: (payload: B) => C,
    fn4: (payload: C) => D,
  ): Signal<D>;
  public pipe<A, B, C, D, E>(
    fn1: (payload: T) => A,
    fn2: (payload: A) => B,
    fn3: (payload: B) => C,
    fn4: (payload: C) => D,
    fn5: (payload: D) => E,
  ): Signal<E>;
  public pipe<A, B, C, D, E, F>(
    fn1: (payload: T) => A,
    fn2: (payload: A) => B,
    fn3: (payload: B) => C,
    fn4: (payload: C) => D,
    fn5: (payload: D) => E,
    fn6: (payload: E) => F,
  ): Signal<F>;
  public pipe<A, B, C, D, E, F, G>(
    fn1: (payload: T) => A,
    fn2: (payload: A) => B,
    fn3: (payload: B) => C,
    fn4: (payload: C) => D,
    fn5: (payload: D) => E,
    fn6: (payload: E) => F,
    fn7: (payload: F) => G,
  ): Signal<G>;
  public pipe<A, B, C, D, E, F, G, H>(
    fn1: (payload: T) => A,
    fn2: (payload: A) => B,
    fn3: (payload: B) => C,
    fn4: (payload: C) => D,
    fn5: (payload: D) => E,
    fn6: (payload: E) => F,
    fn7: (payload: F) => G,
    fn8: (payload: G) => H,
  ): Signal<H>;
  public pipe<A, B, C, D, E, F, G, H, I>(
    fn1: (payload: T) => A,
    fn2: (payload: A) => B,
    fn3: (payload: B) => C,
    fn4: (payload: C) => D,
    fn5: (payload: D) => E,
    fn6: (payload: E) => F,
    fn7: (payload: F) => G,
    fn8: (payload: G) => H,
    fn9: (payload: H) => I,
  ): Signal<I>;
  public pipe(...fns: ((payload: any) => any)[]): Signal<any> {
    const pipedSignal = new Signal<any>();
    let sub: (() => void) | undefined;

    pipedSignal.onFirstAttach = () => {
      sub = this.attach((payload) => {
        let result = payload;
        for (const fn of fns) {
          result = fn(result);
        }
        pipedSignal.post(result);
      });
    };

    pipedSignal.onLastDetach = () => {
      if (sub) {
        sub();
        sub = undefined;
      }
    };

    return pipedSignal;
  }

  /**
   * Returns a derived {@link StatefulSignal} that tracks this signal's emissions.
   * The derived signal is cold: it only subscribes to the parent while it has active handlers.
   *
   * @example
   * ```ts
   * const onClick = new Signal<number>();
   * const clickCount = onClick.toStateful(0);
   *
   * clickCount.attach((count) => console.log(`Clicks: ${count}`));
   * // Immediately logs: "Clicks: 0"
   *
   * onClick.post(1); // Logs: "Clicks: 1"
   * ```
   */
  public toStateful(initialState: T): StatefulSignal<T> {
    const stateful = new StatefulSignal<T>(initialState);
    let sub: (() => void) | undefined;

    stateful.onFirstAttach = () => {
      sub = this.attach((payload) => {
        stateful.post(payload);
      });
    };

    stateful.onLastDetach = () => {
      if (sub) {
        sub();
        sub = undefined;
      }
    };

    return stateful;
  }
}

/**
 * A Signal that persists the last emitted value as `.state`.
 * New handlers are immediately invoked with the current state on attach.
 *
 * @example
 * ```ts
 * const score = new StatefulSignal<number>(0);
 *
 * score.attach((s) => console.log(`Score: ${s}`));
 * // Immediately logs: "Score: 0"
 *
 * score.post(10);
 * // Logs: "Score: 10"
 *
 * console.log(score.state); // 10
 * ```
 */
export class StatefulSignal<T> extends Signal<T> {
  #state: T;

  /** The current state value. */
  public get state(): T {
    return this.#state;
  }

  constructor(initialState: T) {
    super();
    this.#state = initialState;
  }

  /**
   * Attaches a handler and immediately invokes it with the current state,
   * unless the provided AbortSignal is already aborted.
   */
  public override attach(
    handler: (payload: T) => void,
    signal?: AbortSignal,
  ): () => void {
    const unsubscribe = super.attach(handler, signal);

    if (!signal?.aborted) {
      handler(this.#state);
    }

    return unsubscribe;
  }

  /** Updates the state and emits to all handlers. */
  public override post(payload: T): void {
    this.#state = payload;
    super.post(payload);
  }
}

/** Extracts the payload type from a Signal or StatefulSignal. */
export type SignalType<T> =
  T extends StatefulSignal<infer U> ? U : T extends Signal<infer U> ? U : never;
