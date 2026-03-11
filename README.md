# ts-signal

Typescript-safe signals with minimal footprint, AbortController support, and advanced utility functions.

A modern, fast, and fully type-safe event-emitter replacement designed for building robust and scalable applications. Featuring simple subscription mechanisms, Promisified `waitFor`, automatic type-guards via `filter`, and stateful properties.

![npm](https://img.shields.io/npm/v/ts-signal)
![license](https://img.shields.io/npm/l/ts-signal)
![minified](https://img.badgesize.io/https://cdn.jsdelivr.net/npm/ts-signal/dist/index.min.js)
![NPM Downloads](https://img.shields.io/npm/dw/ts-signal)

## Features

- **Fully Type-Safe**: Payloads and filters maintain exact type inference.
- **Lightweight**: Minimal API surface, zero dependencies.
- **AbortController Support**: Native support for memory-leak-free unsubscription.
- **Promise Integrated**: Wait for the next emission with timeouts out-of-the-box.
- **Stateful Signals**: Built-in support for values that persist across events.
- **Mutation Safe**: Resilient against handler modifications during dispatch ticks.

## Installation

```bash
npm install ts-signal
```

Or using `yarn`, `pnpm`, or `bun`:

```bash
pnpm add ts-signal
```

## Quick Start

```typescript
import { Signal } from "ts-signal";

// 1. Create a signal
const onUserLogin = new Signal<{ id: string; name: string }>();

// 2. Attach a handler
const unsubscribe = onUserLogin.attach((user) => {
  console.log(`Welcome, ${user.name}!`);
});

// 3. Post an event
onUserLogin.post({ id: "123", name: "Alice" });

// 4. Unsubscribe when done
unsubscribe();
```

## Requirements

- **Node.js**: `>= 20` (Built for modern active LTS environments).
- **Module**: **ESM Only** (`import` / `export`). CommonJS `require()` is not supported.

## API Documentation

### `Signal<T>`

The core event dispatcher. If the payload is empty, use `Signal<void>`.

#### `attach(handler: (payload: T) => void, signal?: AbortSignal): () => void`

Registers a callback to be invoked whenever the signal emits. Returns an unsubscribe function.

- **Tip:** Pass an `AbortSignal` for automatic and scalable unsubscription!

```typescript
const ac = new AbortController();
const onData = new Signal<string>();

onData.attach((data) => console.log(data), ac.signal);
onData.post("Hello!"); // Logs: "Hello!"

ac.abort(); // Automatically unsubscribes
onData.post("World!"); // Nothing is logged
```

#### `waitFor(timeout?: number, signal?: AbortSignal): Promise<T>`

Returns a Promise that resolves with the next emitted payload.

- Throws a `SignalTimeoutError` if `timeout` in ms is provided and elapsed.
- Can be preemptively aborted via an `AbortSignal`.

```typescript
const onReady = new Signal<void>();

try {
  await onReady.waitFor(5000); // Continues if resolved within 5 seconds
} catch (e) {
  if (e instanceof SignalTimeoutError) {
    console.error("Operation timed out!");
  }
}
```

#### `detach(handler?: (payload: T) => void): void`

Removes a specific handler. If no handler is provided, **clears all attached handlers**.

#### `post(payload: T): void`

Emits the payload synchronously to all currently attached handlers. Iteration over handlers is perfectly safe even if handlers mutate the listener list during their execution tick.

#### `filter(predicate, signal?: AbortSignal)`

Returns a new filtered derived child `Signal`. Highly suitable for deep workflows.

Supports **TypeScript Type Guards** to automatically narrow down the payload!

```typescript
const incoming = new Signal<string | number>();

// Type completely narrowed to Signal<string>
const stringOnly = incoming.filter((p): p is string => typeof p === "string");

stringOnly.attach((str) => {
  console.log(str.toUpperCase()); // Safe to use string methods here!
});
```

#### `toStateful(initialState: T): StatefulSignal<T>`

Returns a new `StatefulSignal` paired to this generic signal, inherently proxying all new values into the stateful wrapper.

---

### `StatefulSignal<T>`

Extends `Signal<T>` but persists the last emitted value.

#### `constructor(initialState: T)`

Creates a new StatefulSignal with the given initial state.

#### `state: T` (Getter)

Synchronously accessible current state property.

#### `attach(handler: (payload: T) => void, signal?: AbortSignal): () => void`

Attaches a handler and **immediately invokes it** with the current `.state` unless the passed `AbortSignal` is already active. Continues to trigger on further updates exactly like a standard `Signal`.

```typescript
const userScore = new StatefulSignal<number>(0);

userScore.attach((score) => console.log(`Current Score: ${score}`));
// Immediately logs "Current Score: 0"

userScore.post(10);
// Logs "Current Score: 10"
```

#### `waitFor(timeout?: number, signal?: AbortSignal): Promise<T>`

Like `Signal.waitFor`, but resolves **immediately** with the current state. Therefore, timeouts are essentially bypassed.

---

### Utility Types

#### `SignalType<S>`

A type helper to extract the internal payload type of a given signal.

```typescript
import type { SignalType } from "ts-signal";

type MySignal = Signal<string>;
type Payload = SignalType<MySignal>; // Evaluates to `string`
```

---

### Advanced Use Cases

#### Automated Lifecycle Management

By binding listeners with `AbortController`, complex setups and teardowns are centralized and inherently leak-proof:

```typescript
class ReactiveComponent {
  private abortController = new AbortController();

  mount(globalSignal: Signal<number>) {
    globalSignal.attach((val) => console.log(val), this.abortController.signal);
  }

  unmount() {
    // Unsubscribes from all signals attached with this controller
    this.abortController.abort();
  }
}
```
