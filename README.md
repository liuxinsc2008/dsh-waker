# dsh-waker · 唤醒器

> DeepSeek Harness 插件：**跨会话往返** —— 让一个会话给另一个会话派活，并读它回了什么。

**给 AI 看的使用说明在 [`USAGE.md`](./USAGE.md)** —— 装好之后，DSH 里的智能体会看到这份约束。
本文件是给**人**看的。

---

## 一、它解决什么

$$\text{一个会话要唤起另一个会话} \Longrightarrow \textbf{不用人转达} \Longrightarrow \text{给 agent 一个工具}$$

DSH 里同时开着几个会话时，它们各自有上下文、各自在干活。**wake** 让你派活过去，**peek** 让你把结果读回来。

```
会话 A ──wake──▶ 会话 B 自己跑一轮
       ◀──peek──  B 说了什么
```

**⇒ 人不用当传声筒。**

---

## 二、三个工具

```
sessions  ──▶  看到有哪些会话、各自 id 是什么
   │
   ├──wake──▶  派活过去，对方自己跑一轮
   └──peek──▶  读它说了什么（⛔ 不会叫醒它）
```

| 工具 | 做什么 | 方向 |
|:--|:--|:--|
| `sessions(limit, namedOnly, readOnly, outFile)` | **扫描会话列表**，读回 `sessionId + 标题`；可选**自动生成字典** | 本机 → 你 |
| `wake(target, content)` | 投一条消息过去，**让对方跑一轮** | 你 → 对方 |
| `peek(target, mode, limit)` | **只读**对方说了什么（⛔ 不会叫醒它） | 对方 → 你 |

### `sessions` 干什么用的

**⇒ 你不用手抄 session-id 了。**

它直接读 DSH 自己的会话投影（`$DSH_HOME/storages/session_projcache/sessions/*.json`
里的 `title`），把「id + 标题」列出来。

```
★ 默认 readOnly=true ⇒ 只列出，⛔ 不写任何文件
★ readOnly=false     ⇒ 顺便把它写成字典（默认 `会话id表.md`，已存在会先备份）
```

| 参数 | 说明 |
|:--|:--|
| `limit` | 最多列几个（默认 50，上限 500） |
| `namedOnly` | 只列**有标题**的会话 |
| `readOnly` | 默认 `true`；`false` ⇒ 写字典 |
| `outFile` | `readOnly=false` 时写到哪（默认 `会话id表.md`，相对当前目录） |
| `includeSubagents` | 也列子智能体会话（默认不列） |

**⚠️ 它读到的是 DSH 的**投影缓存**，不是实时列表** —— 缓存由 DSH 自己维护，
一般来说就够了。⛔ 它不会去 `wake` 任何会话（只读工具）。

### `target` 怎么填

```
★ 填 "session-…" 形式的 id  ⇒ ★★ 直接用，⛔ 不查表
★ 填 名字                   ⇒ 查【会话 id 字典】解析
```

$$\text{字典} = \text{检索用};\qquad ★\ \text{⛔ 不是插件的守门人}$$

**这条是刻意的**：id 一填就通，插件不去判断"这个会话该不该存在"。
代价是**填错一个字符消息就石沉大海** —— 所以查字典再填，或者填之前核对。

### `mode`（只能 peek 用）

| mode | 给你什么 | 体积 |
|:--|:--|:--|
| `surface`（默认） | 它现在看到的历史，**含正文** | 中 |
| `events` | 逐事件的元数据（seq / type / time），**无正文** | 小 |
| `recent` | 原始事件日志的尾部，**含正文** | 大 |

`limit` 默认 10，有上限。**不传就截** —— 会话可以有一万多条事件，不截会把调用方上下文炸掉。

---

## 三、装（★★ 必须看这一节）

### ★★★ 你不用管装到哪 —— **插件启动时会自己复制进本机安装目录**

$$\text{插件加载} \to \text{如果自己不在 } \texttt{node\_modules} \text{ 下} \Rightarrow ★\ \text{自动复制一份进去}$$

**⇒ 解压到桌面、clone 到 D 盘、从哪加载都行 —— 它自己会搬进：**

```
%DSH_HOME%\profiles\<profile>\node_modules\dsh-waker\
```

**⇒ 搬完之后，那个“源文件夹”就可以随便删 / 挪 / 重命名了，插件不受影响。**

**怎么确认搬了：** 看那份里的 `.sync.json`

```json
{
  "from": "D:/你原来的/目录",
  "at": "2026-10-22T19:13:45+08:00",
  "version": "0.5.0",
  "note": "本目录是【副本·真身】；源目录删了也不影响。改源码后重启 DSH 会重新同步。"
}
```

**⇒ 改了源码怎么办：** 重启 DSH ⇒ 发现源和副本不一致 ⇒ **自动重新同步**。

**⚠️ 只有一种情况不搬：** `npm install` 装的 —— 它本来就在 `node_modules` 里。

---

### 以下是你想【手动】摆正时用（一般不需要）

### 铁律：手动弄的话，必须把插件【复制】进本地安装目录

$$\text{装完} \Longrightarrow ★\ \textbf{插件真身必须在:}\ \texttt{\%DSH\_HOME\%\\profiles\\<profile>\\node_modules\\dsh-waker\\}$$

**⛔ 不要用"链接 / Junction / 快捷方式"指向外面某个文件夹。**
原因只有一条：**那个文件夹一删、一挪、一重命名，插件就废了，而你不会想到是这个原因。**

**⛔ 也不要"解压到哪就从哪加载"** —— 那等于把插件绑死在那个位置。

### 三种装法，都要落到同一个结果

| 你怎么装 | ★ 装完必须做的 |
|:--|:--|
| 图形界面「+ 添加插件」填本地目录 | ★ **把它复制进 `node_modules\\dsh-waker\\`**（见下） |
| `git clone` 到任意目录 | ★ **复制进 `node_modules\\dsh-waker\\`** |
| `npm install dsh-waker` | **不用管，npm 已经装进去了** ✅ |

**⇒ 复制命令（PowerShell，改 $src 即可）：**

```powershell
$src = "D:\你的\解压位置\dsh-waker"          # ← 改成你解压 / clone 的地方
$dst = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-waker"

# ⛔ 若 dst 已存在且是链接 ⇒ 先删链接（只删链接，不动源文件）
$it = Get-Item $dst -EA SilentlyContinue
if ($it -and $it.LinkType) { [System.IO.Directory]::Delete($dst, $false) }
Remove-Item $dst -Recurse -Force -EA SilentlyContinue

Copy-Item $src $dst -Recurse -Force
```

**⇒ 复制完，那个"源文件夹"就可以随便删了。**

### 检查装对了没有

```powershell
$dst = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-waker"
(Get-Item $dst).LinkType        # ← 必须是【空】；Junction / SymbolicLink = 没装好
node --check "$dst\lib\index.js"
```

**⇒ 顺手把 profile 清单里的 `link:` 去掉：**

```json
// C:\Users\<你>\.dsh\profiles\desktop\package.json
"dependencies": {
  "dsh-waker": "0.4.0"          // ⛔ 不是 "link:D:/某个/外部/目录"
}
```

---

## 四、会话 id 字典在哪

$$\text{字典} \to ★\ \texttt{\%DSH\_HOME\%\\waker-会话id表.md}$$

**⇒ 默认就是 `C:\\Users\\<你>\\.dsh\\waker-会话id表.md`**

**⛔ 不放在插件目录里**，原因：

- `npm install` 装的插件 ⇒ 包目录**只读 / 升级会被覆盖**
- `git clone` 装的 ⇒ 在仓库里，**⛔ 不该写运行时数据**
- 放 `%DSH_HOME%` ⇒ **三种装法都落到同一个地方**，重装 / 升级插件都不丢

### ★★ 每次调用先重建

$$\text{调用} \to \text{重建字典} \to \text{再执行}$$

`sessions()` / `wake(名字)` / `peek(名字)` 都会**先重建字典再干活**。

- **为什么**：会话会**新建 / 归档 / 分支** ⇒ 字典会过期 ⇒ 重建比"增量判断谁变了"简单且不会错
- **代价**：每次多扫一遍目录（60+ 个 json ≈ 50–100ms）
- **⚠️ 填 session-id 那条路不读字典**，也不重建（更快）

### 字典长什么样

```markdown
| 名字 | id |
|---|---|
| 某个会话 | `session-xxxxxxxx-...` |
```

**⇒ 名字 = 会话标题。没有标题的会话，名字就用 id。**

---

## 五、给 AI 的约束（这不是可选项）

`wake` 让别的会话**消耗 token、改文件、占时间**。所以工具描述里写死了五条硬禁令：

1. ⛔ 投给自己
2. ⛔ 一次 wake 一片会话做广播
3. ⛔ 在 `content` 里写指令性陷阱（那是劫持，不是派活）
4. ⛔ 拿 `peek` 翻别人的全部历史
5. ⛔ 同一条信息在两边来回传两次以上（死循环烧 token）

**并且调用前三问**：这件事非它不可吗？`content` 自包含吗？会不会吵到它？

$$\textbf{没回} \ne \textbf{没做};\qquad ★\ \text{它可能正在跑，也可能排在你后面}$$

完整版在 **[`USAGE.md`](./USAGE.md)**，工具描述里也嵌了摘要。

---

## 六、返回值

```json
{
  "ok": true,
  "target": "…",
  "targetId": "session-…",
  "via": "sessionId",       // 或 "name"
  "accepted": true,          // ★ 已送达【队列】, ⛔ 不等于做完了
  "running": true,           // 它当前是否在跑（投之前的快照）
  "version": "0.2.0"
}
```

$$\texttt{accepted: true} \not\Longrightarrow \text{活儿干完了}$$

---

## 七、版本

### v0.5.0（2026-10-22）

- ★★★ **启动时自安装** —— 从外部目录加载时**自动复制**进
  `<DSH_HOME>/profiles/<profile>/node_modules/dsh-waker`
  ⇒ **源文件夹删了 / 挪了都不影响插件**
- 复制后写 `.sync.json` 记录来源；已同步过则跳过；改源码后重启会重新同步

### v0.4.0（2026-10-22）

- ★ 字典改到 `%DSH_HOME%\waker-会话id表.md`（⛔ 不写插件目录）
- ★ **每次调用先重建字典再执行** —— `sessions` / `wake(名字)` / `peek(名字)` 都会触发
- ★ 会话新建 / 归档 / 分支后，字典**不会过期**
- ⚠️ 填 session-id 那条路不读字典，也不重建（更快）

### v0.3.0（2026-10-22）

- ★ **新增 `sessions` 工具** —— 扫描会话列表（id + 标题），可自动生成字典
  ⇒ 不用再手抄 session-id
- 子智能体判断修正：原来按"有没有 `subagent` 投影"判，但**每个会话都有这个投影** ⇒ 读到 0 个；
  改成看 `subagent.val.identity` 是否真的存在

### v0.2.0（2026-10-22）

- **`target` 支持直接填 session-id** —— 填 `session-…` 时**直接用，⛔ 不读字典**；填名字才查
- 字典从"守门人"退回**"检索字典"**的本分
- `wake` / `peek` 共用同一个 `resolveTarget`（⛔ 不做两份），所以两者同时生效
- 工具描述补了完整的使用约束与禁令
- 新增 [`USAGE.md`](./USAGE.md)（写给 AI 的）

### v0.1.5

- 拿不到 `tools` 服务时不再 `throw`，改成轮询等它就绪再注册
  （实测：冷启动时 `throw` ⇒ `fiberPhase=failed` ⇒ 工具永不注册）

### v0.1.4

- HMR 热更验通（不重启即生效）

---

## 八、自测

```bash
npm test      # 4 套自测
npm run check # 语法 + 4 套自测
```

自测**不依赖装进 DSH** —— 用假的 `ctx` / `sessionController` 跑。

| 自测 | 验什么 |
|:--|:--|
| `_selftest.mjs` | 装、注册、两步 wake、错误路径、等 tools 就绪 |
| `_selftest_peek.mjs` | 三种 mode、截断、只读不叫醒 |
| `_selftest_sid.mjs` | **填 id ⇒ 不查表**（含"表坏掉仍能唤醒"） |
| `_selftest_peek_sid.mjs` | peek 填 id ⇒ 不被字典拦 |

**关键判据（怎么确认填 id 那条路真的不读表）：**

```
★ 把读表函数改成直接抛异常 ⇒ ★★ 填 id 仍然唤醒了
```

---

## 九、边界

- ⛔ 不做"客户端半身"（不需要）
- ⛔ 不缓存字典（会造出两处口径）
- ⛔ 不给 `target` 设 enum（要支持任意 id）
- ⛔ 不做群发 API（广播容易误用）

---

## 十、许可

MIT
