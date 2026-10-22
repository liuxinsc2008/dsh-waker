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

## 二、两个工具

| 工具 | 做什么 | 方向 |
|:--|:--|:--|
| `wake(target, content)` | 投一条消息过去，**让对方跑一轮** | 你 → 对方 |
| `peek(target, mode, limit)` | **只读**对方说了什么（⛔ 不会叫醒它） | 对方 → 你 |

### `target` 怎么填（v0.2.0）

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

## 三、装

$$\text{GUI} \to \text{插件} \to \text{「+ 添加插件」} \to \text{本地目录路径}$$

把本目录的路径填进去即可。装完 DSH 会给 agent 注册 `wake` / `peek` 两个工具。

### 为什么没有 UI

`wake` / `peek` 需要 `sessionController` 和 `sessionQuery` 两个 **Host Service**。
早期版本以为"只有客户端插件能拿到 sessionController"，**说反了** ——
它本来就是 Host service。所以本插件**只要一个 `lib/index.js`**，不需要前端。

---

## 四、会话 id 字典

填**名字**时，插件去读一份 Markdown 表格：

```
| 名字 | id |
|---|---|
| 某个会话 | `session-xxxxxxxx-…` |
```

**文件在哪**由插件按以下顺序找：

1. 显式配置（若提供 `workspaceRoot`）
2. **从插件所在位置逐级上溯**，找含该表的目录
3. 最后退回 `process.cwd()`

**⚠️ 为什么不缓存：** 那份表会被改，缓存 = 造出第二份 = 两处口径。
**⇒ 每次调用现读。**

**⚠️ 如果你只填 id** —— **根本不会碰这个文件**（v0.2.0 起）。
所以你可以完全不用字典，把 id 记在别处。

**⚠️ 两个踩过的坑（代码注释里也写着）：**

- 名字里可能是**破折号 `——`**（U+2014 ×2），不是 ASCII `-`
- id 带 `session-` 前缀 ⇒ ⛔ 不能用"纯十六进制"字符类
  （`s`/`e`/`i`/`o`/`n` 不在里面 ⇒ 一个都匹配不上）

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
