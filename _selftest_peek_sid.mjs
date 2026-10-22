// 测 peek 填 id => 不查表
import fsPromises from "node:fs/promises";
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


// ★ 2026-10-22 公开化：自测自带【真实临时字典】—— ⛔ 不碰使用者的文件
import _os from "node:os";
import _fs from "node:fs";
import _path from "node:path";
const FAKE_DIR = _ISO_HOME;
const FAKE_TABLE = _path.join(_ISO_HOME, "waker-会话id表.md");
_fs.writeFileSync(FAKE_TABLE, [
  "| 名字 | id |",
  "|---|---|",
  "| 甲 | `session-11111111-1111-1111-1111-111111111111` |",
  "| 乙 | `session-22222222-2222-2222-2222-222222222222` |",
].join("\n"), "utf8");
process.on("exit", () => { try { _fs.rmSync(FAKE_DIR, { recursive: true, force: true }); } catch {} });


const mod = await import(new URL("./lib/index.js", import.meta.url).href);
const apply = mod.apply ?? mod.default?.apply ?? mod.default;

// 表：故意不含要测的 id
const TABLE = { "甲": "session-11111111-1111-1111-1111-111111111111" };
const md = ["| 名字 | id |", "|---|---|",
  ...Object.entries(TABLE).map(([n, i]) => `| **${n}** | \`${i}\` |`)].join("\n");
const M = (() => {
  const calls = { resolveAgent: [], prompt: [], list: [] };
  const tools = [];
  const sc = {
    async resolveAgent(id) { calls.resolveAgent.push(id); return { agent: { id } }; },
    async prompt(req) { calls.prompt.push(req); return { accepted: true }; },
    async list() { calls.list.push(1); return { items: [] }; },
  };
  const sq = {
    async readEvents(req) { calls.readEvents = (calls.readEvents || []); calls.readEvents.push(req); return { events: [] }; },
    async queryEvents(req) { calls.readEvents = (calls.readEvents || []); calls.readEvents.push(req); return { events: [] }; },
    async read(req) { calls.readEvents = (calls.readEvents || []); calls.readEvents.push(req); return { events: [] }; },
  };
  const services = {
    sessionController: sc,
    tools: { register(def) { tools.push(def); return () => { tools.length = 0; }; } },
    sessionQuery: sq,
  };
  const effects = [];
  const ctx = { get: (n) => services[n], effect: (fn) => { effects.push(fn); },
                logger: { info: () => {}, error: () => {} } };
  return { ctx, calls, tools, run: () => effects.forEach((f) => f()) };
})();

// ★ 2026-10-22：用【桩掉的 fs】+ 显式 sessionTable ⇒ ⛔ 不碰真文件
await apply(M.ctx, { sessionTable: FAKE_TABLE });
M.run();

const peek = M.tools.find((t) => t.name === "peek");
let pass = 0, fail = 0;
const chk = (c, m) => { c ? (console.log("  [+] " + m), pass++) : (console.log("  [X] " + m), fail++); };

console.log("=".repeat(72));
console.log("  peek 填 id => 不查表");
console.log("=".repeat(72));

// 1 表外 id => 能读
const OUTSIDE = "session-deadbeef-1234-5678-9abc-def012345678";
try {
  await peek.execute({ target: OUTSIDE, mode: "surface" }, { agent: { id: "session-self" } });
  chk(true, "peek(表外 id) => 走通");
  // 看它把哪个 id 传给了下游
  const hit = JSON.stringify(M.calls).includes(OUTSIDE);
  chk(hit, "下游收到的是该 id（不是查表来的）");
} catch (e) {
  // 可能因 sessionQuery 接口名不对而报别的错 —— 只要不是"不认识"就行
  chk(!/不认识/.test(e.message), "peek(表外 id) 未被表拦（报的是：" + e.message.slice(0, 80) + "）");
}

// 2 名字仍可查
try {
  await peek.execute({ target: "甲", mode: "surface" }, { agent: { id: "session-self" } });
  chk(true, "peek(名字) => 走通");
} catch (e) {
  chk(!/不认识/.test(e.message), "peek(名字) 解析正常（报的是：" + e.message.slice(0, 80) + "）");
}

// 3 乱名 => 报错
try {
  await peek.execute({ target: "不存在", mode: "surface" }, { agent: { id: "session-self" } });
  chk(false, "乱名应报错");
} catch (e) {
  chk(/不认识/.test(e.message), "peek(乱名) => 报「不认识」");
}

console.log("=".repeat(72));
console.log(`  通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
