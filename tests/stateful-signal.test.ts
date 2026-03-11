import { assert, test } from "vitest";
import { Signal, StatefulSignal } from "../src/signal.js";

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

test("StatefulSignal - attachOnce works securely with synchronous firing", () => {
  const signal = new StatefulSignal<string>("initial");
  let count = 0;
  let val = "";

  signal.attachOnce((v) => {
    count++;
    val = v;
  });

  assert.strictEqual(count, 1);
  assert.strictEqual(val, "initial");

  signal.post("second");

  assert.strictEqual(count, 1);
  assert.strictEqual(val, "initial");
});

test("StatefulSignal - state getter returns current state", () => {
  const signal = new StatefulSignal<number>(0);

  assert.strictEqual(signal.state, 0);

  signal.post(10);
  assert.strictEqual(signal.state, 10);

  signal.post(20);
  assert.strictEqual(signal.state, 20);
});

test("StatefulSignal - multiple attach all receive current state immediately", () => {
  const signal = new StatefulSignal<number>(5);
  const values: number[] = [];

  signal.attach((v) => values.push(v));
  signal.attach((v) => values.push(v * 10));

  // First attach gets 5, second attach gets 5 (as 50)
  assert.deepEqual(values, [5, 50]);
});

test("StatefulSignal - attach with AbortSignal receives state then detaches on abort", () => {
  const signal = new StatefulSignal<number>(42);
  const ac = new AbortController();
  const received: number[] = [];

  signal.attach((v) => received.push(v), ac.signal);

  // Should have received initial state
  assert.deepEqual(received, [42]);

  signal.post(100);
  assert.deepEqual(received, [42, 100]);

  ac.abort();

  signal.post(200);
  assert.deepEqual(received, [42, 100]); // no new values after abort
});
