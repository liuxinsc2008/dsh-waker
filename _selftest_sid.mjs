// 测：填 id => 直接用，不查表
import fsPromises from "node:fs/promises";
// ★ 2026-10-22 公开化：自测自带【真实临时字典】—— ⛔ 不碰使用者的文件
import _os from "node:os";
import _fs from "node:fs";
import _path from "node:path";
const FAKE_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), "waker-sid-"));
const FAKE_TABLE = _path.join(FAKE_DIR, "会话id表.md");
_fs.writeFileSync(FAKE_TABLE, [
  "| 名字 | id |",
  "|---|---|",
  "| 甲 | `session-11111111-1111-1111-1111-111111111111` |",
  "| 乙 | `session-22222222-2222-2222-2222-222222222222` |",
].join("\n"), "utf8");
process.on("exit", () => { try { _fs.rmSync(FAKE_DIR, { recursive: true, force: true }); } catch {} });


const mod = await import(new URL("./lib/index.js", import.meta.url).href);
const apply = mod.apply ?? mod.default?.apply ?? mod.default;

// ── 桩 fs：**表故意不包含**下面要测的那个 id ──
const TABLE = {
  "甲": "session-11111111-1111-1111-1111-111111111111",
  "乙": "session-22222222-2222-2222-2222-222222222222",
};
const md = [
  "| 名字 | id |",
  "|---|---|",
  ...Object.entries(TABLE).map(([n, i]) => `| **${n}** | \`${i}\` |`),
].join("\n");
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
  const services = {
    sessionController: sc,
    tools: { register(def) { tools.push(def); return () => { tools.length = 0; }; } },
  };
  const effects = [];
  const ctx = {
    get: (n) => services[n],
    effect: (fn) => { effects.push(fn); },
    logger: { info: () => {}, error: () => {} },
  };
  return { ctx, calls, tools, run: () => effects.forEach((f) => f()) };
}

const M = makeCtx();
// ★ 2026-10-22：用【桩掉的 fs】+ 显式 sessionTable ⇒ ⛔ 不碰真文件
await apply(M.ctx, { sessionTable: FAKE_TABLE });
M.run();

const wake = M.tools.find((t) => t.name === "wake");
let pass = 0, fail = 0;
const chk = (c, m) => { c ? (console.log("  [+] " + m), pass++) : (console.log("  [X] " + m), fail++); };
const exec = (target) => wake.execute({ target, content: "x" }, { agent: { id: "session-self" } });

console.log("=".repeat(72));
console.log("  填 id => 直接用，不查表");
console.log("=".repeat(72));

// 1 表【外】的 id => 必须能直接唤醒
const OUTSIDE = "session-deadbeef-1234-5678-9abc-def012345678";
try {
  await exec(OUTSIDE);
  const got = M.calls.resolveAgent[M.calls.resolveAgent.length - 1];
  chk(got === OUTSIDE, "表外的 id => 直接唤醒成功（resolveAgent 收到 " + String(got).slice(0, 20) + "…）");
} catch (e) {
  chk(false, "表外的 id 应能直接唤醒，实抛：" + e.message.slice(0, 130));
}

// 2 表【内】的 id => 也行
try {
  await exec(TABLE["乙"]);
  chk(true, "表内的 id => 走通");
} catch (e) { chk(false, "表内的 id 应走通：" + e.message.slice(0, 100)); }

// 3 名字 => 查字典
try {
  await exec("甲");
  const got = M.calls.resolveAgent[M.calls.resolveAgent.length - 1];
  chk(got === TABLE["甲"], "名字【甲】=> 查字典解析到正确 id");
} catch (e) { chk(false, "名字应走通：" + e.message.slice(0, 100)); }

// 4 乱名 => 报错
try {
  await exec("不存在");
  chk(false, "乱名应报错");
} catch (e) {
  chk(/不认识/.test(e.message), "乱名 => 报「不认识」");
}

// 5 整体：填 id 时不读表（★ 把表弄坏也应该能过）
fsPromises.readFile = async () => { throw new Error("表坏掉了"); };
try {
  await exec("session-ffffffff-ffff-ffff-ffff-ffffffffffff");
  chk(true, "【表坏掉时填 id 仍能唤醒】=> 证明填 id 这条路真的不读表");
} catch (e) {
  chk(false, "表坏掉时填 id 应仍可用，实抛：" + e.message.slice(0, 130));
}

console.log("=".repeat(72));
console.log(`  通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
