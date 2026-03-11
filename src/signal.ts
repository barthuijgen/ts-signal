export class SignalTimeoutError extends Error {
  constructor(message = "Timeout") {
    super(message);
    this.name = "SignalTimeoutError";
  }
}

export class SignalAbortError extends Error {
  constructor(message = "Aborted") {
    super(message);
    this.name = "SignalAbortError";
  }
}

export class Signal<T = void> {
  #handlers = new Set<(payload: T) => void>();
  #maxHandlers = 20;

  // Lifecycle hooks for derived signals
  protected onFirstAttach?(): void;
  protected onLastDetach?(): void;

  public setMaxHandlers(count: number): void {
    this.#maxHandlers = count;
  }

  // Attach a handler, optionally binding it to a context
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

    const unsubscribe = () => {
      this.#handlers.delete(handler);

      // Trigger lazy teardown if we hit 0 listeners
      if (this.#handlers.size === 0 && this.onLastDetach) {
        this.onLastDetach();
      }

      signal?.removeEventListener("abort", unsubscribe);
    };

    signal?.addEventListener("abort", unsubscribe);
    return unsubscribe;
  }

  // Attach a handler that will only be executed once
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

  // Wait for the next emission via Promise
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

  // Detach a specific handler, or clear ALL handlers if no argument is passed
  public detach(handler?: (payload: T) => void): void {
    if (handler) {
      this.#handlers.delete(handler);
    } else {
      this.#handlers.clear();
    }
  }

  // Emit the event
  public post(payload: T): void {
    // We copy the set into an array `[...this.handlers]` before iterating.
    // This prevents infinite loops or skipped handlers if a handler
    // attaches/detaches other handlers during the emission tick.
    for (const handler of [...this.#handlers]) {
      handler(payload);
    }
  }

  // 1. Overload for TypeScript Type Guards (Narrows the type)
  public filter<U extends T>(
    predicate: (payload: T) => payload is U,
    signal?: AbortSignal,
  ): Signal<U>;

  // 2. Overload for standard boolean checks (Keeps the same type)
  public filter(
    predicate: (payload: T) => boolean,
    signal?: AbortSignal,
  ): Signal<T>;

  // Implementation
  // deno-lint-ignore no-explicit-any
  public filter(predicate: (payload: T) => boolean, signal?: AbortSignal): any {
    // deno-lint-ignore no-explicit-any
    const filteredSignal = new Signal<any>();
    const weakRef = new WeakRef(filteredSignal);

    let sub: (() => void) | undefined;

    filteredSignal.onFirstAttach = () => {
      // Listen to the parent signal, but only emit on the child if predicate passes
      sub = this.attach((payload) => {
        const sig = weakRef.deref();
        if (sig) {
          if (predicate(payload)) {
            sig.post(payload);
          }
        } else {
          // GC'd, self-destruct
          if (sub) {
            sub();
            sub = undefined;
          }
        }
      }, signal);
    };

    filteredSignal.onLastDetach = () => {
      if (sub) {
        sub();
        sub = undefined;
      }
    };

    return filteredSignal;
  }

  // Pipe through one or more transform functions
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
  // Implementation
  // deno-lint-ignore no-explicit-any
  public pipe(...fns: ((payload: any) => any)[]): Signal<any> {
    // deno-lint-ignore no-explicit-any
    const pipedSignal = new Signal<any>();
    const weakRef = new WeakRef(pipedSignal);

    let sub: (() => void) | undefined;

    pipedSignal.onFirstAttach = () => {
      sub = this.attach((payload) => {
        const sig = weakRef.deref();
        if (sig) {
          let result = payload;
          for (const fn of fns) {
            result = fn(result);
          }
          sig.post(result);
        } else {
          // GC'd, self-destruct
          if (sub) {
            sub();
            sub = undefined;
          }
        }
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

  // Create a StatefulSignal that tracks this Signal's emissions
  public toStateful(initialState: T): StatefulSignal<T> {
    const stateful = new StatefulSignal<T>(initialState);
    const weakRef = new WeakRef(stateful);

    // We do NOT use onFirstAttach/onLastDetach here because StatefulSignal needs
    // to track emissions constantly to maintain its state correctly. We just use
    // WeakRef so it gets garbage collected if the user loses all references to it.
    let sub: (() => void) | undefined;
    sub = this.attach((payload) => {
      const sig = weakRef.deref();
      if (sig) {
        sig.post(payload);
      } else {
        if (sub) {
          sub();
          sub = undefined;
        }
      }
    });

    return stateful;
  }
}

export class StatefulSignal<T> extends Signal<T> {
  #state: T;

  public get state(): T {
    return this.#state;
  }

  constructor(initialState: T) {
    super();
    this.#state = initialState;
  }

  // Override attach to immediately invoke the handler with the current state
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

  // Override post to update state before emitting
  public override post(payload: T): void {
    this.#state = payload;
    super.post(payload);
  }
}

export type SignalType<T> =
  T extends StatefulSignal<infer U> ? U : T extends Signal<infer U> ? U : never;
