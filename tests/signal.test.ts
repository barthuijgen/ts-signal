import { assert, test } from "vitest";
import { Signal, type SignalType, StatefulSignal } from "../src/signal.js";

test("Signal - Basic emit and handle", () => {
  const signal = new Signal<number>();
  const received: number[] = [];

  signal.attach((payload) => received.push(payload));
  signal.post(1);
  signal.post(2);

  assert.deepEqual(received, [1, 2]);
});

test("Signal - Multiple handlers", () => {
  const signal = new Signal<string>();
  let count = 0;

  signal.attach(() => count++);
  signal.attach(() => (count += 2));

  signal.post("test");
  assert.strictEqual(count, 3);
});

test("Signal - Detach specific handler", () => {
  const signal = new Signal<number>();
  let count1 = 0;
  let count2 = 0;

  const handler1 = () => count1++;
  const handler2 = () => count2++;

  const unsub = signal.attach(handler1);
  signal.attach(handler2);

  signal.post(1);
  assert.strictEqual(count1, 1);
  assert.strictEqual(count2, 1);

  unsub(); // detaches hander1 internally

  signal.post(2);
  assert.strictEqual(count1, 1);
  assert.strictEqual(count2, 2);

  signal.detach(handler2); // detaches handler2 using class method

  signal.post(3);
  assert.strictEqual(count1, 1);
  assert.strictEqual(count2, 2);
});

test("Signal - Detach all handlers", () => {
  const signal = new Signal<void>();
  let count = 0;

  signal.attach(() => count++);
  signal.attach(() => count++);

  signal.post();
  assert.strictEqual(count, 2);

  signal.detach();

  signal.post();
  assert.strictEqual(count, 2);
});

test("Signal - attach with AbortSignal", () => {
  const signal = new Signal<void>();
  let count = 0;

  const ac = new AbortController();
  signal.attach(() => count++, ac.signal);

  signal.post();
  assert.strictEqual(count, 1);

  ac.abort();

  signal.post();
  assert.strictEqual(count, 1);
});

test("Signal - attach with already aborted AbortSignal is a no-op", () => {
  const signal = new Signal<number>();
  const ac = new AbortController();
  ac.abort();

  let called = false;
  const unsub = signal.attach(() => {
    called = true;
  }, ac.signal);

  signal.post(1);
  assert.strictEqual(called, false);

  // unsub should be a no-op function
  unsub();
});

test("Signal - attachOnce only fires once and auto-detaches", () => {
  const signal = new Signal<number>();
  let count = 0;
  let lastVal = 0;

  signal.attachOnce((val) => {
    count++;
    lastVal = val;
  });

  signal.post(1);
  signal.post(2);
  signal.post(3);

  assert.strictEqual(count, 1);
  assert.strictEqual(lastVal, 1);
});

test("Signal - attachOnce respects AbortSignal before emitting", () => {
  const signal = new Signal<void>();
  let count = 0;

  const ac = new AbortController();
  signal.attachOnce(() => count++, ac.signal);

  ac.abort();
  signal.post();

  assert.strictEqual(count, 0);
});

test("Signal - attachOnce manual unsubscribe works", () => {
  const signal = new Signal<void>();
  let count = 0;

  const unsub = signal.attachOnce(() => count++);
  unsub();

  signal.post();

  assert.strictEqual(count, 0);
});

test("Signal - attachOnce with already aborted AbortSignal is a no-op", () => {
  const signal = new Signal<number>();
  const ac = new AbortController();
  ac.abort();

  let called = false;
  const unsub = signal.attachOnce(() => {
    called = true;
  }, ac.signal);

  signal.post(1);
  assert.strictEqual(called, false);

  // unsub should be safe to call
  unsub();
});

test("Signal - Handler mutation during emission is safe", () => {
  const signal = new Signal<number>();
  let count1 = 0;
  let count2 = 0;

  const handler1 = () => {
    count1++;
    signal.detach(handler1);
    signal.attach(handler2);
  };

  const handler2 = () => {
    count2++;
  };

  signal.attach(handler1);

  signal.post(1);
  assert.strictEqual(count1, 1);
  assert.strictEqual(count2, 0);

  signal.post(2);
  assert.strictEqual(count1, 1);
  assert.strictEqual(count2, 1);
});

test("Signal - post with no handlers does not throw", () => {
  const signal = new Signal<number>();
  signal.post(42); // should not throw
});

test("Signal - void signal works without payload", () => {
  const signal = new Signal();
  let count = 0;

  signal.attach(() => count++);
  signal.post();

  assert.strictEqual(count, 1);
});

test("Signal - disposable unsub can be called multiple times safely", () => {
  const signal = new Signal<number>();
  let count = 0;

  const unsub = signal.attach(() => count++);

  signal.post(1);
  assert.strictEqual(count, 1);

  unsub();
  unsub(); // calling again should be safe
  unsub();

  signal.post(2);
  assert.strictEqual(count, 1);
});

test("SignalType - asserts the inner payload correctly", () => {
  // We strictly check this via TS typing assignability
  type StringSignalType = SignalType<Signal<string>>;
  const stringTest: StringSignalType = "hello";
  assert.strictEqual(stringTest, "hello");

  type NumberSignalType = SignalType<StatefulSignal<number>>;
  const numberTest: NumberSignalType = 42;
  assert.strictEqual(numberTest, 42);

  type VoidSignalType = SignalType<Signal>;
  const voidTest: VoidSignalType = undefined;
  assert.strictEqual(voidTest, undefined);
});
