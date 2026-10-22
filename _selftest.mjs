/**
 * 唤醒器自检 —— ★ 不依赖装进 DSH：用一个**假的 ctx / sessionController** 跑。
 *
 * 覆盖：
 *   ① 表解析（用自带假字典）
 *   ② 三条硬要求：投递有回执 · 不存在要报错 · ★ 不许投给自己
 *   ③ 字段形状（★ 照 schema 原文，别写回 `session:` / `text:`）
 *   ④ 失败路径不静默（resolveAgent 给 error / prompt 不 accepted）
*   ⑨ tools 未就绪 ⇒ 【不炸 · 等它就绪再注册】（★ 2026-10-16 改契约）
 *
 * 用法：node _selftest.mjs
 */
import fs from "node:fs/promises";
// ★★★ 2026-10-22（v0.4.0）：resolveTarget / sessions 现在会【先重建字典】
//   ⇒ 测试把 DSH_HOME 指到临时目录，并往里放【假的会话投影】
//   ⇒ rebuildTable 扫到假投影 ⇒ 写出假字典 ⇒ 测试自洽，⛔ 不碰真数据
import _osIso from "node:os";
import _fsIso from "node:fs";
import _pathIso from "node:path";
const _ISO_HOME = _fsIso.mkdtempSync(_pathIso.join(_osIso.tmpdir(), "waker-iso-"));
process.env.DSH_HOME = _ISO_HOME;
const _ISO_SESS = _pathIso.join(_ISO_HOME, "storages", "session_projcache", "sessions");
_fsIso.mkdirSync(_ISO_SESS, { recursive: true });

/** ★ 造一个假会话投影（rebuildTable 会扫它） */
function _fakeSession(sid, title, extraRows = {}) {
  const rec = {
    identity: { createdAt: 1000, formatVersion: 4 },
    rows: Object.assign({
      title: { val: title },
      sessionListMetadata: { val: { lastPromptAt: 1000, blank: false } },
    }, extraRows),
  };
  _fsIso.writeFileSync(_pathIso.join(_ISO_SESS, sid + ".json"),
    JSON.stringify({ record: rec }), "utf8");
}

_fakeSession("session-11111111-1111-1111-1111-111111111111", "甲");
_fakeSession("session-22222222-2222-2222-2222-222222222222", "乙");
_fakeSession("session-33333333-3333-3333-3333-333333333333", "丙");

process.on("exit", () => { try { _fsIso.rmSync(_ISO_HOME, { recursive: true, force: true }); } catch {} });



// ★ 2026-10-16 20:40 改：原来这里写死了【绝对路径】（而且是旧位置
//   `状态机/唤醒器`）⇒ 插件搬到 `插件/唤醒器` 后自检直接 ERR_MODULE_NOT_FOUND。
//   ⇒ 改成【相对本文件自己】⇒ ★ 以后再搬也不会坏（`_check_version.mjs` 本来就这么写）。
const MOD = new URL("lib/index.js", new URL(".", import.meta.url));
const mod = await import(MOD);
// ★ 2026-10-22 公开化：自测【自带假字典】—— ⛔ 不读使用者的任何文件
import _os from "node:os";
import _fs from "node:fs";
import _path from "node:path";

const FAKE_DIR = _ISO_HOME;
_fs.mkdirSync(_path.join(FAKE_DIR, "storages", "session_projcache", "sessions"), { recursive: true });
const FAKE_TABLE = _path.join(_ISO_HOME, "waker-会话id表.md");
_fs.writeFileSync(FAKE_TABLE, [
  "| 名字 | id |",
  "|---|---|",
  "| 甲 | `session-11111111-1111-1111-1111-111111111111` |",
  "| 乙 | `session-22222222-2222-2222-2222-222222222222` |",
  "| 丙 | `session-33333333-3333-3333-3333-333333333333` |",
].join("\n"), "utf8");
process.on("exit", () => { try { _fs.rmSync(FAKE_DIR, { recursive: true, force: true }); } catch {} });
const CFG = { sessionTable: FAKE_TABLE };

const { parseSessionTable } = mod;

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const threw = async (fn) => {
  try { await fn(); return null; } catch (e) { return e; }
};

function makeCtx({ items = [], resolveResult = null, promptResult = { accepted: true } } = {}) {
  const calls = { resolveAgent: [], prompt: [], list: [] };
  const tools = [];
  const sc = {
    async resolveAgent(id) {
      calls.resolveAgent.push(id);
      if (resolveResult instanceof Error) throw resolveResult;
      return resolveResult ?? { agent: { id } };
    },
    async prompt(req) { calls.prompt.push(req); return promptResult; },
    async list() { calls.list.push(1); return { items }; },
  };
  const services = { sessionController: sc, tools: {
    register(def) { tools.push(def); return () => { tools.length = 0; }; },
  } };
  const effects = [];
  const ctx = {
    get: (n) => services[n],
    effect: (fn) => { effects.push(fn); },
    logger: { info: () => {}, error: () => {} },
  };
  return { ctx, calls, tools, sc, run: () => effects.forEach((f) => f()) };
}

console.log("=".repeat(74));
console.log("  唤醒器自检");
console.log("=".repeat(74));

// ── ① 表解析 ───────────────────────────────────────────────────────
console.log("\n  [1] 表解析（用自带假字典）");
// ★ 2026-10-22 公开化：⛔ 不读本机文件 —— 用【自带的假字典】
const md = [
  "| 名字 | id |",
  "|---|---|",
  "| 甲 | `session-11111111-1111-1111-1111-111111111111` |",
  "| 乙 | `session-22222222-2222-2222-2222-222222222222` |",
  "| 丙 | `session-33333333-3333-3333-3333-333333333333` |",
].join("\n");
const table = parseSessionTable(md);
console.log("      ", JSON.stringify(table));
// ★ 2026-10-22 修：原写死 3 个名字。表后来条数变了 ⇒ 改为【按实际表断言】
//   ★ 仍守住本意：解析出 ≥3 个，且【已知的三个 id 都在】
const _names = Object.keys(table);
ok("解出 ≥3 个名字",
   _names.length >= 3, JSON.stringify(table));
ok("三个已知名字都在",
   ["甲", "乙", "丙"].every((n) => _names.includes(n)),
   JSON.stringify(_names));
ok("甲 id 对", table["甲"] === "session-11111111-1111-1111-1111-111111111111", table["甲"]);
ok("乙 id 对", table["乙"] === "session-22222222-2222-2222-2222-222222222222", table["乙"]);
ok("丙 id 对", table["丙"] === "session-33333333-3333-3333-3333-333333333333", table["丙"]);

// ── ② 注册了工具 ───────────────────────────────────────────────────
console.log("\n  [2] 注册 wake 工具");
const A = makeCtx();
// ★ 不传 workspace：让插件自己上溯找（自检就是要验这条）
mod.apply(A.ctx, CFG);
A.run();
// ★ 现在注册【两个】工具（wake + peek）⇒ 按名字取，别按下标
//   （按下标会"加个工具就全崩"，那是脆弱断言）
const byName = (t, n) => t.find((d) => d?.name === n);
// ★ 2026-10-22：v0.3.0 加了 sessions ⇒ 工具从 2 个变 3 个
ok("注册了 3 个工具（sessions + wake + peek）", A.tools.length === 3, String(A.tools.length));
const def = byName(A.tools, "wake");
ok("有 wake 工具", !!def);
ok("有 peek 工具", !!byName(A.tools, "peek"));
ok("有 sessions 工具", !!byName(A.tools, "sessions"));
// ★ 2026-10-22 修：原断言 target 是 3 值 enum。
//   ★ v0.2.0 起 target 支持【任意 session-id】⇒ ⛔ 不能是 enum
//   ★ 改为断言：target 是 string 且【没有 enum 限制】
ok("target 是 string",
   def?.parameters?.properties?.target?.type === "string");
ok("target ⛔ 不是 enum（v0.2.0 支持任意 id）",
   def?.parameters?.properties?.target?.enum === undefined);
ok("required 含 target/content",
  JSON.stringify(def?.parameters?.required) === JSON.stringify(["target", "content"]));
ok("output 有 schema + render",
  !!def?.output?.schema && typeof def?.output?.render === "function");

// ── ③ 正常投递（含回执）────────────────────────────────────────────
console.log("\n  [3] 正常投递 ⇒ 要有回执");
const B = makeCtx({ items: [{ sessionId: table["丙"], agentAvailable: true, running: true }] });
mod.apply(B.ctx, CFG); B.run();
const r = await byName(B.tools, "wake").execute({ target: "丙", content: "读 某份文件.md" }, { agent: { id: "session-self" } });
console.log("      回执 =", JSON.stringify(r));
ok("ok=true", r.ok === true);
ok("target 对", r.target === "丙");
ok("sessionId 对", r.sessionId === table["丙"]);
ok("accepted=true", r.accepted === true);
ok("★ 有 agentAvailable/running（list 复查）", r.agentAvailable === true && r.running === true);
ok("有 at（什么时候）", typeof r.at === "string" && r.at.length > 10, r.at);
ok("有 requestId", typeof r.requestId === "string" && r.requestId.length > 5);
ok("★ 先 resolveAgent（两步之一）", B.calls.resolveAgent.length === 1, String(B.calls.resolveAgent.length));
ok("★ 再 prompt", B.calls.prompt.length === 1);
ok("★ 最后 list 复查", B.calls.list.length === 1, String(B.calls.list.length));

// ── ④ 字段形状（照 schema 原文）───────────────────────────────────
console.log("\n  [4] ★ 请求字段形状");
const req = B.calls.prompt[0];
console.log("      请求 =", JSON.stringify(req));
ok("有 requestId（必需）", typeof req.requestId === "string");
ok("字段名是 sessionId（不是 session）", "sessionId" in req && !("session" in req));
ok("mode 是 queue|steer", req.mode === "queue" || req.mode === "steer", req.mode);
ok("★ content 是【数组】且 type=text",
  Array.isArray(req.content) && req.content[0]?.type === "text", JSON.stringify(req.content));
ok("★ 没有裸 text 字段（旧规格那个错）", !("text" in req));

// ── ⑤ 不许投给自己 ────────────────────────────────────────────────
console.log("\n  [5] ★ 不许投给自己（显式拒绝）");
const C = makeCtx();
mod.apply(C.ctx, CFG); C.run();
const e1 = await threw(() => byName(C.tools, "wake").execute(
  { target: "甲", content: "x" }, { agent: { id: table["甲"] } }));
ok("投给自己 ⇒ 报错", e1 !== null, e1 ? "" : "★ 没报错（不该）");
ok("错误里说清是投给自己", e1 && /不许投给自己/.test(e1.message), e1?.message);
ok("★ 而且【没有】真的投出去", C.calls.prompt.length === 0, String(C.calls.prompt.length));

// ── ⑥ 目标不存在/已归档 ⇒ 报错 ────────────────────────────────────
console.log("\n  [6] 目标不存在 / 已归档 ⇒ 报错不静默");
const D = makeCtx({ resolveResult: { error: { code: "session/not-found" } } });
mod.apply(D.ctx, CFG); D.run();
const e2 = await threw(() => byName(D.tools, "wake").execute(
  { target: "乙", content: "x" }, { agent: { id: "session-self" } }));
ok("resolveAgent 给 error ⇒ 报错", e2 !== null);
ok("错误里带失败码", e2 && /session\/not-found/.test(e2.message), e2?.message);
ok("★ 没有继续 prompt（不静默往下走）", D.calls.prompt.length === 0);

const E = makeCtx({ resolveResult: new Error("boom") });
mod.apply(E.ctx, CFG); E.run();
const e3 = await threw(() => byName(E.tools, "wake").execute(
  { target: "乙", content: "x" }, { agent: { id: "session-self" } }));
ok("resolveAgent 抛异常 ⇒ 也报错", e3 !== null);

// ── ⑦ prompt 没 accepted ⇒ 报错 ───────────────────────────────────
console.log("\n  [7] prompt 没被接受 ⇒ 报错");
const F = makeCtx({ promptResult: { accepted: false } });
mod.apply(F.ctx, CFG); F.run();
const e4 = await threw(() => byName(F.tools, "wake").execute(
  { target: "丙", content: "x" }, { agent: { id: "session-self" } }));
ok("accepted=false ⇒ 报错", e4 !== null, e4 ? "" : "★ 没报错（不该）");

// ── ⑧ 输入自检 ────────────────────────────────────────────────────
console.log("\n  [8] 输入自检");
const G = makeCtx();
mod.apply(G.ctx, CFG); G.run();
ok("target 不认识 ⇒ 报错",
  (await threw(() => byName(G.tools, "wake").execute({ target: "张三", content: "x" }, {}))) !== null);
ok("content 为空 ⇒ 报错",
  (await threw(() => byName(G.tools, "wake").execute({ target: "丙", content: "  " }, {}))) !== null);

// ── ⑨ 拿不到 tools ⇒ ★ 不炸 · 等它就绪再注册 ───────────────────────
//   ★ 2026-10-16 20:45 改契约：
//     旧契约 = "拿不到 tools ⇒ throw"（§④ 的"失败路径不静默"）。
//     ⛔ 而这条契约在【真机上】是错的 —— 冷启动时 `tools` 还没就绪 ⇒ throw
//        ⇒ `plugin_manager list_plugins` 里 `fiberPhase: "failed"` ⇒ 工具【永不注册】。
//     ⇒ 新契约 = 【不 throw，改成轮询等】：★ 还没就绪就等（日志写明），就绪了【自动注册】。
console.log("\n  [9] 拿不到 tools ⇒ 不炸 · 等它就绪再注册");
const H = makeCtx();
let toolsReady = false;
const realGet = H.ctx.get;
H.ctx.get = (n) => (n === "tools" && !toolsReady ? undefined : realGet(n));
const eh = await threw(async () => { mod.apply(H.ctx, CFG); });
ok("apply 时不炸", eh === null);
const eh2 = await threw(async () => { H.run(); });
ok("★ effect 跑时【不炸】（★ 新契约：⛔ 不再 throw ⇒ ⛔ 不许让 fiber failed）",
  eh2 === null, eh2 ? String(eh2.message) : "");
ok("★ 而且【没假装成功】（还没就绪 ⇒ 一个工具都不该注册）",
  H.tools.length === 0, String(H.tools.length));
// ★ 让 tools 就绪 ⇒ 轮询（300ms 一次）应该把它注册上
toolsReady = true;
await new Promise((r) => setTimeout(r, 700));
ok("★ tools 一就绪 ⇒ 【自动注册】sessions + wake + peek（这才是【等到了】）",
  H.tools.length === 3, `实际 ${H.tools.length}`);
ok("★ 且注册的正是 sessions / wake / peek",
  ["sessions", "wake", "peek"].every((n) => H.tools.some((d) => d?.name === n)));

console.log("\n" + "=".repeat(74));
console.log(`  通过 ${pass} · 失败 ${fail}`);
console.log("=".repeat(74));
process.exit(fail ? 1 : 0);
