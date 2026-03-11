import { assert, test } from "vitest";
import { Signal } from "../src/signal.js";

declare const globalThis: {
  gc?: () => void;
};

const testGC = typeof globalThis.gc !== "undefined" ? test : test.skip;

const runGarbageCleanup = async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  globalThis.gc!();
  await new Promise((resolve) => setTimeout(resolve, 100));
};

testGC(
  "Signal - filter is kept alive while it has an active handler",
  async () => {
    const signal = new Signal<number>();
    let count = 0;

    (() => {
      signal
        .filter((n) => n > 5)
        .attach(() => {
          count++;
        });
    })();

    signal.post(10);
    assert.strictEqual(count, 1, "Handler works initially");

    await runGarbageCleanup();

    signal.post(20);
    assert.strictEqual(
      count,
      2,
      "Handler should still work (filter not garbage collected)",
    );
  },
);

testGC(
  "Signal - filter is garbage collected after last handler is detached",
  async () => {
    const signal = new Signal<number>();
    let weakFilter: WeakRef<Signal<any>> | undefined;

    let unsubscribe: () => void;

    (() => {
      const filtered = signal.filter((n) => n > 5);
      weakFilter = new WeakRef(filtered);
      unsubscribe = filtered.attach(() => {});
    })();

    await runGarbageCleanup();
    assert.isDefined(
      weakFilter.deref(),
      "Filter should NOT be garbage collected while handler is active",
    );

    unsubscribe!();

    await runGarbageCleanup();
    assert.isUndefined(
      weakFilter!.deref(),
      "Filter should be garbage collected after handler detaches",
    );
  },
);

testGC(
  "Signal - pipe is kept alive while it has an active handler",
  async () => {
    const signal = new Signal<number>();
    let count = 0;

    (() => {
      signal
        .pipe((n) => n * 2)
        .attach(() => {
          count++;
        });
    })();

    signal.post(10);
    assert.strictEqual(count, 1, "Handler works initially");

    await runGarbageCleanup();

    signal.post(20);
    assert.strictEqual(
      count,
      2,
      "Handler should still work (pipe not garbage collected)",
    );
  },
);

testGC(
  "Signal - pipe is garbage collected after last handler is detached",
  async () => {
    const signal = new Signal<number>();
    let weakPipe: WeakRef<Signal<any>> | undefined;

    let unsubscribe: () => void;

    (() => {
      const piped = signal.pipe((n) => n * 2);
      weakPipe = new WeakRef(piped);
      unsubscribe = piped.attach(() => {});
    })();

    await runGarbageCleanup();

    assert.isDefined(
      weakPipe.deref(),
      "Pipe should NOT be garbage collected while handler is active",
    );

    unsubscribe!();

    await runGarbageCleanup();

    assert.isUndefined(
      weakPipe!.deref(),
      "Pipe should be garbage collected after handler detaches",
    );
  },
);

testGC(
  "Signal - toStateful is kept alive while it has an active handler",
  async () => {
    const signal = new Signal<number>();
    let count = 0;

    (() => {
      signal.toStateful(0).attach(() => {
        count++;
      });
    })();

    signal.post(10);
    assert.strictEqual(
      count,
      2,
      "Handler works initially for initial state and first post",
    );

    await runGarbageCleanup();

    signal.post(20);
    assert.strictEqual(
      count,
      3,
      "Handler should still work (toStateful not garbage collected)",
    );
  },
);

testGC(
  "Signal - toStateful is garbage collected when no handlers are active",
  async () => {
    const signal = new Signal<number>();
    let weakStateful: WeakRef<Signal<any>> | undefined;

    (() => {
      const stateful = signal.toStateful(0);
      weakStateful = new WeakRef(stateful);
    })(); // no handlers attached

    await runGarbageCleanup();
    assert.isUndefined(
      weakStateful!.deref(),
      "toStateful should be garbage collected if never attached",
    );
  },
);

testGC(
  "Signal - toStateful is garbage collected after last handler detaches",
  async () => {
    const signal = new Signal<number>();
    let weakStateful: WeakRef<Signal<any>> | undefined;

    let unsubscribe: () => void;

    (() => {
      const stateful = signal.toStateful(0);
      weakStateful = new WeakRef(stateful);
      unsubscribe = stateful.attach(() => {});
    })();

    await runGarbageCleanup();
    assert.isDefined(
      weakStateful.deref(),
      "toStateful should NOT be garbage collected while handler is active",
    );

    unsubscribe!();

    await runGarbageCleanup();
    assert.isUndefined(
      weakStateful!.deref(),
      "toStateful should be garbage collected after handler detaches",
    );
  },
);
