import { assert, test } from "vitest";
import {
  Signal,
  SignalTimeoutError,
  type SignalType,
  StatefulSignal,
} from "../src/signal.js";

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

test("Signal - waitFor resolves on next fire", async () => {
  const signal = new Signal<string>();

  const promise = signal.waitFor();
  signal.post("first");
  signal.post("second");

  const result = await promise;
  assert.strictEqual(result, "first");
});

test("Signal - waitFor with AbortSignal rejects with SignalAbortError", async () => {
  const signal = new Signal<string>();
  const ac = new AbortController();

  const promise = signal.waitFor(undefined, ac.signal);
  ac.abort();

  let error: unknown;
  try {
    await promise;
  } catch (err) {
    error = err;
  }

  // It should reject with an SignalAbortError
  assert(
    error instanceof Error ||
      (typeof DOMException !== "undefined" && error instanceof DOMException),
  );
  assert.strictEqual((error as Error).name, "SignalAbortError");
});

test("Signal - waitFor with timeout throws if not fired", async () => {
  const signal = new Signal<string>();

  let error: unknown;
  try {
    await signal.waitFor(10); // Wait 10ms for a value
  } catch (err) {
    error = err;
  }

  assert.instanceOf(error, SignalTimeoutError);
});

test("Signal - waitFor with timeout resolves if fired in time", async () => {
  const signal = new Signal<string>();

  const promise = signal.waitFor(50);
  signal.post("in time!");

  const result = await promise;
  assert.strictEqual(result, "in time!");
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

test("Signal - filter should narrow types correctly", () => {
  const signal = new Signal<number | string>();

  const isString = (payload: number | string): payload is string =>
    typeof payload === "string";

  const stringSignal = signal.filter(isString);

  const received: string[] = [];
  stringSignal.attach((payload) => {
    received.push(payload);
  });

  signal.post(42);
  signal.post("hello");
  signal.post(100);
  signal.post("world");

  assert.deepEqual(received, ["hello", "world"]);
});

test("Signal - filter should filter via boolean predicate", () => {
  const signal = new Signal<number>();
  const evenSignal = signal.filter((p) => p % 2 === 0);

  const received: number[] = [];
  evenSignal.attach((payload) => received.push(payload));

  signal.post(1);
  signal.post(2);
  signal.post(3);
  signal.post(4);

  assert.deepEqual(received, [2, 4]);
});

test("Signal - filter with AbortSignal stops child emissions", () => {
  const signal = new Signal<number>();
  const ac = new AbortController();
  const childSignal = signal.filter((p) => p > 5, ac.signal);

  const received: number[] = [];
  childSignal.attach((payload) => received.push(payload));

  signal.post(10);
  assert.deepEqual(received, [10]);

  ac.abort();

  signal.post(20);
  assert.deepEqual(received, [10]);
});

test("Signal - pipe should transform emitted values", () => {
  const signal = new Signal<{ type: "message"; message: string }>();

  // Single transform function
  const messages = signal.pipe((event) => event.message);

  const received: string[] = [];
  messages.attach((msg) => received.push(msg));

  signal.post({ type: "message", message: "hello" });
  signal.post({ type: "message", message: "world" });

  assert.deepEqual(received, ["hello", "world"]);
});

test("Signal - pipe should compose multiple transform functions", () => {
  const signal = new Signal<number>();

  const resultSignal = signal.pipe(
    (n) => n * 2,
    (n) => n.toString(),
    (s) => s + "!",
  );

  const received: string[] = [];
  resultSignal.attach((msg) => received.push(msg));

  signal.post(5);
  signal.post(10);

  assert.deepEqual(received, ["10!", "20!"]);
});

test("Signal - toStateful creates a StatefulSignal bound to parent", () => {
  const parent = new Signal<number>();
  const stateful = parent.toStateful(0);

  let value: number | undefined;
  stateful.attach((v: number) => {
    value = v;
  });

  assert.strictEqual(value, 0); // attached instantly fires
  assert.strictEqual(stateful.state, 0);

  parent.post(100);

  assert.strictEqual(value, 100);
  assert.strictEqual(stateful.state, 100);
});

test("StatefulSignal - initialization and synchronous emission", () => {
  const signal = new StatefulSignal<number>(42);
  let value: number | undefined;

  signal.attach((v: number) => {
    value = v;
  });

  assert.strictEqual(value, 42);
});

test("StatefulSignal - waitFor resolves immediately with current state", async () => {
  const signal = new StatefulSignal<number>(100);

  const result = await signal.waitFor();
  assert.strictEqual(result, 100);
});

test("StatefulSignal - post updates state and emits", () => {
  const signal = new StatefulSignal<string>("initial");
  let value = "";
  let emissions = 0;

  signal.attach((v: string) => {
    value = v;
    emissions++;
  });

  assert.strictEqual(value, "initial");
  assert.strictEqual(emissions, 1);
  assert.strictEqual(signal.state, "initial");

  signal.post("updated");

  assert.strictEqual(value, "updated");
  assert.strictEqual(emissions, 2);
  assert.strictEqual(signal.state, "updated");
});

test("StatefulSignal - attaching with an already aborted signal doesn't trigger", () => {
  const signal = new StatefulSignal<number>(42);
  const ac = new AbortController();
  ac.abort();

  let value: number | undefined;
  signal.attach((v: number) => {
    value = v;
  }, ac.signal);

  assert.strictEqual(value, undefined);
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
