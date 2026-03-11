import { assert, test } from "vitest";
import { Signal } from "../src/signal.js";

// ── filter ──────────────────────────────────────────────────────────

test("filter - narrows types correctly with type guard", () => {
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

test("filter - narrows discriminated unions without explicit type guard", () => {
  type Event =
    | { type: "message"; text: string }
    | { type: "error"; code: number };

  const events = new Signal<Event>();
  const errors = events.filter((e) => e.type === "error");

  const codes: number[] = [];
  errors.attach((e) => {
    // This assignment verifies TS narrowed `e` to the error variant.
    // If filter doesn't narrow, `e.code` would be a type error.
    const code: number = e.code;
    codes.push(code);
  });

  events.post({ type: "message", text: "hi" });
  events.post({ type: "error", code: 404 });
  events.post({ type: "error", code: 500 });

  assert.deepEqual(codes, [404, 500]);
});

test("filter - filters via boolean predicate", () => {
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

test("filter - with AbortSignal stops child emissions", () => {
  const signal = new Signal<number>();
  const ac = new AbortController();
  const childSignal = signal.filter((p) => p > 5);

  const received: number[] = [];
  childSignal.attach((payload) => received.push(payload), ac.signal);

  signal.post(10);
  assert.deepEqual(received, [10]);

  ac.abort();

  signal.post(20);
  assert.deepEqual(received, [10]);
});

test("filter - lazy subscription: parent has no handlers until child is attached", () => {
  const signal = new Signal<number>();
  const filtered = signal.filter((n) => n > 0);

  // Post before attaching to filtered - nothing should happen
  const received: number[] = [];

  // Now attach
  const unsub = filtered.attach((v) => received.push(v));

  signal.post(5);
  assert.deepEqual(received, [5]);

  // Detach - parent should also be unsubscribed
  unsub();

  signal.post(10);
  assert.deepEqual(received, [5]);
});

test("filter - multiple handlers on filtered signal", () => {
  const signal = new Signal<number>();
  const filtered = signal.filter((n) => n > 0);

  let count1 = 0;
  let count2 = 0;

  const unsub1 = filtered.attach(() => count1++);
  const unsub2 = filtered.attach(() => count2++);

  signal.post(5);
  assert.strictEqual(count1, 1);
  assert.strictEqual(count2, 1);

  // Detach one - filtered should still be subscribed to parent
  unsub1();
  signal.post(10);
  assert.strictEqual(count1, 1);
  assert.strictEqual(count2, 2);

  // Detach last - filtered should unsubscribe from parent
  unsub2();
  signal.post(15);
  assert.strictEqual(count2, 2);
});

// ── pipe ────────────────────────────────────────────────────────────

test("pipe - single transform function", () => {
  const signal = new Signal<{ type: "message"; message: string }>();

  const messages = signal.pipe((event) => event.message);

  const received: string[] = [];
  messages.attach((msg) => received.push(msg));

  signal.post({ type: "message", message: "hello" });
  signal.post({ type: "message", message: "world" });

  assert.deepEqual(received, ["hello", "world"]);
});

test("pipe - multiple composed transform functions", () => {
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

test("pipe - lazy subscription and teardown", () => {
  const signal = new Signal<number>();
  const piped = signal.pipe((n) => n * 2);

  const received: number[] = [];
  const unsub = piped.attach((v) => received.push(v));

  signal.post(3);
  assert.deepEqual(received, [6]);

  unsub();

  signal.post(5);
  assert.deepEqual(received, [6]); // no new values
});

test("pipe - with AbortSignal", () => {
  const signal = new Signal<number>();
  const ac = new AbortController();
  const piped = signal.pipe((n) => n + 1);

  const received: number[] = [];
  piped.attach((v) => received.push(v), ac.signal);

  signal.post(1);
  assert.deepEqual(received, [2]);

  ac.abort();

  signal.post(2);
  assert.deepEqual(received, [2]);
});

test("pipe - multiple handlers on piped signal", () => {
  const signal = new Signal<number>();
  const piped = signal.pipe((n) => n * 10);

  let sum = 0;
  const unsub1 = piped.attach((v) => (sum += v));
  const unsub2 = piped.attach((v) => (sum += v));

  signal.post(1);
  assert.strictEqual(sum, 20); // 10 + 10

  unsub1();
  signal.post(2);
  assert.strictEqual(sum, 40); // 20 more

  unsub2();
  signal.post(3);
  assert.strictEqual(sum, 40); // no more
});

// ── toStateful ──────────────────────────────────────────────────────

test("toStateful - creates a StatefulSignal bound to parent", () => {
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

test("toStateful - lazy subscription and teardown", () => {
  const parent = new Signal<number>();
  const stateful = parent.toStateful(0);

  const received: number[] = [];
  const unsub = stateful.attach((v) => received.push(v));

  // Should get initial state immediately
  assert.deepEqual(received, [0]);

  parent.post(5);
  assert.deepEqual(received, [0, 5]);

  unsub();

  parent.post(10);
  assert.deepEqual(received, [0, 5]); // no new values
});

test("toStateful - state persists after detach", () => {
  const parent = new Signal<number>();
  const stateful = parent.toStateful(0);

  const unsub = stateful.attach(() => {});
  parent.post(42);
  unsub();

  assert.strictEqual(stateful.state, 42);
});

// ── detach() tears down parent subscription on derived signals ──────

test("filter - detach() unsubscribes from parent", () => {
  const signal = new Signal<number>();
  const filtered = signal.filter((n) => n > 0);

  const received: number[] = [];
  filtered.attach((v) => received.push(v));

  signal.post(5);
  assert.deepEqual(received, [5]);

  filtered.detach();

  signal.post(10);
  assert.deepEqual(received, [5]);

  // Re-attaching should resubscribe to parent
  filtered.attach((v) => received.push(v));
  signal.post(15);
  assert.deepEqual(received, [5, 15]);
});

test("pipe - detach() unsubscribes from parent", () => {
  const signal = new Signal<number>();
  const piped = signal.pipe((n) => n * 2);

  const received: number[] = [];
  piped.attach((v) => received.push(v));

  signal.post(3);
  assert.deepEqual(received, [6]);

  piped.detach();

  signal.post(5);
  assert.deepEqual(received, [6]);
});

test("toStateful - detach() unsubscribes from parent", () => {
  const parent = new Signal<number>();
  const stateful = parent.toStateful(0);

  const received: number[] = [];
  stateful.attach((v) => received.push(v));

  parent.post(5);
  assert.deepEqual(received, [0, 5]);

  stateful.detach();

  parent.post(10);
  assert.deepEqual(received, [0, 5]);
});

test("filter - detach(handler) for last handler unsubscribes from parent", () => {
  const signal = new Signal<number>();
  const filtered = signal.filter((n) => n > 0);

  const received: number[] = [];
  const handler = (v: number) => received.push(v);
  filtered.attach(handler);

  signal.post(5);
  assert.deepEqual(received, [5]);

  filtered.detach(handler);

  signal.post(10);
  assert.deepEqual(received, [5]);
});
