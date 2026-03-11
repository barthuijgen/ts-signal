import { assert, test, vi } from "vitest";
import { Signal } from "../src/signal.js";

test("setMaxHandlers - warns when handler count exceeds limit", () => {
  const signal = new Signal<void>();
  signal.setMaxHandlers(3);

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  signal.attach(() => {});
  signal.attach(() => {});
  signal.attach(() => {});
  assert.strictEqual(warnSpy.mock.calls.length, 0);

  signal.attach(() => {}); // 4th handler, exceeds limit of 3
  assert.strictEqual(warnSpy.mock.calls.length, 1);
  assert.include(warnSpy.mock.calls[0]?.[0], "exceeded the maximum of 3");

  warnSpy.mockRestore();
});

test("setMaxHandlers - default limit is 20", () => {
  const signal = new Signal<void>();

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  for (let i = 0; i < 20; i++) {
    signal.attach(() => {});
  }
  assert.strictEqual(warnSpy.mock.calls.length, 0);

  signal.attach(() => {}); // 21st
  assert.strictEqual(warnSpy.mock.calls.length, 1);

  warnSpy.mockRestore();
});

test("setMaxHandlers - set to 0 disables warning", () => {
  const signal = new Signal<void>();
  signal.setMaxHandlers(0);

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  for (let i = 0; i < 50; i++) {
    signal.attach(() => {});
  }

  assert.strictEqual(warnSpy.mock.calls.length, 0);

  warnSpy.mockRestore();
});
