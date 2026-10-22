// 测 sessions 工具（★ 真读本机 DSH 会话投影 —— 只读，不写）
import _os from "node:os";

const mod = await import(new URL("./lib/index.js", import.meta.url).href);

const regs = [];
const tools = { register(d) { regs.push(d); return () => {}; } };
const sc = {
  async list() { return { items: [] }; },
  async resolveAgent(id) { return { agent: { id } }; },
  async prompt() { return { accepted: true }; },
};
const effects = [];
const ctx = {
  get: (n) => (n === "tools" ? tools : n === "sessionController" ? sc : undefined),
  effect: (fn) => { effects.push(fn); },
  logger: { info: () => {}, error: () => {} },
};

mod.apply(ctx, { sessionTable: "X:/nope.md" });
effects.forEach((f) => f());

console.log("  注册的工具:", regs.map((r) => r.name).join(", "));

const t = regs.find((r) => r.name === "sessions");
if (!t) {
  console.log("  X sessions 没注册");
  process.exit(1);
}

const r = await t.execute({ limit: 10, readOnly: true });
console.log("  DSH_HOME:", r.dshHome);
console.log("  total:", r.total, " returned:", r.returned);
console.log("  ---");
for (const s of r.sessions) {
  console.log("   ", String(s.sessionId).slice(0, 46).padEnd(48), "|", (s.title || "(无标题)").slice(0, 34));
}
console.log("  ---");
console.log("  readOnly 模式下 wrote =", r.wrote);
