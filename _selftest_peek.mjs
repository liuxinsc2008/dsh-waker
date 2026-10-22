/**
 * 唤醒器 · `peek` 自检（规格 §九）。
 *
 * 覆盖三条要求 + 一条最要紧的性质：
 *   ★★ ① peek【绝不许叫醒】对方 —— 不碰 `resolveAgent`（那会 resume）
 *   ② 读不到要报错（不静默返回空）
 *   ③ 缺 sessionQuery ⇒ 报错讲清"要挂 dsh-session-query-sqlite"
 *   ④ 三种 mode 各自走对接口（surface / events / recent）
 *
 * 用法：node _selftest_peek.mjs
 */
import fs from "node:fs/promises";

// ★ 2026-10-16 20:40 改：原来这里写死了【绝对路径】（而且是旧位置
//   `状态机/唤醒器`）⇒ 插件搬到 `插件/唤醒器` 后自检直接 ERR_MODULE_NOT_FOUND。
//   ⇒ 改成【相对本文件自己】⇒ ★ 以后再搬也不会坏（`_check_version.mjs` 本来就这么写）。
const MOD = new URL("lib/index.js", new URL(".", import.meta.url));
const mod = await import(MOD);

// ★ 2026-10-22 公开化：自测【自带假字典】—— ⛔ 不读使用者的任何文件
import _os from "node:os";
import _fs from "node:fs";
import _path from "node:path";

const FAKE_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), "waker-selftest-"));
const FAKE_TABLE = _path.join(FAKE_DIR, "会话id表.md");
_fs.writeFileSync(FAKE_TABLE, [
  "| 名字 | id |",
  "|---|---|",
  "| 甲 | `session-11111111-1111-1111-1111-111111111111` |",
  "| 乙 | `session-22222222-2222-2222-2222-222222222222` |",
  "| 丙 | `session-33333333-3333-3333-3333-333333333333` |",
].join("\n"), "utf8");
process.on("exit", () => { try { _fs.rmSync(FAKE_DIR, { recursive: true, force: true }); } catch {} });
const CFG = { sessionTable: FAKE_TABLE };

let pass = 0, fail = 0;
const ok = (n, c, x = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.log(`  ✗ ${n} ${x}`); }
};
const threw = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

/** 造 ctx；`withQuery=false` 模拟没挂后端 */
function makeCtx({ withQuery = true, readThrows = null } = {}) {
  const tools = [];
  const calls = { resolveAgent: [], prompt: [], readSurface: [], listEvents: [], readSession: [] };
  const sc = {
    async resolveAgent(id) { calls.resolveAgent.push(id); return { agent: { id } }; },
    async prompt(r) { calls.prompt.push(r); return { accepted: true }; },
    async list() { return { items: [] }; },
  };
  const sq = {
    async readSurface(id) {
      calls.readSurface.push(id);
      if (readThrows) throw readThrows;
      return {
        session: { id, version: 2 },
        inheritedEventCount: 0,
        capturedThroughSeq: 12,
        events: [
          { type: "user/message", seq: 3, time: 1, data: { message: { role: "user", content: "你上次说你不敢问我" } } },
          { type: "assistant/message", seq: 4, time: 2, data: { message: { role: "assistant", content: [{ type: "text", text: "好。" }] }, stream: [] } },
          { type: "assistant/message", seq: 5, time: 3, data: { message: { role: "assistant" }, stream: [{ type: "text-chunks", texts: ["（她", "笑了一下）"] }] } },
        ],
      };
    },
    async listEvents(id) {
      calls.listEvents.push(id);
      if (readThrows) throw readThrows;
      return [
        { sessionId: id, seq: 1, type: "turn/start", time: 1, surface: "log-only" },
        { sessionId: id, seq: 2, type: "user/message", time: 2, surface: "current" },
      ];
    },
    async readSession(id) {
      calls.readSession.push(id);
      if (readThrows) throw readThrows;
      return { session: { id }, inheritedEventCount: 0, events: [
        { type: "user/message", seq: 1, time: 1, data: { message: { role: "user", content: "甲" } } },
        { type: "user/message", seq: 2, time: 2, data: { message: { role: "user", content: "乙" } } },
        { type: "user/message", seq: 3, time: 3, data: { message: { role: "user", content: "丙" } } },
      ] };
    },
  };
  const ctx = {
    get: (n) => {
      if (n === "tools") return { register(d) { tools.push(d); return () => {}; } };
      if (n === "sessionController") return sc;
      if (n === "sessionQuery") return withQuery ? sq : undefined;
      return undefined;
    },
    effect: (fn) => fn(),
    logger: { info: () => {}, error: () => {} },
  };
  return { ctx, calls, tools };
}

console.log("=".repeat(74));
console.log("  唤醒器 · peek 自检（规格 §九）");
console.log("=".repeat(74));

// ── ① 注册与形状 ───────────────────────────────────────────────────
console.log("\n  [1] 工具形状");
const A = makeCtx(); mod.apply(A.ctx, CFG);
const peek = A.tools.find((d) => d?.name === "peek");
console.log("      注册的工具：", A.tools.map((d) => d.name).join(" · "));
ok("注册了 peek", !!peek);
ok("wake 也还在", !!A.tools.find((d) => d?.name === "wake"));
ok("mode 是 enum(3)", peek?.parameters?.properties?.mode?.enum?.length === 3);
ok("required 只有 target",
  JSON.stringify(peek?.parameters?.required) === JSON.stringify(["target"]));
ok("描述里写明'绝不会把它叫醒'",
  /绝.*叫醒/.test(peek?.description || ""), peek?.description);

// ── ② ★★ 绝不许叫醒 ───────────────────────────────────────────────
console.log("\n  [2] ★★ peek 绝不许叫醒对方");
const B = makeCtx(); mod.apply(B.ctx, CFG);
const peekB = B.tools.find((d) => d?.name === "peek");
const r1 = await peekB.execute({ target: "乙", mode: "surface" });
console.log("      返回 woke =", r1.woke, "· count =", r1.count);
ok("★★ 没有调 resolveAgent（那会 resume ⇒ 叫醒）",
  B.calls.resolveAgent.length === 0, String(B.calls.resolveAgent.length));
ok("★★ 没有调 prompt", B.calls.prompt.length === 0, String(B.calls.prompt.length));
ok("返回里明写 woke=false", r1.woke === false);
ok("note 里说明'没被叫醒'", /没被叫醒|没有调 resolveAgent/.test(r1.note || ""), r1.note);

// ── ③ 三种 mode 走对接口 ───────────────────────────────────────────
console.log("\n  [3] 三种 mode");
const C = makeCtx(); mod.apply(C.ctx, CFG);
const peekC = C.tools.find((d) => d?.name === "peek");
const rs = await peekC.execute({ target: "乙", mode: "surface" });
ok("★ surface ⇒ readSurface", C.calls.readSurface.length === 1);
ok("surface 返回含正文", rs.events.some((e) => (e.text || "").includes("好")),
  JSON.stringify(rs.events.map((e) => e.text)));
ok("surface 能从 stream 分块拼出正文",
  rs.events.some((e) => (e.text || "").includes("笑了一下")),
  JSON.stringify(rs.events.map((e) => e.text)));
ok("surface 报 capturedThroughSeq", rs.capturedThroughSeq === 12);

const re = await peekC.execute({ target: "乙", mode: "events" });
ok("★ events ⇒ listEvents", C.calls.listEvents.length === 1);
ok("events 返回的是元数据（有 seq/type）",
  re.events.every((e) => e.seq != null && e.type != null));
ok("★ events 的 note 里【说明没有正文】", /不含正文/.test(re.note || ""), re.note);

const rr = await peekC.execute({ target: "乙", mode: "recent", limit: 2 });
ok("★ recent ⇒ readSession", C.calls.readSession.length === 1);
ok("recent 按 limit 截尾（返回 2 条）", rr.count === 2, String(rr.count));
ok("recent 取的是【尾部】（乙 · 丙）",
  rr.events.map((e) => e.text).join(",") === "乙,丙",
  JSON.stringify(rr.events.map((e) => e.text)));
ok("recent 报了 totalEvents", rr.totalEvents === 3, String(rr.totalEvents));

// ══════════════════════════════════════════════════════════════════
//  ★★ [3b] 截断 —— 实测踩过的事故（2026-10-16）
//
//      `peek(target="丙", mode="events", limit=5)`
//        ⇒ **忽略了 limit** ⇒ 返回全部 19426 条 ⇒ 溢出 2.3 MB
//        ⇒ ★ 一次调用就能把调用方的上下文炸掉。
//
//      ⇒ 所以【三个模式都必须截】，且【不传 limit 也要截】（默认 50）。
// ══════════════════════════════════════════════════════════════════
console.log("\n  [3b] ★★ 截断（每个模式都必须截）");

/** 造一个"事件非常多"的 ctx —— 模拟一个 19426 条事件的会话 */
function makeBigCtx(n) {
  const tools = [];
  const many = Array.from({ length: n }, (_, k) => ({
    sessionId: "s", seq: k + 1, type: "user/message", time: k, surface: "current",
  }));
  const sq = {
    async readSurface() {
      return {
        session: {}, inheritedEventCount: 0, capturedThroughSeq: n,
        events: many.map((r) => ({
          type: r.type, seq: r.seq, time: r.time,
          data: { message: { role: "user", content: "x" } },
        })),
      };
    },
    async listEvents() { return many; },
    async readSession() { return { session: {}, inheritedEventCount: 0, events: many }; },
  };
  const ctx = {
    get: (x) => (x === "tools"
      ? { register(d) { tools.push(d); return () => {}; } }
      : x === "sessionQuery" ? sq : undefined),
    effect: (fn) => fn(),
    logger: { info: () => {}, error: () => {} },
  };
  return { ctx, tools };
}

const H = makeBigCtx(19426);
mod.apply(H.ctx, CFG);
const peekH = H.tools.find((d) => d?.name === "peek");

const h1 = await peekH.execute({ target: "丙", mode: "events", limit: 5 });
console.log(`      events limit=5    ⇒ 返回 ${h1.count} 条（总数 ${h1.totalEvents}）`);
ok("★★ events 模式【真的截断了】（limit=5 ⇒ 5 条）", h1.count === 5, String(h1.count));
ok("★★ 没有把 19426 条全丢出来", h1.count < 100, String(h1.count));
ok("报出总数（知道是截过的）", h1.totalEvents === 19426, String(h1.totalEvents));
ok("报出 limit", h1.limit === 5, String(h1.limit));
ok("★ note 里说明'已按 limit 截尾部'", /已按 limit 截/.test(h1.note || ""), h1.note);

const h2 = await peekH.execute({ target: "丙", mode: "events" });   // ★ 不传 limit
console.log(`      events 不传 limit  ⇒ 返回 ${h2.count} 条`);
ok("★★ 不传 limit ⇒ 走【安全默认】50（不是全量）", h2.count === 50, String(h2.count));

const h3 = await peekH.execute({ target: "丙", mode: "events", limit: 99999 });
console.log(`      events limit=99999 ⇒ 返回 ${h3.count} 条`);
ok("★ 超过上限 ⇒ 截到上限 200", h3.count === 200, String(h3.count));

const h4 = await peekH.execute({ target: "丙", mode: "surface", limit: 7 });
console.log(`      surface limit=7   ⇒ 返回 ${h4.count} 条（总数 ${h4.totalEvents}）`);
ok("★★ surface 模式也截断（limit=7 ⇒ 7 条）", h4.count === 7, String(h4.count));
ok("surface 报出 totalEvents", h4.totalEvents === 19426, String(h4.totalEvents));

const h5 = await peekH.execute({ target: "丙", mode: "surface" });   // ★ 不传 limit
console.log(`      surface 不传 limit ⇒ 返回 ${h5.count} 条`);
ok("★ surface 不传 limit ⇒ 安全默认 50", h5.count === 50, String(h5.count));

const h6 = await peekH.execute({ target: "丙", mode: "recent", limit: 3 });
ok("recent 也截（limit=3 ⇒ 3 条）", h6.count === 3, String(h6.count));

// ★ 取的是【尾部】不是开头 —— 那才是"最近发生了什么"
const tail = await peekH.execute({ target: "丙", mode: "events", limit: 3 });
ok("★★ 截的是【尾部】（最近的），不是开头",
  tail.events.map((e) => e.seq).join(",") === "19424,19425,19426",
  JSON.stringify(tail.events.map((e) => e.seq)));

// ★ 最后一道闸：谁都不许超上限
for (const m of ["surface", "events", "recent"]) {
  const g = await peekH.execute({ target: "丙", mode: m, limit: 200 });
  ok(`上限守卫：${m} ≤ 200`, g.count <= 200, String(g.count));
}

// ★ 事故原样复现：mode=events + limit=5
const accident = await peekH.execute({ target: "丙", mode: "events", limit: 5 });
const bytes = JSON.stringify(accident).length;
console.log(`      ★ 事故复现：返回体积 ${bytes} 字节（原来 2.3 MB）`);
ok("★★ 事故原样复现【不再溢出】（远小于 2.3 MB）", bytes < 5000, String(bytes));

// ══════════════════════════════════════════════════════════════════
//  [3c] ★★ 能力自述 —— "改了但没重载"这件事的判据
//
//      同一个坑踩了两次：报的"缺陷"其实早修好了，
//      只是运行时跑的是旧模块 ⇒ **每次都要人肉比对版本号**。
//      ⇒ 所以返回里带 `version` + `caps`；旧模块没有 `caps` ⇒ 一眼可判。
// ══════════════════════════════════════════════════════════════════
console.log("\n  [3c] ★★ 能力自述（判'跑的是哪一份模块'）");
ok("★ peek 返回里有 version", typeof h1.version === "string" && h1.version.length > 0,
  String(h1.version));
ok("★★ peek 返回里有 caps", h1.caps && typeof h1.caps === "object", String(h1.caps));
ok("★ caps 声明 peekLimitAllModes（v0.1.3 的能力）",
  h1.caps?.peekLimitAllModes === true, JSON.stringify(h1.caps));
ok("★ caps 声明三个 mode",
  JSON.stringify(h1.caps?.peekModes) === JSON.stringify(["surface", "events", "recent"]),
  JSON.stringify(h1.caps?.peekModes));
ok("★ caps 里有值就说明【这份模块认得 limit 截断】—— 旧模块没有这个字段",
  h1.caps !== undefined);

// ── ④ 读不到要报错（不静默返回空）─────────────────────────────────
console.log("\n  [4] 读不到 ⇒ 报错（不许静默返回空）");
const D = makeCtx({ readThrows: Object.assign(new Error("gone"), { code: "session/not-found" }) });
mod.apply(D.ctx, CFG);
const peekD = D.tools.find((d) => d?.name === "peek");
const e1 = await threw(() => peekD.execute({ target: "乙", mode: "surface" }));
console.log("      报错：", String(e1?.message || "(没报错)").split("\n")[0]);
ok("真的报错了", e1 !== null, "★ 没报错 —— 那是静默返回空");
ok("错误里带失败码", e1 && /session\/not-found/.test(e1.message));
ok("错误里说明'不静默返回空'", e1 && /不静默返回空/.test(e1.message));

// ── ⑤ 缺 sessionQuery ⇒ 报错讲清要挂哪个 ───────────────────────────
console.log("\n  [5] 缺 sessionQuery ⇒ 报错讲清要挂后端");
const E = makeCtx({ withQuery: false });
mod.apply(E.ctx, CFG);
const peekE = E.tools.find((d) => d?.name === "peek");
const e2 = await threw(() => peekE.execute({ target: "乙", mode: "surface" }));
console.log("      报错：", String(e2?.message || "(没报错)").split("\n")[0]);
ok("真的报错了", e2 !== null);
ok("★ 讲清了要挂 dsh-session-query-sqlite",
  e2 && /dsh-session-query-sqlite/.test(e2.message), e2?.message);

// ── ⑥ 输入自检 ─────────────────────────────────────────────────────
console.log("\n  [6] 输入自检");
const F = makeCtx(); mod.apply(F.ctx, CFG);
const peekF = F.tools.find((d) => d?.name === "peek");
ok("target 不认识 ⇒ 报错",
  (await threw(() => peekF.execute({ target: "张三" }))) !== null);
ok("mode 不认识 ⇒ 报错",
  (await threw(() => peekF.execute({ target: "乙", mode: "瞎写" }))) !== null);
const rd = await peekF.execute({ target: "乙", mode: "surface" });
ok("默认 mode = surface", rd.mode === "surface" && F.calls.readSurface.length === 1);

console.log();
console.log("=".repeat(74));
console.log(`  通过 ${pass} · 失败 ${fail}`);
console.log("=".repeat(74));
process.exit(fail ? 1 : 0);
