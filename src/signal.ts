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
  private handlers = new Set<(payload: T) => void>();

  // Attach a handler, optionally binding it to a context
  public attach(
    handler: (payload: T) => void,
    signal?: AbortSignal,
  ): () => void {
    if (signal?.aborted) {
      return () => {};
    }

    this.handlers.add(handler);

    const unsubscribe = () => {
      this.handlers.delete(handler);
      signal?.removeEventListener("abort", unsubscribe);
    };

    signal?.addEventListener("abort", unsubscribe);
    return unsubscribe;
  }

  // Wait for the next emission via Promise
  public waitFor(timeout?: number, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new SignalAbortError(signal.reason));
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe: (() => void) | undefined;
      let fired = false;

      const abortHandler = () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (unsubscribe) unsubscribe();
        reject(new SignalAbortError(signal?.reason));
      };

      signal?.addEventListener("abort", abortHandler);

      unsubscribe = this.attach((payload) => {
        fired = true;
        signal?.removeEventListener("abort", abortHandler);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (unsubscribe) unsubscribe(); // Self-destruct if assigned
        resolve(payload);
      }, signal);

      // If the handler fired synchronously during attach, unsubscribe was undefined during the execution
      if (fired) {
        if (unsubscribe) unsubscribe();
      } else if (timeout !== undefined) {
        timeoutId = setTimeout(() => {
          signal?.removeEventListener("abort", abortHandler);
          if (unsubscribe) unsubscribe();
          reject(new SignalTimeoutError());
        }, timeout);
      }
    });
  }

  // Detach a specific handler, or clear ALL handlers if no argument is passed
  public detach(handler?: (payload: T) => void): void {
    if (handler) {
      this.handlers.delete(handler);
    } else {
      this.handlers.clear();
    }
  }

  // Emit the event
  public post(payload: T): void {
    // We copy the set into an array `[...this.handlers]` before iterating.
    // This prevents infinite loops or skipped handlers if a handler
    // attaches/detaches other handlers during the emission tick.
    for (const handler of [...this.handlers]) {
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

    // Listen to the parent signal, but only emit on the child if predicate passes
    this.attach((payload) => {
      if (predicate(payload)) {
        filteredSignal.post(payload);
      }
    }, signal);

    return filteredSignal;
  }

  // Create a StatefulSignal that tracks this Signal's emissions
  public toStateful(initialState: T): StatefulSignal<T> {
    const stateful = new StatefulSignal<T>(initialState);
    this.attach((payload) => stateful.post(payload));
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
