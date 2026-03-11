import { assert, test } from "vitest";
import { Signal, SignalTimeoutError } from "../src/signal.js";

test("waitFor - resolves on next fire", async () => {
  const signal = new Signal<string>();

  const promise = signal.waitFor();
  signal.post("first");
  signal.post("second");

  const result = await promise;
  assert.strictEqual(result, "first");
});

test("waitFor - with AbortSignal rejects with SignalAbortError", async () => {
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

  assert(error instanceof Error);
  assert.strictEqual((error as Error).name, "SignalAbortError");
});

test("waitFor - with timeout throws if not fired", async () => {
  const signal = new Signal<string>();

  let error: unknown;
  try {
    await signal.waitFor(10);
  } catch (err) {
    error = err;
  }

  assert.instanceOf(error, SignalTimeoutError);
});

test("waitFor - with timeout resolves if fired in time", async () => {
  const signal = new Signal<string>();

  const promise = signal.waitFor(50);
  signal.post("in time!");

  const result = await promise;
  assert.strictEqual(result, "in time!");
});

test("waitFor - with already aborted AbortSignal rejects immediately", async () => {
  const signal = new Signal<number>();
  const ac = new AbortController();
  ac.abort("test reason");

  let error: unknown;
  try {
    await signal.waitFor(undefined, ac.signal);
  } catch (err) {
    error = err;
  }

  assert(error instanceof Error);
  assert.strictEqual((error as Error).name, "SignalAbortError");
});

test("waitFor - with both timeout and AbortSignal, abort wins", async () => {
  const signal = new Signal<number>();
  const ac = new AbortController();

  const promise = signal.waitFor(1000, ac.signal);
  ac.abort();

  let error: unknown;
  try {
    await promise;
  } catch (err) {
    error = err;
  }

  assert(error instanceof Error);
  assert.strictEqual((error as Error).name, "SignalAbortError");
});

test("waitFor - with both timeout and AbortSignal, timeout wins", async () => {
  const signal = new Signal<number>();
  const ac = new AbortController();

  let error: unknown;
  try {
    await signal.waitFor(10, ac.signal);
  } catch (err) {
    error = err;
  }

  assert.instanceOf(error, SignalTimeoutError);
});
