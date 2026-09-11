/**
 * Unit 测试环境补齐：为纯 Node（`environment: "node"`）提供浏览器端 Web Storage API。
 *
 * 背景：`@/lib/conflict-handler` 的 `DraftManager`（ORB-012 草稿本地暂存）依赖
 * `window.localStorage` / 全局 `localStorage`。unit 项目未安装 jsdom/happy-dom，
 * 默认 Node 环境下 `window` 未定义，导致相关单测在 beforeEach 直接抛
 * "localStorage unavailable in test environment"。
 *
 * 本 setup 仅在缺失时注入一个**内存实现**的 Storage，使这些单测能真正执行
 * DraftManager 的读写/清除逻辑（而非跳过）。实现为「自有方法」的普通对象，
 * 其原型为 `Object.prototype`（不含 setItem），因此测试内
 * `vi.spyOn(Object.getPrototypeOf(window.localStorage), 'setItem')` 会按设计
 * 走 catch 回退分支，使用真实内存实现，不破坏断言语义。
 *
 * 只影响引用 window/localStorage 的单测（当前仅 conflict-handler.test.ts），
 * 其余 unit 测试不触及这些全局，行为不变。
 */

function createMemoryStorage(): Storage {
  // 用普通对象承载存储：
  //  - 数据键 → 可枚举自有属性（对齐浏览器 `Object.keys(localStorage)` 返回已存储键的行为，
  //    DraftManager.clearProject 依赖此语义）；
  //  - 方法 → 不可枚举自有属性（使 [[Prototype]] 保持为 Object.prototype，
  //    从而测试内 `vi.spyOn(Object.getPrototypeOf(window.localStorage), 'setItem')`
  //    因 Object.prototype 无 setItem 而抛错，按设计走 catch 回退，使用真实内存实现）。
  const storage: Record<string, unknown> = {};

  const defineMethod = (name: string, fn: (...args: unknown[]) => unknown): void => {
    Object.defineProperty(storage, name, {
      value: fn,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  };

  const dataKeys = (): string[] => Object.keys(storage);

  defineMethod("setItem", (key: unknown, value: unknown) => {
    Object.defineProperty(storage, String(key), {
      value: String(value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });

  defineMethod("getItem", (key: unknown) => {
    const k = String(key);
    return Object.prototype.propertyIsEnumerable.call(storage, k)
      ? (storage[k] as string)
      : null;
  });

  defineMethod("removeItem", (key: unknown) => {
    delete storage[String(key)];
  });

  defineMethod("clear", () => {
    for (const k of dataKeys()) {
      delete storage[k];
    }
  });

  defineMethod("key", (index: unknown) => {
    const keys = dataKeys();
    const i = Number(index);
    return i >= 0 && i < keys.length ? keys[i] : null;
  });

  Object.defineProperty(storage, "length", {
    get: () => dataKeys().length,
    enumerable: false,
    configurable: true,
  });

  return storage as unknown as Storage;
}


const g = globalThis as unknown as {
  localStorage?: Storage;
  window?: { localStorage?: Storage } & Record<string, unknown>;
};

if (typeof g.localStorage === "undefined") {
  const memoryStorage = createMemoryStorage();
  g.localStorage = memoryStorage;

  if (typeof g.window === "undefined") {
    // 最小 window 桩：仅提供 localStorage（当前 unit 测试的唯一诉求）。
    g.window = { localStorage: memoryStorage };
  } else if (typeof g.window.localStorage === "undefined") {
    g.window.localStorage = memoryStorage;
  }
}
