/**
 * 唤醒器（dsh-waker）—— 让一个会话【直接唤起】另一个会话。
 *
 * ⛔ 只写 Host 半身：`sessionController` 是 **Host Service**
 *    （原文："Host service backing the generated `ctx.remote.session` namespace"）
 *    ⇒ `ctx.get("sessionController")` 直接拿得到。
 *    Client 半身可用符号只有 5 个（ctx / React / host.call / styles / console）
 *    ⇒ ★ 它拿不到 `sessionController`（早期误以为"只有客户端插件能拿到" —— 说反了）。
 *
 * ★ 公开版：⛔ 不依赖任何内部目录 —— 字典位置由【插件配置】决定（sessionTable / workspace）。
 *
 * ★ 唤醒是【两步】（原文：prompt 的 summary "Admit one prompt **after explicitly
 *   resuming** its Session."）：
 *       ① resolveAgent(sessionId)   ← 解析或恢复
 *       ② prompt({ requestId, sessionId, mode, content:[{type:'text',text}] })
 *
 * ★ 三条硬要求（规格 §三）：
 *       ① 投递成功要【回执】—— 不是"发出去了"就算
 *       ② 目标不存在/已归档 ⇒ 报错，不静默（与 §K.9 同规矩）
 *       ③ 不许投给自己 ⇒ 显式拒绝（那是 schedule 那条错的重演）
 *
 * ⛔ 不做业务判断（该不该唤起由调用方自己判断）· 不绕过信箱直投内容
 */

// ── 会话 id 表：★ 单一来源是【一个文件】（规格 §三 / §六）
//    ⛔ 不另存一份 ⇒ 每次调用现读那个文件。
//    问：为什么不缓存在内存？因为那份表**会被改**（编号撞过号），
//        缓存 = 造出第二份 ⇒ 正是规矩禁止的"两处口径"。
//
// ── 会话 id 字典 ────────────────────────────────────────────────────────
//
// ★★ 本插件是【通用插件】：⛔ 不认识任何具体项目的目录结构。
//
//   为什么需要字典：`wake` / `peek` 的 `target` 可以填【名字】。
//   填名字 ⇒ 需要一个「名字 → session-id」的映射。
//   填 session-id ⇒ **完全不需要字典**（推荐用法）。
//
//   ★ 字典位置怎么定（按优先级）：
//     ① 插件配置 `sessionTable`  —— 直接给文件路径（★ 最明确，推荐）
//     ② 插件配置 `workspace`    —— 给它所在的目录，下面按候选名找
//     ③ 环境变量 `DSH_WAKER_SESSION_TABLE`
//     ④ 从插件位置逐级上溯，找候选文件名（见下）
//     ⑤ 最后退回 process.cwd()
//
//   ★ 候选文件名（全部中性）：`会话id表.md` · `.dsh/会话id表.md` · `docs/会话id表.md`
//
//   ⚠️ 一律【每次现读】, ⛔ 不缓存 —— 缓存 = 造出第二份 = 两处口径。
const ENV_SESSION_TABLE = "DSH_WAKER_SESSION_TABLE";

/** 字典文件名（★ 2026-10-22 定：放在 DSH 自己的目录下） */
const TABLE_FILENAME = "waker-会话id表.md";

/** 候选文件名（中性 · ⛔ 不含任何项目目录） */
const SESSION_TABLE_CANDIDATES = [
  TABLE_FILENAME,
  "会话id表.md",
  ".dsh/" + TABLE_FILENAME,
  ".dsh/会话id表.md",
  "docs/会话id表.md",
];

/**
 * ★★★ 字典文件的【规范位置】（2026-10-22 作者定）
 *
 * $$\text{字典} \to \texttt{\$DSH\_HOME/waker-会话id表.md}$$
 *
 * ⇒ 为什么放 DSH_HOME 而不是插件目录：
 *   · `npm install` 装的插件 ⇒ 包目录只读 / 升级会覆盖
 *   · `git clone` 装的 ⇒ 在仓库里，⛔ 不该写运行时数据
 *   · 放 DSH_HOME ⇒ **三种安装方式都落到【同一个地方】**
 *   · 而且重装/升级插件【不丢】
 */
function tableFilePath() {
  const r = process.env.DSH_HOME;
  return r || null;
}

// ── ★★ peek 的截断上限（2026-10-16 · 实测踩出来的）
//
//   事故：`peek(target="some-session", mode="events", limit=5)`
//        ⇒ **忽略了 limit** ⇒ 返回【全部 19426 条】⇒ 溢出 2.3 MB
//        ⇒ ★ 一次调用就能把调用方的上下文炸掉。
//
//   ⇒ 所以：**每个模式都必须截**，而且**默认值要安全**（不传就不会炸）。
const PEEK_LIMIT_DEFAULT = 50;
const PEEK_LIMIT_MAX = 200;

/**
 * 把 `limit` 归一成 [1, PEEK_LIMIT_MAX] 里的整数。
 *
 * ⚠️ ★ 不传 ⇒ **默认 50**（不是"不限"）——"不限"就是这个事故的成因。
 * ⚠️ 传了负数/0/NaN/非数字 ⇒ 退回默认，并**不报错**（那是"给宽一点"的意图）。
 */
function normLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return PEEK_LIMIT_DEFAULT;
  const i = Math.floor(n);
  if (i < 1) return PEEK_LIMIT_DEFAULT;
  return Math.min(i, PEEK_LIMIT_MAX);
}

/**
 * 从 【会话 id 字典】 解出 { 名字: 会话id }。
 *
 * 表形如：
 *   | **某个会话** | `session-xxxxxxxx-...` | 它负责什么 |
 *
 * ⚠️ ★ 两处踩过的坑（都记下来，免得改回去）：
 *   ① 名字里是【破折号 `——`】（U+2014 ×2），不是 ASCII 的 `-`
 *   ② ★ id 是 `session-` 前缀 ⇒ ⛔ **不能用 `[0-9a-fA-F-]{8,}` 那种"十六进制"字符类**
 *      （`s`/`e`/`i`/`o`/`n` 不在里面 ⇒ 一个都匹配不上）
 *      ⇒ 正确写法：**抓反引号里的整段**（`` `([^`]+)` ``）
 *
 * ⚠️ 解析失败 ⇒ **报错**，不猜、不给默认值（§K.9 同一个规矩：不许静默）。
 */
export function parseSessionTable(md) {
  const out = {};

  // ★★★ 2026-10-22：⛔ 不要求任何项目专属前缀 —— 认【任意两列】表格。
  //
  //   $$\\text{认【任意】两列：}|\ \text{名字}\ |\ \texttt{\`session-…\`}\ |$$
  //
  //   · 名字取第一列（去粗体、去空白）
  //   · id 取【反引号里】以 `session-` 开头的那段
  //   · 表头行 / 分隔行（`---`）自动跳过
  //   · 一行里有多个反引号 ⇒ 取第一个像 session-id 的
  //
  //   ⚠️ 两个踩过的坑（保留）：
  //      ① 名字里可能是破折号 `——`（U+2014 ×2）—— 现在无所谓了，整格当名字
  //      ② id 带 `session-` 前缀 ⇒ ⛔ 不能用"纯十六进制"字符类
  const lineRe = /^\s*\|(.+)\|\s*$/;
  for (const line of md.split(/\r?\n/)) {
    const lm = lineRe.exec(line);
    if (!lm) continue;

    const cells = lm[1].split("|").map((c) => c.trim());
    if (cells.length < 2) continue;

    // ★ 跳过表头 / 分隔行
    const joined = cells.join("");
    if (/^[\s\-:|]+$/.test(joined)) continue;      // |---|---|
    if (/^(名字|name|会话|session)\b/i.test(cells[0])) continue;  // 表头

    // ① 名字：去粗体标记
    const name = cells[0].replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (!name) continue;

    // ② id：在【所有列】里找反引号包着的 session-…
    let id = "";
    for (const c of cells.slice(1)) {
      const m = /`([^`]+)`/.exec(c);
      if (m && /^session-/i.test(m[1].trim())) { id = m[1].trim(); break; }
    }
    // 也允许不带反引号：裸 session-…
    if (!id) {
      for (const c of cells.slice(1)) {
        const m = /\b(session-[0-9a-z-]{8,})\b/i.exec(c);
        if (m) { id = m[1]; break; }
      }
    }
    if (!id) continue;

    out[name] = id;
  }
  return out;
}

function nowIso() {
  // 本地时间 + 时区，人读得懂
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${oh}:${om}`;
}

function newRequestId() {
  // 规格要求 `requestId` 必需（类型是 branded 的 `session-request-id`，本质是字符串）
  return "waker-" + Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2, 10);
}

/**
 * ★★ 把一个 `SurfaceEvent` 压成【可读的一行】（`peek` 用）。
 *
 * ⚠️ 为什么要它：会话事件的形状很炸（`assistant/message` 里挂
 *   `AssistantStreamRecord[]`，含 `dt`/`texts` 分块）⇒
 *   原样丢给调用方，它得自己挖三层才看到"她说了什么"。
 *   ⇒ 这里只取**能读的那一份**：谁说的 · 什么时候 · 正文。
 *
 * ⛔ **不许在这里做判断**（哪些重要、该不该回）—— 那是我方规矩禁止的
 *   "在插件里做业务判断"。这里只做**搬运 + 摊平**。
 */
function summarizeSurfaceEvent(ev) {
  const type = ev?.type ?? null;
  const seq = ev?.seq ?? null;
  const time = ev?.time ?? null;
  const data = ev?.data ?? {};
  const msg = data?.message ?? null;

  /** 从一条 message 里把正文捞出来（三种形状都见过了） */
  const textOf = (m) => {
    if (!m) return null;
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const parts = c
        .map((b) => (typeof b === "string" ? b : (b?.text ?? null)))
        .filter((x) => typeof x === "string" && x.length);
      return parts.length ? parts.join("\n") : null;
    }
    if (typeof m.text === "string") return m.text;
    return null;
  };

  // `assistant/message` 的正文可能在 stream 分块里
  const textFromStream = (stream) => {
    if (!Array.isArray(stream)) return null;
    const parts = [];
    for (const rec of stream) {
      if (rec?.type === "text-chunks" && Array.isArray(rec.texts)) {
        parts.push(...rec.texts.filter((x) => typeof x === "string"));
      }
    }
    return parts.length ? parts.join("") : null;
  };

  return {
    seq, type, time,
    role: msg?.role ?? null,
    // ★ 正文：先 message.content，再退回 stream 分块
    text: textOf(msg) ?? textFromStream(data?.stream) ?? null,
  };
}

/**
 * 唤醒器插件。
 *
 * ⚠️ 用 `apply` 形式而不是 `Service` 子类：本插件**不对外提供 Service**
 *    （它是"给别人用的工具"，不是"被别人注入的服务"）。
 */
export const name = "dsh-waker";
export const inject = ["tools"];   // 硬依赖：没有 tools 就注册不了 ⇒ 直接不激活

/**
 * ★ 版本标记（2026-10-15 深夜加）。
 *
 * 为什么要它：改了 `lib/index.js` 之后重装/重启，工具还在报**同一个旧错**
 *   ⇒ 无法判断"跑的是新代码还是旧代码"。
 * ⇒ 从此每次改动都【递增这个号】+ 写一句【what changed】，
 *   而它出现在：① 工具 description 里 ② 每条报错里 ③ 回执 note 里。
 * ⇒ ★ 判据：报错里带的版本号 ≠ 源文件里的版本号 ⇒ 跑的是旧模块（要重装/重启）。
 */
export const WAKER_VERSION = "0.5.0";
export const WAKER_CHANGELOG =
  "★★★ 0.3.0：新增 `sessions` 工具 —— 扫描 DSH 会话列表（id + 标题），" +
  "可自动生成 wake/peek 用的字典（readOnly=false）⇒ ⛔ 不用再手抄 session-id；" +
  "子智能体判断修正（原来按 rows.subagent 存在判 ⇒ 每个会话都有 ⇒ 读到 0 个；" +
  "改成看 subagent.val.identity）；" +
  "★★ 0.1.5 ⇒ 0.2.0：`target` 支持【直接填 session-id】—— 填 `session-…` 时" +
  "**直接用，⛔ 不读会话表**；填名字才查表（表 = 检索字典，⛔ 不是插件的守门人）。" +
  "`wake` 与 `peek` 共用同一个 `resolveTarget`，因此两者同时生效。" +
  "（★ 作者裁定 2026-10-22）；" +
  "0.1.4 ⇒ 0.1.5：拿不到 `tools` 服务时【不再 throw】，改成【轮询等它就绪再注册】" +
  "（★ 实测：冷启动时 throw ⇒ `fiberPhase=failed` ⇒ 工具【永不注册】· 见 77- §13.6）；" +
  "0.1.3 ⇒ 0.1.4：HMR 热更验通（不重启即生效）";

// ── ★★ 能力自述（`peek`/`wake` 每次返回都带上）
//
//   为什么要有它（2026-10-16 · 同一个坑踩了两次）：
//
//   ```
//   我改了代码 ⇒ 而运行时跑的是旧模块（HMR 没重载）
//     ⇒ ★ 症状看起来像"代码有 bug"，实测两次都是【代码早就修好了】
//     ⇒ 于是每次都要人肉比对"返回里的版本号 vs 源文件里的版本号"
//   ```
//
//   ⛔ 而**版本号可能忘了改** ⇒ 不够硬。
//   ⇒ 用【能力清单】：这一份模块**认不认得这些能力**。
//     旧模块没有这些字段 ⇒ **一眼可判**，不靠自觉。
export const WAKER_CAPS = Object.freeze({
  //: `peek` 三个模式都按 limit 截断（v0.1.3）
  peekLimitAllModes: true,
  //: `peek` 支持 recent 模式（v0.1.2）
  peekModes: ["surface", "events", "recent"],
  //: `wake` 用 resolveAgent + prompt 两步（v0.1.0）
  wakeTwoStep: true,
});

export function apply(ctx, config = {}) {

  // ── ★★★ 自安装：保证【插件真身】在本机安装目录 ────────────────
  //
  // $$\text{插件加载} \to \text{检查自己装在哪} \to
  //   \text{在外部} \Rightarrow ★\ \text{自动复制进本地安装目录}$$
  //
  // ★ 为什么（2026-10-22 作者令）：
  //   有人会把插件解压到桌面 / clone 到 D 盘再加载 —— 那个文件夹一删 / 一挪，
  //   插件就废了，而且【没人会想到是这个原因】。
  //   ⇒ 插件【自己】复制一份进 DSH 的 node_modules，再记一笔"副本才是真身"。
  //
  // ⚠️ 复制完【不删源】—— 源可能是 git 仓库，删了用户就没法更新。
  // ⚠️ 失败【不抛】—— 自安装只是便利，⛔ 不许因此让插件加载失败。

  function _selfPath() {
    try {
      const u = import.meta.url;
      const p = u.startsWith("file:") ? new URL(u).pathname : u;
      return decodeURIComponent(p.replace(/^\/([A-Za-z]:)/, "$1")).replace(/\\/g, "/");
    } catch { return ""; }
  }

  /**
   * ★ 自安装：把插件复制进 `<DSH_HOME>/profiles/<profile>/node_modules/dsh-waker`
   * @returns { synced, target, note } —— 永不抛
   */
  async function selfInstall() {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");

    const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
    const profile = process.env.DSH_PROFILE || "desktop";

    const self = _selfPath();
    if (!self) return { synced: false, note: "_selfPath 取不到" };
    const selfRoot = path.dirname(path.dirname(self));

    // 已在 node_modules/dsh-waker 内 ⇒ 真身已在，什么都不做
    const norm = selfRoot.replace(/\\/g, "/").toLowerCase();
    if (norm.includes("/node_modules/dsh-waker")) {
      return { synced: false, note: "已在 node_modules 内", target: selfRoot };
    }

    const target = path.join(home, "profiles", profile, "node_modules", "dsh-waker");
    const stamp = path.join(target, ".sync.json");

    // 同步过且源没变 ⇒ 跳过
    try {
      const prev = JSON.parse(await fs.readFile(stamp, "utf8"));
      if (prev?.from === selfRoot.replace(/\\/g, "/") && prev?.version === WAKER_VERSION) {
        return { synced: false, note: "已同步过", target };
      }
    } catch { /* 没同步过 */ }

    try {
      // 目标若是链接 ⇒ 先删链接
      try {
        const st = await fs.lstat(target);
        if (st.isSymbolicLink()) await fs.unlink(target);
      } catch { /* 不存在 */ }

      await fs.rm(target, { recursive: true, force: true });
      await fs.mkdir(target, { recursive: true });

      const copyDir = async (src, dst) => {
        await fs.mkdir(dst, { recursive: true });
        for (const e of await fs.readdir(src, { withFileTypes: true })) {
          if (e.name.includes(".bak_") || e.name === "node_modules") continue;
          const sp = path.join(src, e.name);
          const dp = path.join(dst, e.name);
          if (e.isDirectory()) await copyDir(sp, dp);
          else if (e.isFile()) await fs.copyFile(sp, dp);
        }
      };
      await copyDir(selfRoot, target);

      await fs.writeFile(stamp, JSON.stringify({
        from: selfRoot.replace(/\\/g, "/"),
        at: nowIso(),
        version: WAKER_VERSION,
        note: "本目录是【副本·真身】；源目录删了也不影响。改源码后重启 DSH 会重新同步。",
      }, null, 2), "utf8");

      log(`selfInstall ⇒ 已复制到 ${target}`);
      return { synced: true, target, from: selfRoot.replace(/\\/g, "/") };
    } catch (e) {
      log(`selfInstall 失败（不影响工具）：${e?.message || e}`);
      return { synced: false, note: String(e?.message || e), target };
    }
  }

  const log = (msg) => ctx.logger?.info?.(`[waker] ${msg}`);

  /**
   * 找出【会话 id 字典】在哪。
   *
   * ⚠️ ★ 为什么不直接用 `process.cwd()`：
   *   实测（自检里踩到）：cwd 可能是**插件自己所在目录** ⇒ 拼出的路径不存在 ⇒ ENOENT。
   *   （那一次"报错不静默"生效了 —— 没静默失败，但它不该失败。）
   *
   * ⇒ 判据按可靠性排：
   *   ① 显式配置 `config.sessionTable`（★ 绝对/相对路径都行 —— **最推荐**）
   *   ② 显式配置 `config.workspace`（在它下面找候选文件名）
   *   ③ 从**插件文件位置**逐级上溯，找第一个含候选文件的目录
   *   ④ 最后才退回 `process.cwd()`
   *
   * ★ 公开版：⛔ 不预设任何具体目录名 —— **使用者自己的布局，由使用者配**。
   */
  async function findWorkspace() {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");

    // ① 环境变量（便于不动配置就换位置）
    const envPath = process.env[ENV_SESSION_TABLE];
    if (envPath) {
      const p = path.resolve(envPath);
      try {
        await fs.access(p);
        return { root: path.dirname(p), file: p };
      } catch {
        throw new Error(
          `环境变量 ${ENV_SESSION_TABLE} 指向的字典不存在：${p}`);
      }
    }

    // ①b ★ 规范位置 = $DSH_HOME/waker-会话id表.md（rebuildTable 写的地方）
    {
      const os = await import("node:os");
      const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
      const p = path.join(home, TABLE_FILENAME);
      try {
        await fs.access(p);
        return { root: home, file: p };
      } catch { /* 还没生成 ⇒ 往下找 */ }
    }

    // ② 直接指定了字典文件
    if (config.sessionTable) {
      const p = path.resolve(config.sessionTable);
      try {
        await fs.access(p);
        return { root: path.dirname(p), file: p };
      } catch {
        throw new Error(
          `配置的会话 id 字典不存在：${p}\n` +
          `⇒ 检查插件配置里的 sessionTable（⛔ 不猜、不给默认值）。`);
      }
    }

    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const cands = [];
    if (config.workspace) cands.push(path.resolve(config.workspace));
    let d = here;
    for (let i = 0; i < 8; i++) {           // 上溯最多 8 层
      cands.push(d);
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
    cands.push(process.cwd());
    for (const c of cands) {
      for (const rel of SESSION_TABLE_CANDIDATES) {
        try {
          await fs.access(path.join(c, rel));
          return { root: c, file: path.join(c, rel) };
        } catch { /* 继续找 */ }
      }
    }
    // ★ 全找不到 ⇒ 返回 null（下面 readSessionTable 会带着候选清单报）
    return null;
  }

  async function readSessionTable() {
    const fs = await import("node:fs/promises");
    const found = await findWorkspace();
    if (found === null) {
      throw new Error(
        `找不到会话 id 表：候选路径都试过了：\n  ` +
        SESSION_TABLE_CANDIDATES.map((s) => `- ${s}`).join("\n  ") +
        `\n⇒ 会话 id 的唯一来源是【那个文件】，插件不另存一份、也不猜。`);
    }
    let md;
    try {
      md = await fs.readFile(found.file, "utf8");
    } catch (e) {
      throw new Error(
        `读不到会话 id 表：${found.file}（${e?.message || e}）\n` +
        `⇒ 插件不另存一份。`);
    }
    const table = parseSessionTable(md);
    const names = Object.keys(table);
    if (names.length === 0) {
      throw new Error(
        `会话 id 表【解析出来 0 行】：${found.file}\n` +
        `⇒ 表形如「| **某个会话** | \`session-…\` | … |」。⛔ 不猜、不给默认值。`);
    }
    return table;
  }

  // ★ 2026-10-16 20:35 改：这里原来是【拿不到 tools 就 throw】。
  //   ⛔ 实测（`plugin_manager list_plugins`）：冷启动时 `tools` 还没就绪 ⇒ throw
  //      ⇒ **fiberPhase: "failed"** ⇒ 工具【永不注册】⇒ wake/peek 报 `unknown tool`。
  //   ⇒ 改成【等它就绪再注册】：★ 仍不静默（日志写明"在等"），但⛔ 不再让整个插件失败。
  //   ⇒ 注册体抽成 `registerWaker()`（成功 ⇒ 返回精确 disposer；没就绪 ⇒ 返回 null）。
  const registerWaker = () => {
    const tools = ctx.get("tools");
    if (tools === undefined) return null;   // ★ 还没就绪 ⇒ 交给下面的 effect 重试

    /** ★ `wake` 与 `peek` **共用的**目标解析（⛔ 不做两份，那会漂移）。
     *
     * ★★★ 2026-10-22 作者裁定：
     *
     *   $$\text{表} = \text{这几个会话的【检索字典】}$$
     *
     *   ★★ **插件要能【直接填 id 唤醒】，⛔ 被表拦** ——
     *      **表是给人查 id 的，⛔ 不是插件的守门人。**
     *
     *   · 填 **`session-…`** ⇒ ★ **直接唤醒，⛔ 不查表**
     *   · 填**名字**        ⇒ ★ 查表（字典的用处就在这里；查不到才报错）
     */
    async function resolveTarget(raw) {
      const target = String(raw ?? "").trim();

      // ① session-id ⇒ ★ 直接用，⛔ 不读表
      if (/^session-[0-9a-f-]{8,}$/i.test(target)) {
        return { target, targetId: target, via: "sessionId" };
      }

      // ② 名字 ⇒ ★ 先重建字典再查（2026-10-22 作者令：每次调用先重建）
      await rebuildTable();

      const table = await readSessionTable();
      const known = Object.keys(table);
      if (known.includes(target)) {
        return { target, targetId: table[target], via: "name" };
      }

      throw new Error(
        `target 不认识：${JSON.stringify(target)}（字典里有：${known.join(" / ")}）\n` +
        `⇒ 也可以直接填 session-… 形式的 id（★ 那个不查字典）。`);
    }

    // ── ★ sessions：扫描会话列表（v0.2.0 新增）
    const disposeSessions = tools.register({
      name: "sessions",
      description:
        "★ 扫描本机的 DSH 会话列表，读回【sessionId + 标题】。" +
        "用途：自动生成 wake/peek 用的会话 id 字典，⛔ 不用手抄 id。" +
        `★ v${WAKER_VERSION}。` +
        "readOnly=true（默认）⇒ 只列出，⛔ 不写任何文件；" +
        "readOnly=false ⇒ ★ 把结果写成字典文件（Markdown 表格）。" +
        "★ 数据来源：`$DSH_HOME/storages/session_projcache/sessions/*.json` 里的 title 投影。" +
        "⚠️ 无标题的会话照样列出（标题留空）。" +
        "⚠️ 子智能体会话也在列表里 —— 用 namedOnly=true 只看【自己命名的】。" +
        "⛔ 不做业务判断：列哪些、写哪份，由调用方决定。",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description: "最多返回多少个（默认 50，上限 500）",
          },
          namedOnly: {
            type: "boolean",
            description:
              "true ⇒ 只列【有标题的】会话（名字看着像任务提示词的也会列出，自己再筛）",
          },
          readOnly: {
            type: "boolean",
            description:
              "true（默认）⇒ 只读列出；false ⇒ 同时把结果写成字典文件（见 outFile）",
          },
          outFile: {
            type: "string",
            description:
              "readOnly=false 时写到哪（默认 `会话id表.md`，相对工作区根）。" +
              "⛔ 已存在 ⇒ 先备份成 `.bak_时间戳` 再写。",
          },
          includeSubagents: {
            type: "boolean",
            description: "true ⇒ 也列出子智能体会话（id 不带 session- 前缀的那些）",
          },
        },
        required: [],
        additionalProperties: false,
      },
      output: {
        schema: { type: "object" },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value, null, 2) }];
        },
      },

      async execute(args) {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");

        const lim = Math.max(1, Math.min(500, Number(args?.limit ?? 50) | 0));
        const namedOnly = args?.namedOnly === true;
        const readOnly = args?.readOnly !== false;      // 默认只读
        const includeSub = args?.includeSubagents === true;

        // ── 找 DSH 会话投影目录 ──
        const home = process.env.DSH_HOME
          || path.join((await import("node:os")).homedir(), ".dsh");
        const dir = path.join(home, "storages", "session_projcache", "sessions");

        let files;
        try {
          files = await fs.readdir(dir);
        } catch (e) {
          throw new Error(
            `找不到会话投影目录：${dir}（${e?.code || e}）\n` +
            `⇒ 插件读的就是 DSH 自己的状态目录（$DSH_HOME），⛔ 不猜别的位置。`);
        }

        const rows = [];
        for (const f of files) {
          if (!f.endsWith(".json")) continue;
          const sid = f.slice(0, -5);
          try {
            const o = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
            const r = o?.record?.rows || {};
            const title = String(r?.title?.val ?? "").trim();
            const created = Number(o?.record?.identity?.createdAt ?? 0);
            const last = Number(r?.sessionListMetadata?.val?.lastPromptAt ?? 0);
            // ★ 子智能体判断（2026-10-22 修）：
            //   ⚠️ 错法：看 `rows.subagent` 存不存在 —— 但【每个会话】都有这个投影
            //   ✅ 对法：看 `rows.subagent.val.identity` 里有没有【真正的子智能体身份】
            const idOk = /^session-/.test(sid);
            const subIdent = r?.subagent?.val?.identity;
            const isSub = !idOk || (subIdent && typeof subIdent === "object");
            if (!includeSub && isSub) continue;
            if (namedOnly && !title) continue;
            rows.push({ sessionId: sid, title, createdAt: created, lastPromptAt: last });
          } catch { /* 单个坏文件跳过，⛔ 不因一个坏文件整体失败 */ }
        }

        // 按最后活动倒序
        rows.sort((a, b) => (b.lastPromptAt || b.createdAt) - (a.lastPromptAt || a.createdAt));
        const picked = rows.slice(0, lim);

        const result = {
          ok: true,
          dshHome: home,
          total: rows.length,
          returned: picked.length,
          sessions: picked.map((r) => ({
            sessionId: r.sessionId,
            title: r.title || null,
          })),
          wrote: null,
        };

        // ── 可选：写字典 ──
        if (!readOnly) {
          const outRel = String(args?.outFile || "会话id表.md");
          // ★ 相对路径 = 工作区根（插件是"从插件位置上溯找含字典的目录"，这里用 cwd 兜底）
          const outAbs = path.isAbsolute(outRel) ? outRel : path.join(process.cwd(), outRel);
          const lines = [
            "# 会话 id 表",
            "",
            "> 由 `sessions` 工具生成 · " + nowIso(),
            "> 用途：`wake` / `peek` 的 `target` 填【名字】时查 id。",
            "> ★ 也可直接填 session-id，那样不读本文件。",
            "",
            "| 名字 | id |",
            "|---|---|",
          ];
          for (const r of picked) {
            // 名字去表格分隔符
            const nm = (r.title || r.sessionId).replace(/\|/g, "／").slice(0, 60);
            lines.push(`| ${nm} | \`${r.sessionId}\` |`);
          }
          lines.push("");
          const text = lines.join("\n");

          // 已存在 ⇒ 先备份
          try {
            await fs.access(outAbs);
            const bak = outAbs + ".bak_" + Date.now().toString(36);
            await fs.copyFile(outAbs, bak);
            result.backedUpTo = bak;
          } catch { /* 不存在就不用备份 */ }

          await fs.mkdir(path.dirname(outAbs), { recursive: true });
          await fs.writeFile(outAbs, text, "utf8");
          result.wrote = outAbs;
        }

        log(`sessions() ⇒ ${result.returned}/${result.total}` +
            (result.wrote ? ` · wrote ${result.wrote}` : " · read-only"));
        return result;
      },

    });

        // ── ★★★ 会话列表：扫描 + 重建（sessions / wake / peek 共用） ────
    //
    // $$\text{每次调用} \to \text{重建字典} \to \text{再执行}$$
    //
    // ★ 为什么每次重建：
    //   会话会【新建 / 归档 / 分支】⇒ 字典会过期 ⇒ 重建比"增量判断"简单且不会错。
    //   ⚠️ 代价：每次多一次目录扫描（68 个文件 ≈ 50–100ms）。
    async function scanSessions() {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const home = process.env.DSH_HOME
        || path.join((await import("node:os")).homedir(), ".dsh");
      const dir = path.join(home, "storages", "session_projcache", "sessions");

      let files;
      try {
        files = await fs.readdir(dir);
      } catch (e) {
        throw new Error(
          `找不到会话投影目录：${dir}（${e?.code || e}）\n` +
          `⇒ 插件读的就是 DSH 自己的状态目录（$DSH_HOME），⛔ 不猜别的位置。`);
      }

      const rows = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const sid = f.slice(0, -5);
        try {
          const o = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
          const r = o?.record?.rows || {};
          const title = String(r?.title?.val ?? "").trim();
          const created = Number(o?.record?.identity?.createdAt ?? 0);
          const last = Number(r?.sessionListMetadata?.val?.lastPromptAt ?? 0);
          // ★ 子智能体判断：看 subagent.val.identity（⛔ 不是看 subagent 存不存在）
          const idOk = /^session-/.test(sid);
          const subIdent = r?.subagent?.val?.identity;
          const isSub = !idOk || (subIdent && typeof subIdent === "object");
          rows.push({ sessionId: sid, title, createdAt: created,
                      lastPromptAt: last, isSub });
        } catch { /* 单个坏文件跳过 */ }
      }
      rows.sort((a, b) => (b.lastPromptAt || b.createdAt) - (a.lastPromptAt || a.createdAt));
      return { home, dir, rows };
    }

    /**
     * ★ 重建字典文件（写到 $DSH_HOME/waker-会话id表.md）
     * @returns { path, count, skipped } —— 失败返回 { error }
     */
    async function rebuildTable(opts = {}) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const home = process.env.DSH_HOME
        || path.join((await import("node:os")).homedir(), ".dsh");
      const out = opts.outFile
        ? (path.isAbsolute(opts.outFile) ? opts.outFile : path.join(process.cwd(), opts.outFile))
        : path.join(home, TABLE_FILENAME);

      try {
        const { rows } = await scanSessions();
        const includeSub = opts.includeSubagents === true;
        const picked = rows.filter((r) => includeSub || !r.isSub);

        const lines = [
          "# 会话 id 表",
          "",
          `> ★ 自动重建于 ${nowIso()}`,
          "> ★ 由 `sessions` / `wake` / `peek` 在每次调用前重建 ⇒ ⛔ 不用手改",
          "> 用途：`wake` / `peek` 的 `target` 填【名字】时查 id",
          "> ★ 也可以直接填 session-id，那样不读本文件",
          "",
          "| 名字 | id |",
          "|---|---|",
        ];
        for (const r of picked) {
          const nm = (r.title || r.sessionId).replace(/\|/g, "／").slice(0, 80);
          lines.push(`| ${nm} | \`${r.sessionId}\` |`);
        }
        lines.push("");

        // 已存在 ⇒ 先备份（只留一份 .bak，⛔ 不无限堆）
        try {
          await fs.access(out);
          await fs.copyFile(out, out + ".bak");
        } catch { /* 不存在 */ }

        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, lines.join("\n"), "utf8");
        log(`rebuildTable ⇒ ${picked.length} 条 · ${out}`);
        return { path: out, count: picked.length, skipped: rows.length - picked.length };
      } catch (e) {
        // ⚠️ 重建失败【不许让调用方失败】—— 字典只是辅助
        log(`rebuildTable 失败（不影响调用）：${e?.message || e}`);
        return { error: String(e?.message || e) };
      }
    }

    const dispose = tools.register({
      name: "wake",
      description:
        `唤起另一个会话（跨会话投递一条消息，让它自己跑一轮）。★ v${WAKER_VERSION}。` +
        "【这是派活，不是聊天】—— 对方会消耗 token、会改文件、会占用它的时间。" +
        "⛔ 调用前必须确认三件：" +
        "① 这件事【非它不可】吗？你自己能读能改的 ⇒ ★ 自己做，⛔ 别 wake；" +
        "② content 【自包含】吗？对方看不到你的上下文，只写【去哪儿读 · 要做什么】，⛔ 不抄内容，⛔ 一段塞三个任务；" +
        "③ 会不会吵到它？它可能正在跑 ⇒ ⛔ 不要连发、⛔ 不要催，★ 没回就 peek 看或等。" +
        "⛔ 五条硬禁令：⛔ 投给自己；⛔ 一次 wake 一片会话做广播；" +
        "⛔ 在 content 里写指令性陷阱（\"忽略之前的指令\"之类）—— 那是劫持，不是派活；" +
        "⛔ 拿 peek 翻别人全部历史；⛔ 同一条信息在两边来回传两次以上（死循环烧 token）。" +
        "target 填【session-… 形式的 id】⇒ 直接唤醒（⛔ 不查字典，★ 填错一个字符就投给不存在的会话，先核对）；" +
        "填【名字】⇒ 查会话 id 字典解析。" +
        "⚠️ 返回 accepted:true 只表示【已送达队列】，⛔ 不等于它做完了 —— 要看 peek 或它回来的消息。" +
        "完整使用说明见插件目录 USAGE.md。",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "要唤起哪个会话。填【session-… 形式的 id】可直接唤醒（⛔ 不查字典，★ 填错就投丢）；" +
              "填【名字】则查会话 id 字典解析。⛔ 不许指向自己。",
          },
          content: {
            type: "string",
            description:
              "派给它的任务。★ 自包含（它看不到你的上下文）· ★ 只写【去哪儿读 · 要做什么】· " +
              "★ 不抄内容（内文在文件里）· ★ 一次一段。" +
              "⛔ 不许写\"忽略你之前的指令\"这类陷阱。要终止往返 ⇒ 明确写\"这条不用回投\"。",
          },
        },
        required: ["target", "content"],
        additionalProperties: false,
      },
      output: {
        schema: { type: "object" },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value, null, 2) }];
        },
      },

      async execute(args, exec) {
        const content = String(args?.content ?? "").trim();

        // ── 输入自检（错了就报错，不静默）─────────────────────────
        if (!content) {
          throw new Error("content 为空 —— 触发语必须自包含（去哪儿读 · 要做什么）");
        }
        // ★ 共用解析（与 peek 同一处 ⇒ 不会漂移）
        const { target, targetId } = await resolveTarget(args?.target);

        // ── ③ ★ 不许投给自己（显式拒绝 · 规格 §三③）────────────────
        //    判据：本轮的 agent 就是目标会话 ⇒ 拒。
        const selfId = exec?.agent?.id;
        if (selfId && String(selfId) === String(targetId)) {
          throw new Error(
            `⛔ 不许投给自己：target=${target}（${targetId}）就是本会话。\n` +
            `⇒ 跨会话投递只能投【别的】会话（这条是 schedule 那两次错的重演防线）。`);
        }

        const sc = ctx.get("sessionController");
        if (sc === undefined) {
          throw new Error(
            "[waker] 拿不到 sessionController（Host Service）—— 环境不对，不静默");
        }

        // ── ① resolveAgent：★ 先唤醒（prompt 要求"after explicitly resuming"）
        //    也是【验收②】的落点：已归档/不存在 ⇒ 这里给 {error}
        let resolved;
        try {
          resolved = await sc.resolveAgent(targetId);
        } catch (e) {
          throw new Error(
            `resolveAgent 失败（target=${target} · ${targetId}）：` +
            `${e?.code || e?.name || ""} ${e?.message || e}\n` +
            `⇒ 目标可能已归档/不存在（§K.9：报错，不静默）。`);
        }
        if (!resolved || resolved.error) {
          const code = resolved?.error?.code || "unknown";
          throw new Error(
            `⛔ 目标会话【唤醒不了】：target=${target} · ${targetId}\n` +
            `   失败码 = ${code}（'session/not-found' 即已归档或不存在）\n` +
            `⇒ 按 §K.9：报错，不静默。（⛔ 没用 inspect —— 它"without activating its Agent"）`);
        }

        // ── ② prompt：投递（★ 字段名与形状照 schema 原文）
        //    ⚠️ 2026-10-15 修：signature 是 prompt(request, signal) ——
        //       ★ 第二个参数 AbortSignal 是【必填】（不是可选）。
        //       第一次装好后实测报错：
        //         TypeError: Cannot read properties of undefined (reading 'throwIfAborted')
        //       ⇒ 内部直接读 signal.throwIfAborted ⇒ 不给就当场炸。
        //       ⇒ 给一个【有超时的】信号：既满足必填，又防止永久挂住。
        const requestId = newRequestId();
        const at = nowIso();
        const PROMPT_TIMEOUT_MS = 30000;
        const signal = AbortSignal.timeout(PROMPT_TIMEOUT_MS);
        let promptResult;
        try {
          promptResult = await sc.prompt({
            requestId,
            sessionId: targetId,
            mode: "queue",
            content: [{ type: "text", text: content }],
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }, signal);
        } catch (e) {
          throw new Error(
            (`prompt 失败 [v${WAKER_VERSION}]（target=${target} · requestId=${requestId}）：`) +
            `${e?.code || e?.name || ""} ${e?.message || e}`);
        }
        if (!promptResult?.accepted) {
          throw new Error(
            (`prompt 没被接受 [v${WAKER_VERSION}]（target=${target} · requestId=${requestId}）：`) +
            `${JSON.stringify(promptResult)}`);
        }

        // ── ③ ★ 回执：再 list() 复查那一行（规格 §六b）
        //    ⛔ 单靠 {accepted:true} 不足以证明"那个会话真的起了一轮"
        let agentAvailable = null;
        let running = null;
        try {
          const listed = await sc.list({});
          const row = (listed?.items || []).find(
            (it) => String(it?.sessionId) === String(targetId));
          if (row) {
            agentAvailable = !!row.agentAvailable;
            running = !!row.running;
          }
        } catch (e) {
          // ★ 复查失败**不许把投递说成失败** —— 投递已经 accepted 了。
          //   但要如实标出"复查没做成"。
          agentAvailable = null;
          running = null;
          log(`list() 复查失败（投递本身已 accepted）：${e?.message || e}`);
        }

        const receipt = {
          ok: true,
          target,
          sessionId: targetId,
          requestId,
          accepted: true,
          agentAvailable,
          running,
          at,
          // ★★ 能力自述 —— 一眼判断"跑的是哪一份模块"
          version: WAKER_VERSION,
          caps: WAKER_CAPS,
          // ★ 口径（实测校准过 · 2026-10-16 凌晨）：
          //   `running` 是 `SessionSummary.running`，语义是「**这个会话活着**」，
          //   ⛔ **不是"它在干活"**。
          //   实测：投给某个会话时回执报 `running=true`，而那个会话自己回话说
          //   "我这边没跑作业" ⇒ ★ 两者不矛盾，是我先前把这个字段读窄了。
          note: `[v${WAKER_VERSION}] 投递已 accepted；agentAvailable/running 取自 list() 的 SessionSummary` +
            "（★ 说的是「会话活着 / 有 agent」，⛔ 不是「它在干活」）" +
            (agentAvailable === null ? "（复查没做成 ⇒ 见日志）" : ""),
        };
        log(`wake(${target}) ⇒ accepted · agentAvailable=${agentAvailable} · running=${running}`);
        return receipt;
      },
    });

    // ══════════════════════════════════════════════════════════════════
    //  ★★ peek —— 读对方会话（规格 §九）
    //
    //      wake 是【发信】· peek 是【收信】 ⇒ 两个合起来才是跨会话往返。
    //
    //  ⛔⛔ **peek 绝不许叫醒对方** —— 只用 `sessionQuery` 的读方法，
    //      **一个都不许碰 `resolveAgent`**（那会 resume ⇒ 把对方叫起来）。
    //
    //  ★ 而这一条**有原文保证**（`sessionQuery.readSession` 的描述）：
    //      "Read and replay-validate one complete logical session log
    //       **without making it live**."
    //    ⇒ 服务层自己承诺"读不让它变 live" ⇒ 与"绝不许叫醒"正好对上。
    // ══════════════════════════════════════════════════════════════════
    const disposePeek = tools.register({
      name: "peek",
      description:
        "读另一个会话（只读 · ★ 绝不会把它叫醒）。" +
        "wake 是发信、peek 是收信 —— 两个合起来才是跨会话往返。" +
        `★ v${WAKER_VERSION}。` +
        "target 填【session-… 形式的 id】（直接读，⛔ 不查字典）或【名字】（查会话 id 字典）。" +
        "mode：surface=它现在看到的历史（默认，含正文）· " +
        "events=逐事件的【元数据】（★ 只有 seq/type/time，没有正文）· " +
        "recent=完整原始事件日志的尾部（含正文）。" +
        "⛔ 三条禁令：" +
        "⛔ 不许拿它当轮询用（那是'看'不是'等'）—— 要等就用返回值 + 上层自己控间隔；" +
        "⛔ 不许拿它翻别人的全部历史（peek 是【读它的回复】，⛔ 不是【翻它的底】）—— 没明确目的就别拉满 limit；" +
        "⛔ 不许用它替代 wake（你只能读，不能让它干活）。" +
        "⚠️ 它读不到 ≠ 对方没做 —— 可能是正在跑。★ 没回就等，⛔ 别立刻再 wake 一次。" +
        "完整使用说明见插件目录 USAGE.md。",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "要读哪个会话。填【session-… 形式的 id】可直接读（⛔ 不查字典）；填【名字】则查会话 id 字典解析。",
          },
          mode: {
            type: "string",
            enum: ["surface", "events", "recent"],
            description: "surface（默认·含正文）· events（元数据）· recent（原始日志尾部）",
          },
          limit: {
            type: "integer",
            description:
              `最多返回多少条（★ 三个模式都生效 · 默认 ${PEEK_LIMIT_DEFAULT} · ` +
              `上限 ${PEEK_LIMIT_MAX}）。` +
              "★ 不传就按默认截 —— 会话可以有一万多条事件，不截会把调用方上下文炸掉。" +
              "⛔ 没明确目的别拉满。",
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
      output: {
        schema: { type: "object" },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value, null, 2) }];
        },
      },

      async execute(args) {
        const mode = String(args?.mode ?? "surface").trim() || "surface";
        if (!["surface", "events", "recent"].includes(mode)) {
          throw new Error(
            `mode 不认识：${JSON.stringify(mode)}（只能是 surface / events / recent）`);
        }
        const { target, targetId } = await resolveTarget(args?.target);

        // ★★ 截断（**三个模式都用它** —— 见 PEEK_LIMIT_DEFAULT 的注释）
        const lim = normLimit(args?.limit);

        // ③ ★ 缺 sessionQuery ⇒ 报错讲清"要挂 dsh-session-query-sqlite"（规格 §九·三）
        const sq = ctx.get("sessionQuery");
        if (sq === undefined) {
          throw new Error(
            "[waker] 拿不到 sessionQuery（Host Service）—— 读会话要靠它。\n" +
            "⇒ 请在 profile 的 cordis.yml 里挂上 `@deepseek-ai/dsh-session-query-sqlite`" +
            "（读会话的后端）。\n" +
            "⛔ 不静默返回空 —— 那会让人以为'对方什么都没说'。");
        }

        const at = nowIso();
        const out = {
          ok: true, target, sessionId: targetId, mode, at,
          // ★★ 明写这一条：调用方不该靠猜
          woke: false,
          // ★★ 能力自述 —— 调用方拿它一眼判断"跑的是哪一份模块"（见 WAKER_CAPS）
          version: WAKER_VERSION,
          caps: WAKER_CAPS,
          note: `[v${WAKER_VERSION}] 只读 —— 没有调 resolveAgent、没有 prompt ⇒ 对方没被叫醒`,
        };

        try {
          if (mode === "surface") {
            // ★ 它现在【看到】的历史（含正文）—— 这才是"对方回了什么"
            const snap = await sq.readSurface(targetId);
            out.capturedThroughSeq = snap?.capturedThroughSeq ?? null;
            out.inheritedEventCount = snap?.inheritedEventCount ?? null;
            out.header = snap?.session ?? null;
            // ★★ 截断（每次调用都必须截 —— 一个会话可以有一万多条 surface 事件）
            const all = snap?.events ?? [];
            out.totalEvents = all.length;
            out.events = all.slice(-lim).map(summarizeSurfaceEvent);
            out.count = out.events.length;
            out.limit = lim;
          } else if (mode === "events") {
            // ★ 轻量逐事件 —— ⚠️ 真实契约：`SessionEventRecord` **只有元数据**
            //   （sessionId / seq / type / time / surface），**没有正文**
            //   ⇒ 规格 §九 写的 listEvents 就是它；要正文用 surface 或 recent。
            const recs = await sq.listEvents(targetId);
            // ★★ 截断 —— 实测踩过：`peek(target="some-session", mode="events", limit=5)`
            //   **忽略了 limit**，返回【全部 19426 条】、溢出 2.3 MB
            //   ⇒ 一次调用就能把调用方的上下文炸掉。
            //   ⛔ `limit` **必须在这个模式也生效**（规格 §九 原文说"只在 recent"，那是错的）。
            const all = recs ?? [];
            out.totalEvents = all.length;
            out.events = all.slice(-lim).map((r) => ({
              seq: r?.seq ?? null, type: r?.type ?? null,
              time: r?.time ?? null, surface: r?.surface ?? null,
            }));
            out.count = out.events.length;
            out.limit = lim;
            out.note += "；★ 本模式的记录【不含正文】（要正文用 mode=surface 或 recent）" +
              "；★ 已按 limit 截【尾部】";
          } else {
            // recent：完整原始事件日志的尾部（含正文）
            const snap = await sq.readSession(targetId);
            const evs = snap?.events ?? [];
            out.totalEvents = evs.length;
            out.events = evs.slice(-lim).map(summarizeSurfaceEvent);
            out.count = out.events.length;
            out.limit = lim;
          }
        } catch (e) {
          // ② ★ 读不到要报错（不静默返回空）—— 规格 §九·二
          throw new Error(
            `peek 读不到：target=${target} · ${targetId} · mode=${mode}\n` +
            `   ${e?.code || e?.name || ""} ${e?.message || e}\n` +
            `⇒ 按 §九：报错，不静默返回空（空会让人以为"对方什么都没说"）。`);
        }

        // ★★ 最后一道闸：**无论哪条路，返回的条数都不许超过上限**。
        //   ⇒ 防的是"将来加了新 mode 忘了截"（与 §K.16 的"最后一道保守闸"同一路数）。
        if (out.events.length > PEEK_LIMIT_MAX) {
          log(`⚠️ peek(${target}, ${mode}) 返回 ${out.events.length} 条 > 上限 ` +
              `${PEEK_LIMIT_MAX} —— 已再截一次（这是实现漏洞，请报）`);
          out.events = out.events.slice(-PEEK_LIMIT_MAX);
          out.count = out.events.length;
          out.limit = PEEK_LIMIT_MAX;
          out.truncatedByGuard = true;
        }

        log(`peek(${target}, ${mode}) ⇒ ${out.count} 条 · 未叫醒`);
        return out;
      },
    });

    return () => {
      // ★ 精确释放（`register` 返回的就是精确 disposer）
      disposePeek();
      dispose();
      disposeSessions();      // ★ sessions 工具（v0.2.0 新增）
    };
  };

  // ★★★ 启动即自安装（跟 tools 无关，⛔ 不等它）
  ctx.effect(() => {
    selfInstall().catch((e) => log(`selfInstall 异常：${e?.message || e}`));
  });

  // ★ 外层：先试一次；没就绪就【轮询等】，最多 300ms × 200 = 60s ⇒ ⛔ 不无限等
  ctx.effect(() => {
    const first = registerWaker();
    if (first !== null) return first;            // ★ tools 已就绪 ⇒ 一次成功
    log("tools 服务还没就绪 ⇒ 等它出现再注册（⛔ 不再 throw ⇒ 避免 fiber failed）");
    const cleanups = [];
    let tries = 0;
    let done = false;
    const timer = setInterval(() => {
      if (done) return;
      tries += 1;
      const c = registerWaker();
      if (c !== null) {
        done = true;
        clearInterval(timer);
        cleanups.push(c);
        log(`tools 就绪 ⇒ 已注册（第 ${tries} 次重试后）`);
      } else if (tries >= 200) {
        done = true;
        clearInterval(timer);
        log("⚠️ 等 tools 超时（300ms × 200 = 60s）—— ★ 插件未注册工具（不静默）");
      }
    }, 300);
    return () => {
      done = true;
      clearInterval(timer);
      for (const c of cleanups) {
        try { c(); } catch { /* 释放失败不抛 */ }
      }
    };
  });
}

export default apply;
