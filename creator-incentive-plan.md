# 创作者激励 · 实施方案 v4（PIX 代币 · 全量可配，待审核）

> 目标：网站收入按比例形成激励池，按创作者贡献分配，以 **PIX 代币**入账，由创作者**自行提现**。
> 配套文档：`payment-plan.md`（资金入口：易支付 / 站点赞助 / 扩容）。
> 状态：**方案待审**，未动任何代码。

---

## 0. 结论先行

**资金闭环**

```
网站收入（广告联盟 / 站点赞助 / 扩容包 —— 到账后录入或由支付回调自动入账）
      ↓  × 创作者分成比例（后台可配，默认 60%，对**毛收入**）
      ↓  ＋ 上期未发完的池余（全额结转，不再打折）
   本期激励池 P
      ↓  按结算分 + 门槛 + 单人封顶分配（最大余数法，分完不多不少）
   每人应得 → 折算为 PIX 入账
      ↓  创作者累积到门槛后自行发起提现
   提现申请 → 管理员审核 → 线下打款 → 标记完成
```

**三层数字**

| 层 | 名字 | 特性 | 谁看得到 |
|---|---|---|---|
| 荣誉层 | **贡献分** | 只增不减；决定等级与结算权重 | 全站公开 |
| 资产层 | **PIX** | 会因提现／打赏而减少 | 本人看余额，他人只看累计获得 |
| 结算层 | **元** | 只在提现页与后台出现 | 提现页 + 后台 |

前台全站只讲 PIX。谈钱的地方只有提现那一页。

**两条写死的红线**

1. **PIX 不可购买、不可转让、不可赠送**。只能靠贡献获得、靠打赏流通。开了充值，性质立刻从激励变成资金通道（洗钱风险）与预付卡业务（需备案发牌）。
2. **不透支**：任何时刻「未兑付 PIX 折算金额 ≤ 平台实际持有现金」。结算确认与提现申请两处强制校验（§3.4）。

**为什么必须有一个 `/fund` 公示页**

公益站的信任不是靠一页「关于我们」建立的，是靠**每一笔收支都能被外人核对**建立的。资金池水位、逐笔收支明细、各期结算分配、赞助入口、鸣谢墙 —— 全部同屏，一页看完（§8.1）。这也是「创作者能看到资金池」这句要求的落点。

**改动体量**：新增 6 表 + 3 枚举 + 10 个模块 + 4 个前台新页（含 `/fund` 公示页）+ 3 个后台页。

---

## 1. 现状盘点

| 已有能力 | 位置 | 与激励的关系 |
|---|---|---|
| 广告位（AdSense 类联盟代码注入） | `src/components/ads/AdBlock.tsx` | 只有投放能力，**无任何收入数据**，收入须到账后录入 |
| 创作者榜（只按粉丝数） | `src/lib/home.ts` → `getTopCreators()` | 首页板块 + 侧栏 widget 共用，是榜单挂载点 |
| 互动计数器 | `Resource.likeCount / favoriteCount / downloadCount / commentCount` | 只按资源计，无按作者汇总 |
| 行为写入口 | `src/lib/actions/social.ts`、`moderation.ts` | 计分挂载点 |
| 下载去重 | `incrementDownloadAction` 用 **cookie `dl_done`** | 可清、可换浏览器绕过，且 1024 字符会截断 —— 必须换掉 |
| 通知写入口 | `src/lib/notify.ts` | 升级 / 结算 / 提现 / 收到打赏通知复用 `SYSTEM`，无需扩枚举 |
| 站点配置 | `SiteSetting(key, value: JSON, version)`，现仅 `theme` | 激励配置按同模式新增 key `incentive` |
| IP 哈希惯例 | `src/app/api/track/route.ts`（`sha256(ip + AUTH_SECRET)` 取 16 位） | 去重与配额直接复用，须抽公共 `hashIp()` |
| 支付通道 | 无，见 `payment-plan.md` | 只用于「收入进站」，不用于出款 |
| 金额 / 代币工具 | **均无** | 需新增 |

---

## 2. 代币体系（PIX）

### 2.1 为什么是两层数字

- 贡献分必须**永不减少** —— 它是荣誉，等级、榜单、结算权重都挂在上面。提现掉等级 = 激励变挫败。
- PIX 必须**能被花掉** —— 提现和打赏都会减少它。

一个数字无法同时满足这两条，所以拆开。唯一连接点：**每期结算 = 「贡献分 → PIX」的单向兑换**，兑换后互不影响。

### 2.2 PIX 规则（全部可配）

| 项 | 默认值 | 说明 |
|---|---|---|
| 名称 / 符号 | PIX | 前台所有文案用它，无中文别名 |
| 兑换比例 | 100 PIX = 1 元 | 可配。分配仍以「分」为单位做完再折算，**不影响金额守恒** |
| 提现门槛 | 1000 PIX（=10 元） | 低于门槛不能发起提现 |
| 提现手续费 | 0 | 公益站不抽 |
| 提现冷却 | 7 天/次 | 防刷单申请 |
| 提现审核 | 需人工审核 | 可关 |
| 打赏开关 | 开 | 见 §2.5 |
| 单笔打赏范围 | 1 – 10000 PIX | 可配 |

### 2.3 PIX 的两个来源，一个流通方式

| 类型 | 触发 | 对偿付能力的影响 |
|---|---|---|
| **激励池分配**（唯一的新增来源） | 结算期 `CONFIRMED` 时入账 | 金额 ≤ 收入 × 比例，**有真金白银对应** |
| **打赏**（站内转账） | 打赏者扣 PIX，作者加 PIX | **净额为零** —— 不新增 PIX，只转移，天然不影响偿付能力 |

这条结构很重要：**PIX 的总量只由激励池一次创造，打赏只是搬运**。所以「总量有限的代币 + 真实资金背书」这一点不会被打赏破坏。

### 2.4 提现流程（用户自助）

```
用户点「提现」→ 填 PIX 数量 + 收款方式（支付宝/微信 + 姓名）
   ↓  校验：达门槛、冷却已过、可用余额充足、平台现金水位充足（§3.4）
立即冻结该笔 PIX（frozen，防同一笔提两次）
   ↓
后台提现审核队列：通过 / 驳回（驳回自动解冻退回）
   ↓  通过后线下打款，回填流水号
标记 PAID → 扣减余额与冻结、写流水、发通知
```

- 金额与兑换比例在**提交时快照**，事后改配置不影响已提交申请。
- 状态单向 `PENDING → APPROVED → PAID`；`REJECTED` 是终态但会解冻。
- 收款账号属个人敏感信息：**仅 adminOnly 可见**，不进日志、不进公开页面、不进任何导出。

### 2.5 打赏：只能用 PIX

**打赏是站内 PIX 转账，不经过支付通道。** 读者用自己挣来的 PIX 打赏作者，平台不经手任何真钱。

| 项 | 设计 |
|---|---|
| 入口 | 资源详情页 `ActionBar` 内（图标 + 文字，与收藏/关注同形态，不新增行） |
| 计价 | 以 **PIX** 计价（预设 100 / 500 / 1000 / 2000 PIX + 自定义，范围可配）；**前台不显示 ¥ 等值** —— 打赏全程在站内闭环，只讲 PIX |
| 资金来源 | **只能用可用余额**（冻结中的 PIX 不能用） |
| 门槛 | 需登录；不能打赏自己；只能打赏 `PUBLISHED` 资源；不能打赏被封禁用户 |
| 归属 | **100% 归作者**，平台 0 抽成 |
| **不计贡献分** | 打赏**不产生贡献分**，也不计入结算 —— 它是价值转移，不是"被认可" |
| 不可撤回 | 转账即完成，不支持撤回（避免"看完就退"的扯皮） |
| 展示 | 作者可见累计被打赏；公开「打赏榜」默认**关闭**（隐私 + 避免攀比） |
| 频率限制 | 复用 `rateLimit()`，防连点刷屏 |

**为什么打赏天然抗刷**：A 打赏 B，A 的 PIX 减少、B 的 PIX 增加，**系统内 PIX 总量不变**。自导自演（小号互打）除了损失手续费和时间，什么都得不到 —— 因为不产生贡献分、不产生新 PIX、也不影响榜单。

通知：作者收到打赏发 `SYSTEM` 通知（可在通知设置里关）。

---

## 3. 资金模型

### 3.1 计算链

```
收入录入（联盟广告 / 站点赞助 / 其他，按月归属；赞助由支付回调自动入账）
      ↓  Σ
本期收入 R ──× 创作者分成比例（万分比整数）──→ 本期新池 = floor(R × rate / 10000)
      ↓  ＋ 上期未发完的池余 carryInFen（**全额，不再乘比例**）
本期激励池 P
      ↓
各创作者本期结算分 score_i（PointLog 中「计入结算」的原因）
      ↓  allocate()：最大余数法 + 单人封顶迭代
每人 amountFen_i（分，Σ 精确等于 P）
      ↓  × 兑换比例（PIX/元）
每人 pix_i（整数）
      ↓  ★ 偿付能力校验（§3.4）
CoinAccount 入账 + CoinLedger 流水 + IncentivePayout 快照
```

**两个「池」必须分清**（全文档最容易混的地方，名字太像了）

| 名字 | 是什么 | 会不会归零 | 前台在哪看 |
|---|---|---|---|
| **激励池 P** | 本期**应发额** = `floor(R × 分成比例) + carryInFen`。是**账目**，不是钱 | 每期重算；没发完的结转下期 | `/creators` 各期公示（§8） |
| **现金池 C** | 站上**真钱** = 累计收入 − 成本 − 已打款。跨期结存 | **不归零** | `/fund` 首屏水位（§8.1） |

**分成比例不是池子，它是公式里的那个「×」** —— 决定「每期收入的多少被记账为要发给创作者」。它乘出来的那块叫激励池。

**关键**：切出来的 60% **一刻也没有离开现金池**。收入全额进 C，60% 只是让**负债 L** 上升（§3.4 现金与负债分离表）；钱真正出去只发生在提现打款那一刻。

**为什么 `carryInFen` 不再乘比例（这条必须写死）**

上一期没发完的 `carryOutFen` 是**已经按比例切好、已经指定给创作者**的钱。如果它下期再乘一次分成比例，等于把其中 `1 − rate` 的部分悄悄收归站里：

| | 金额（rate = 60%） |
|---|---|
| 上期 `carryOutFen` → 本期 `carryInFen` | 20 元 |
| 错误算法 `floor((1000 + 20) × 60%)` | 612 元 → 结转只"生效"了 **12 元** |
| 正确算法 `floor(1000 × 60%) + 20` | 620 元 → 结转**原样**回流 20 元 |
| 那消失的 8 元 | **无账可查** —— 没进 `poolFen`，也没记成站内收入 |

通用式：漏掉的金额恒为 `carryIn × (1 − rate)`。**比例越高这笔漏得越少，但永远不会是 0 —— 与比例高低无关，这个写法本身就是错的。**

规则：**分成比例只作用于本期新增收入；池余全额结转、原样回流。**

> ⚠️ 别和**现金池的「上期结转」**混了 —— 那是 C 的定义项（§3.4），与 `carryInFen` 不是同一个数字。

> ⚠️ **一个必须提前知道的会计选择**：比例是对**毛收入 R** 切的，**不是**对「收入 − 成本」的利润切的。所以当成本占收入比例偏高时，`L` 会长得比 `C` 快，安全水位被顶破 → 结算确认被闸门拒掉。
> **如果长期被拒，说明分成比例相对当前成本结构定高了，该下调** —— 这不是 bug，是闸门在正常工作。
>
> **定 60% 时的隐含假设是「运营成本长期不超过收入的 40%」。** 这是相当激进的一档：站点同时还要留出偿付 buffer（默认 10%），实际留给成本的余量只剩约 30%。若服务器/存储/域名合计超过收入的 30%，结算确认会开始被闸门拒 —— 那时的选择是**下调比例**，而不是关掉闸门。先跑一两个月，用 `/admin/finance` 的真实台账校准这个数。

**精度纪律**：金额一律整数「分」，比例一律万分比整数，PIX 一律整数，**全链路不出现浮点**。分配在「分」层面用最大余数法完成（保证 Σ 精确等于池子），再统一折算 PIX，折算不破坏守恒。

### 3.2 三道过滤（全部可配）

| 过滤 | 默认 | 作用 |
|---|---|---|
| 结算分门槛 | ≥ 50 分 | 低于门槛不参与分配，避免"发 0.03 元"的骚扰式结算 |
| 最低发放额 | ≥ 5 元 | 低于此额不发，转入下期池 |
| 单人单期封顶 | 40% | 防止一人通吃，溢出回流给其余人按比例再分 |

未发出的余款（门槛过滤 + 取整残值）**全额结转下期**，记 `carryOutFen` / `carryInFen`，**下期原样并入池、不再乘分成比例**（理由与反例见 §3.1）。

### 3.3 分配算法（最大余数法 + 封顶迭代）

1. `raw_i = P × score_i / Σscore`（整数运算，`P ≤ 10^9` 分、总分 `≤ 10^7` 时乘积在 JS 安全整数内）。
2. 取 `floor`，差额 `rest = P - Σfloor` 按**小数部分降序**逐人 +1 分，保证总额精确等于 P 且**结果确定性可复算**。
3. 有人超封顶 `P × cap` 时：固定为封顶值，溢出额从池中扣除，对剩余人重复 1–2，最多迭代 3 轮。

实现为**纯函数** `allocate(pool, entries, opts)` —— 相同输入必须逐分相同输出。这是公示能被复算的前提。

### 3.4 偿付能力闸门（回应「不能一提现就倒贴」）

**不变式**：任何时刻 `代币负债 L ≤ 可用现金 C`

```
可用现金 C = Σ收入(IN，已实际到账) + 上期结转现金 − Σ已打款(OUT) − Σ其他支出(OUT)
代币负债 L = Σ(所有用户 CoinAccount.balance + frozen) × 单价（分/PIX）
安全水位   L ≤ C × (1 − buffer)，buffer 默认 10%
```

**两个强制校验点，缺一不可**

| 校验点 | 规则 | 不通过时 |
|---|---|---|
| **结算确认时**（入账 PIX 前） | `L + 本次待入账金额 ≤ C × (1 − buffer)` | **拒绝确认**，提示「可用资金不足：本次需 X 元，可用 Y 元。请核对收入是否已到账、是否漏录」，并列出当前水位明细 |
| **提现申请时** | `C ≥ Σ(所有未打款提现) + 本次申请金额` | 拒绝并提示「当前资金不足以处理提现，请稍后再试」 |

**为什么必须两道**：结算时校验保证"发出去的 PIX 有真钱对应"；提现时再校验保证"来兑现的时候钱还在"—— 中间任何一笔资金被挪走都会被第二道拦下。

**辅助配置**
- `buffer` 安全水位比例（默认 10%）
- 资金不足时的策略：**拒绝**（默认，推荐）／ 按可用资金等比缩减本次发放（保守模式，需显式开启）

**现金与负债的分离（账目核心）** —— 这张表决定所有账怎么记，必须严格执行：

| 事件 | 现金 C | PIX 负债 L |
|---|---|---|
| 赞助到账 / 广告收入到账 | **+** | 不变 |
| 结算确认、向创作者入账 PIX | 不变 | **+**（负债产生，钱还没出去） |
| 用户提现、线下打款完成 | **−** | **−** |
| 打赏（站内 PIX 转账） | 不变 | **不变**（内部转移，净额为零） |
| 支付服务器 / 存储 / 域名成本 | **−** | 不变 |

**关键澄清**：激励池分配**不是现金支出**，它只让负债上升；真正付钱只发生在提现打款那一刻。因此 `LedgerEntry` 只记**真钱进出**（收入 / 成本 / 提现打款），结算分配不进 `LedgerEntry`（它记在 `IncentivePeriod` 与 `CoinAccount`）。两件事混进一张表，账永远对不平。

**前提纪律**：收入录入 = **钱已实际到账**，不是"预计收入"。录入界面必须写死这句提示，否则水位公式就是假的。

---

## 4. 数据模型（Prisma 增量）

```prisma
/// 贡献分余额（荣誉层，物化；事实来源 PointLog）
/// 无 frozen 列 —— 计分冻结只认配置 risk.frozenUserIds（单一事实来源）
model UserPoint {
  userId    String   @id
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  balance   Int      @default(0)
  level     Int      @default(0)      // 冗余等级，仅供排序
  updatedAt DateTime @updatedAt

  @@index([balance(sort: Desc)])
  @@index([level])
}

/// 贡献分流水（事实来源）
model PointLog {
  id        String      @id @default(cuid())
  userId    String
  actorId   String?
  reason    PointReason
  delta     Int
  refId     String?     // 幂等键（语义见 §5）
  balance   Int         // 记账后余额快照
  note      String?
  createdAt DateTime    @default(now())

  @@unique([userId, reason, refId])   // ADMIN_ADJUST 用 refId=null（唯一索引不约束 NULL）
  @@index([userId, createdAt(sort: Desc)])
  @@index([reason, createdAt])
}

/// PIX 账户（资产层）
model CoinAccount {
  userId            String   @id
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  balance           Int      @default(0) // 可用 PIX
  frozen            Int      @default(0) // 提现申请中冻结
  lifetimeEarned    Int      @default(0) // 累计获得（不因提现/打赏减少）
  lifetimeWithdrawn Int      @default(0)
  lifetimeTippedOut Int      @default(0) // 累计打赏出去
  updatedAt         DateTime @updatedAt

  @@index([balance(sort: Desc)])
}

/// PIX 流水（事实来源）
model CoinLedger {
  id        String     @id @default(cuid())
  userId    String
  delta     Int        // 正=入账，负=出账
  kind      CoinReason
  refType   String?    // SETTLE_PERIOD | TIP | WITHDRAWAL | MANUAL
  refId     String?    // 幂等键
  balance   Int        // 记账后可用余额快照
  note      String?
  createdAt DateTime   @default(now())

  @@unique([userId, kind, refId])
  @@index([userId, createdAt(sort: Desc)])
}

/// 打赏记录（一笔打赏 = 两条 CoinLedger：发出方 −N、接收方 +N）
model TipRecord {
  id         String   @id @default(cuid())
  fromUserId String
  fromUser   User     @relation("TipFrom", fields: [fromUserId], references: [id], onDelete: Cascade)
  toUserId   String
  toUser     User     @relation("TipTo", fields: [toUserId], references: [id], onDelete: Cascade)
  resourceId String?
  resource   Resource? @relation(fields: [resourceId], references: [id], onDelete: SetNull)
  coin       Int      // PIX 数量
  message    String?  // 附言（≤60 字，过敏感词）
  createdAt  DateTime @default(now())

  @@index([toUserId, createdAt(sort: Desc)])
  @@index([fromUserId, createdAt(sort: Desc)])
  @@index([resourceId])
}

/// 提现申请
model WithdrawalRequest {
  id           String         @id @default(cuid())
  userId       String
  user         User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  coinAmount   Int            // 申请提现的 PIX
  fiatFen      Int            // 折算金额（分）—— 提交时快照
  rateSnapshot Int            // 提交时的兑换比例（PIX/元）
  feeFen       Int            @default(0)
  status       WithdrawStatus @default(PENDING)
  method       String         // alipay | wechat
  accountInfo  String         // 收款账号 + 姓名（敏感，仅 adminOnly）
  note         String?
  handledBy    String?
  handledAt    DateTime?
  rejectNote   String?
  paidAt       DateTime?
  payRef       String?
  createdAt    DateTime       @default(now())

  @@index([status, createdAt])
  @@index([userId, createdAt(sort: Desc)])
}

/// 下载记录（同时承担「下载量去重」与「计分去重」）
model DownloadRecord {
  id         String   @id @default(cuid())
  resourceId String
  resource   Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  subjectKey String   // 登录 `u:<userId>`；匿名 `ip:<ipHash>`
  userId     String?
  ipHash     String   // 加盐哈希，与 Visit.ipHash 同算法
  periodKey  String   // YYYY-MM
  counted    Boolean  @default(true) // 是否通过当期计分闸门（排查用）
  createdAt  DateTime @default(now())

  @@unique([resourceId, subjectKey])
  @@index([subjectKey, periodKey])
  @@index([resourceId, periodKey])
  @@index([periodKey])
}

/// 收入录入（仅在钱已实际到账后录入）
model RevenueEntry {
  id         String   @id @default(cuid())
  periodKey  String   // 归属期 YYYY-MM
  source     String   // 联盟广告 / 站点赞助 / 其他
  amountFen  Int
  receivedAt DateTime
  note       String?
  createdBy  String
  createdAt  DateTime @default(now())

  @@index([periodKey])
}

/// 结算期（确认后锁定快照）
model IncentivePeriod {
  id             String          @id @default(cuid())
  periodKey      String          @unique
  status         IncentiveStatus @default(DRAFT)
  revenueFen     Int             @default(0)
  ratePermille   Int             @default(0)
  carryInFen     Int             @default(0)
  poolFen        Int             @default(0)
  totalScore     Int             @default(0)
  paidFen        Int             @default(0)
  carryOutFen    Int             @default(0)
  configSnapshot String?         // 确认时冻结配置，事后改配置不影响已确认期
  confirmedAt    DateTime?
  confirmedBy    String?
  note           String?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  payouts IncentivePayout[]
}

/// 结算明细（确认后锁定；公示与审计的唯一依据）
model IncentivePayout {
  id           String          @id @default(cuid())
  periodId     String
  period       IncentivePeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  userId       String
  user         User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  score        Int
  rank         Int
  amountFen    Int
  coin         Int             // 折算 PIX（冻结值）
  capped       Boolean         @default(false)
  coinCredited Boolean         @default(false) // 防重复入账
  createdAt    DateTime        @default(now())

  @@unique([periodId, userId])
  @@index([userId, createdAt(sort: Desc)])
}

enum PointReason {
  PUBLISH
  LIKE_RECEIVED
  FAVORITE_RECEIVED
  DOWNLOAD_RECEIVED
  COMMENT_RECEIVED
  FOLLOWER_GAINED
  FEATURED
  DAILY_LOGIN
  ADMIN_ADJUST
}

enum CoinReason {
  SETTLE          // 激励池分配入账（唯一的新增来源）
  TIP_SENT        // 打赏支出（负）
  TIP_RECEIVED    // 收到打赏（正）
  WITHDRAW_FREEZE // 提现冻结（负）
  WITHDRAW_PAID   // 提现完成扣减（负）
  WITHDRAW_REFUND // 提现驳回解冻（正）
  ADMIN_ADJUST
}

enum WithdrawStatus {
  PENDING
  APPROVED
  PAID
  REJECTED
}

enum IncentiveStatus {
  DRAFT
  CONFIRMED
  PAID
}
```

`User` 增补反向关系 `points` / `pointLogs` / `coinAccount` / `coinLedger` / `withdrawals` / `payouts` / `tipsSent` / `tipsReceived`；`Resource` 增补 `downloadRecords` / `tips`。

迁移：手工 SQL `prisma/migrations/0006_creator_incentive.sql`，`CREATE TABLE IF NOT EXISTS` + 枚举 `DO $$ ... $$`，不改存量数据。

---

## 5. 计分规则（数值全部可配）

| 原因 | 触发点 | 默认分 | `refId`（幂等键） | 计入结算 |
|---|---|---|---|---|
| `PUBLISH` | `approveResourceAction` 上架成功 | +20 | `resourceId` | ✅ |
| `FAVORITE_RECEIVED` | `toggleFavoriteAction` 新收藏 | +2 | `f:${resourceId}:${userId}` | ✅ |
| `DOWNLOAD_RECEIVED` | 下载记录写入成功且通过月度配额 | +1 | `dl:${subjectKey}:${resourceId}` | ✅ |
| `FEATURED` | 后台设为精选/主推 | +30 | `resourceId` | ✅ |
| `LIKE_RECEIVED` | `toggleLikeAction` 新点赞 | +1 | `l:${resourceId}:${userId}` | ⬜ **默认不计入** |
| `COMMENT_RECEIVED` | `addCommentAction` 成功 | +1 | `commentId` | ⬜ **默认不计入** |
| `FOLLOWER_GAINED` | `toggleFollowAction` 新关注 | +2 | `followerId` | ⬜ **默认不计入** |
| `DAILY_LOGIN` | 登录后首次心跳 | +1 | `YYYY-MM-DD` | ⬜ 默认不计入（分值为 0 即关闭） |
| `ADMIN_ADJUST` | 后台手动加/扣 | 人工 | `null` | ✅ |
| （打赏） | 收到打赏 | — | — | **不产生贡献分**（§2.5） |

点赞、评论、关注**只进荣誉层、不进结算层** —— 它们最容易小号互刷，一旦直接等于钱，刷分动机就从"虚荣"变成"偷钱"。全部可在后台切换。

**共同口径**

- **累计获得，不回冲**：取消赞 / 取消收藏 / 删评论都不扣分。
- **屏蔽自产自销**：`actorId === userId` 在 `awardPoints()` 内统一拦截。
- **只认已上架**：仅 `PUBLISHED` 资源参与计分。
- **计分失败不拖主流程**：只记 `[points] console.error`，绝不抛出。

### 5.1 下载：IP 去重 + 月度配额（下载量与计分共用同一套去重）

原 cookie 去重（`dl_done`）弃用 —— 可清、可换浏览器绕过，且 1024 字符会截断。

**闸门一 · 主体级去重**（`DownloadRecord @@unique([resourceId, subjectKey])`）

| 下载者 | 主体 `subjectKey` |
|---|---|
| 已登录 | `u:<userId>`（换 IP、共享 IP 都不影响） |
| 未登录 | `ip:<ipHash>` |

**闸门二 · 月度配额**：每主体每自然月默认 **50 次**（可配 1–10000）。超配额后**只停计分，下载完全不受影响**。

**闸门三 · 单作品月度计分上限**：默认**关闭**（会误伤热门作品），开启后压制"分布式 IP 池集中刷同一作品"；不开启时改为后台异常提示。

**下载量也走同一套去重**：`Resource.downloadCount` 与计分**共用**唯一约束 —— 写记录成功才 `downloadCount++`。因此：

- 下载量口径从"cookie 计数"变成"主体去重计数"，**数字会下降，且与历史不可比**。这是有意的修正：一个数字既能被刷又能当钱，迟早既是假数据又是真损失。
- NAT 低估：同出口 IP 的多个真人只计一次；偏差方向是少算，接受。
- 匿名是否计入下载量可配（关闭则仅登录用户计数）。

**残留漏洞（不掩盖）**：换 IP 可绕过闸门一 → 靠闸门二压死单主体收益上限；作者匿名下载自己的作品识别不了 → 靠配额限损 + 后台异常提示。

**时区边界**：`periodKey` 取站点本地日期的 `YYYY-MM`（与 `dayKey()` 同处，需新增 `monthKey()`）。

**清理**：沿用 `Visit` 表的机会式清理（写入时 ~1% 概率删除 180 天前的行），不引入定时任务。

---

## 6. 全量可配清单

**唯一配置载体**：`SiteSetting` key `incentive`（JSON + `version` 乐观锁，读法见 `src/lib/site.ts` 的 `getTheme` / `ensureSiteTheme`）。后台 `/admin/incentive` 一页全可改。

| 分类 | 配置项 | 默认值 |
|---|---|---|
| 总开关 | 激励体系开关 | 开 |
| 计分 | 九项分值 + 九项「计入结算」开关 | 见 §5 |
| 下载 | 每主体每月计分上限 | 50 |
| 下载 | 单作品每月计分上限（启用 / 数值） | 关 / 300 |
| 下载 | 匿名下载是否计入下载量 | 是 |
| 等级 | 档位数 / 各档名称 / 各档阈值 | 6 档（§7） |
| PIX | 名称 / 符号 | PIX |
| PIX | 兑换比例（PIX/元） | 100 |
| PIX | 提现门槛 / 手续费 / 冷却天数 / 是否人工审核 | 1000 / 0 / 7 / 是 |
| PIX | 打赏开关 / 单笔范围 | 开 / 1–10000 |
| PIX | 公开打赏榜 | 关 |
| 结算 | **创作者分成比例**（万分比，对**毛收入**；定义见 §3.1） | **6000**（60%） |
| 结算 | 结算分门槛 / 最低发放额 / 单人封顶 | 50 / 5 元 / 40% |
| 结算 | 结算周期 | 自然月 |
| **偿付** | **现金安全水位 buffer** | **10%** |
| **偿付** | **资金不足策略（拒绝 / 等比缩减）** | **拒绝** |
| **公示** | **`/fund` 流水每页条数 / 是否展开金额明细** | **20 / 展开** |
| **公示** | **鸣谢墙是否公开单笔金额 / 是否允许匿名** | **否（只显示人次）/ 允许** |
| **公示** | **水位条安全线是否对外显示 / 公示页缓存秒数** | **显示 / 300** |
| 榜单 | 启用周期（总/月/周）/ 长度 / 上榜最低等级 | 全启用 / 50 / 0 |
| 风控 | 冻结名单 / 异常提示阈值 | — |

**实现纪律（可验收）**

1. 所有阈值只出现在 `src/lib/points-config.ts` 的 zod schema `.default(...)` 里；业务模块（`points.ts` / `download-record.ts` / `settle.ts` / `coin.ts`）从配置读，**不写字面量**。
2. 配置读取走请求级 `cache()`，与 `getTheme()` / `getUploadLimits()` 同范式。
3. 后台表单改动走 `safeIncentiveConfig()`（zod）校验，非法值回退默认并提示，不落库。
4. 验收含**反硬编码检查**（§12）。

---

## 7. 荣誉体系（等级 / 徽章 / 榜单）

等级档位与名称存配置（可增删改），`levelOf(points, levels)` 为纯函数；`UserPoint.level` 仅作冗余排序列。

| 等级 | 名称 | 门槛 | 徽章色 |
|---|---|---|---|
| Lv0 | 新人 | 0 | neutral |
| Lv1 | 创作者 | 50 | brand-500 |
| Lv2 | 资深创作者 | 200 | brand-600 |
| Lv3 | 优秀创作者 | 600 | emerald |
| Lv4 | 明星创作者 | 2000 | amber |
| Lv5 | 殿堂创作者 | 8000 | red |

徽章遵守现有视觉语言：`rounded-none` 直角、无渐变、无 emoji，`lucide-react` 图标 + 语义色描边，明暗双主题可辨识。

**榜单嵌回现有位置**

- 首页 `creators` 板块：`creatorsCfg` 增加 `sort: "followers" | "points"` 与 `period`。⚠️ **`sort` 默认值必须落 `"followers"`** —— 存量 config 只有 `count`，否则不改后台配置时现网行为会被动改变。
- 侧栏 widget 同步（与首页共用同一 schema）。
- 榜单**只显示贡献分，不显示 PIX** —— 荣誉榜不能变成财富榜。

---

## 8. 前台

| 页面 | 内容 |
|---|---|
| **`/fund`** | **资金池公示页（核心）**：现金水位 + 收支明细 + 各期结算公示 + 捐赠入口 + 鸣谢墙，一页看完 —— 详见 §8.1 |
| `/creators` | 创作者榜（总/月/周）+ 激励公示（各期池子与 PIX 分配明细）。SEO 页，`generateMetadata` + 对齐 `sitemap.ts` 口径 |
| `/creators/me` | 我的贡献：等级 + 升级进度条、权益清单、贡献流水（含是否计入结算） |
| `/me/coins` | 我的 PIX：余额 / 冻结中 / 累计获得 / 累计提现 / 累计打赏出去、PIX 流水、打赏记录（收到与发出）、**提现入口**（门槛提示、收款方式、冷却说明、处理时效） |
| `/u/[username]` | 头部加 `LevelBadge`（与现有管理员/免审徽章同排同族）；`statsRow` **不新增第四格**（窄屏会挤破），改在右侧累计数据行追加「贡献分 N / 累计获得 N PIX」 |
| 资源详情 `ActionBar` | 打赏按钮（图标 + 文字，与收藏/关注同形态，不新增行）；点击开打赏面板（PIX 数量 + 附言） |

提现页是唯一出现"元"的前台位置（`/fund` 只出**聚合总额**，不出任何个人金额）。PIX 显示带千分位与符号。

**两个池各归一处**（对应 §3.1）：**现金池 C → `/fund`**，**激励池 P → `/creators` 各期公示**。不要在两处重复展示同一个数字。

---

### 8.1 `/fund` 资金池公示页（把「钱从哪来、到哪去」放在明面上）

**定位**：全站唯一跟钱有关的公开页面。公益站的信任不是靠一页「关于我们」建立的，是靠**每一笔收支都能被外人核对**建立的。

只读页，唯一写动作是「发起赞助」（跳 `payment-plan.md` 的 `/api/pay/create`）。**不做会员中心、不做个人财务面板**。

**贯穿全页的一条铁律：页面上每个数字都必须能追到一条记录**（`LedgerEntry` / `IncentivePeriod` / `IncentivePayout` / `WithdrawalRequest` / `PaymentOrder`），追不到的数字不许上页面。

#### 页面结构（自上而下）

| # | 区块 | 内容 | 数据来源 |
|---|---|---|---|
| ① | **资金池水位**（首屏） | 「可用资金 C = X 元」「创作者 PIX 负债 L = Y 元」+ 水位条 `L / C`，安全线画在 `1 − buffer`；越过安全线即变红并附文案 | `coin.ts` 水位计算（§3.4） |
| ② | **本月收支明细** | 三组：**收入**（广告 / 赞助 / 其他）· **成本**（服务器 / 存储 / 域名）· **创作者提现打款**；每笔记日期、事项、金额、备注。默认展开本月，可切换历史月份 | `LedgerEntry` |
| ③ | **各期激励结算公示** | 每期一行：`收入 × 分成比例 = 池子` → 参与人数 → 分配明细（名次 / 贡献分 / PIX）。标「确认时间」，已确认期**不提供任何编辑入口** | `IncentivePeriod` + `IncentivePayout` |
| ④ | **赞助入口**（锚点 `#sponsor`） | 金额档位 + 自定义 + 留言 + 匿名开关 → 跳支付；旁挂「为什么需要钱」的成本说明表 | `payment-plan.md` |
| ⑤ | **鸣谢墙**（锚点 `#thanks`） | 按月份分组列出赞助者（支持匿名展示为「一位路过的朋友」）+ 月度合计 | `PaymentOrder(kind=SPONSOR, status=PAID)` |
| ⑥ | **累计数字条** | 累计收入 / 累计打款给创作者 / 累计运营成本 / 当前持有 PIX 的人数 | 聚合 |

#### 为什么赞助放这里，而不是单独一个 `/sponsor`

「钱去哪了」和「我要给钱」是同一件事的两个瞬间。拆成两页只会让人多跳一次、多一点怀疑。放同一页，用户看完 ①②③ 往下滑就是 ④，转化与信任是同一个动作。

**路由兼容处置**（AGENTS.md 要求保持 URL 兼容，页脚、二维码、历史外链不能失效）：

| 旧路由 | 处置 |
|---|---|
| `/sponsor` | **301 → `/fund#sponsor`** |
| `/sponsors`（鸣谢墙） | **301 → `/fund#thanks`** |

`payment-plan.md` §5 的两行前台入口同步改为指向 `/fund`（见该文档 §5）。

#### 水位条（「让创作者能看到」的落点）

- 形态：直角双色条，已用负债 `brand-500`、安全线为 `neutral-400` 虚线、越线转 `red`。`rounded-none`、无渐变，遵守现有视觉语言。
- 越线文案（不吓人、说事实）：「当前创作者 PIX 负债已达可用资金的 N%，已超过安全线。新结算会暂缓到收入到账后处理 —— 这是为了保护已发出的 PIX 能真的兑付。」
- **只显示总额，不显示个人余额**。资金池页一旦出现个人数字就变成财富榜，与 §7「榜单只显示贡献分」的原则直接冲突。
- 数值允许 5 分钟延迟（ISR `revalidate = 300`），不为实时性把 DB 打满。

#### 边界与纪律

- **永不出现**：`WithdrawalRequest.accountInfo`（收款账号与姓名）、任何用户的可提现余额、`epayKey` 与回调原始 query。
- 打款流水号 `payRef` 可展示，**只显示后 4 位**（如 `****7788`），用于让用户对得上自己的到账。
- 未登录可看全部（公开页，SEO 页），但**不透露任何个人身份信息**；匿名赞助在对外视图里一律匿名。
- SEO：`generateMetadata` 标题「资金池与收支公示」，进 `sitemap.ts`。**不加 `Organization`/`donation` 结构化数据** —— schema 语义不稳、易被误读为募捐承诺，宁缺毋滥。
- 文案纪律沿用 `payment-plan.md` §5：把「付费」换成「捐赠」这句话仍须成立；禁止「VIP / 会员 / 解锁 / 特权」。
- 空数据态必须有正经文案（新站第一期：显示「第一期结算将在下月初公示」），不能出现空白区块。

#### 组件落位

| 文件 | 职责 |
|---|---|
| `src/app/fund/page.tsx` | RSC，读水位 + 台账 + 结算 + 鸣谢，组合页面；`revalidate = 300` |
| `src/components/fund/PoolMeter.tsx` | 水位条（纯展示，`C` / `L` / `buffer` 三个入参） |
| `src/components/fund/LedgerTable.tsx` | 收支明细表（按月分组，服务端渲染） |
| `src/components/fund/SettlementList.tsx` | 各期结算公示 |
| `src/components/fund/ThanksWall.tsx` | 鸣谢墙 + 月度合计 |
| `src/lib/fund.ts` | 公开聚合只读层：水位、台账分页、累计数字、鸣谢墙 —— **只读，不写任何账** |

容器沿用 `mx-auto max-w-7xl px-4 sm:px-6`，卡片 `rounded-none` + `border` + surface 层级（不用装饰性阴影）。

---

## 9. 后台

| 页面 | 内容 |
|---|---|
| `/admin/incentive` | §6 全部配置项 + 冻结名单 + 手动加/扣贡献分与 PIX（写 `AuditLog`） |
| `/admin/settlement` | 收入录入（**提示"仅在实际到账后录入"**，支持补录/冲正）、生成草稿 → 预览分配（含封顶标记）→ 偿付校验 → 确认锁定（同时入账 PIX）→ 导出明细；异常提示（分数暴涨 / 集中于单一 `actorId`） |
| `/admin/withdrawals` | 提现审核队列：通过 / 驳回（附原因）、打款回填流水号、按状态筛选；**顶部常驻显示现金水位**（C / L / 余量），资金不足时禁止通过 |
| `/admin/finance` | 收支持续台账（`LedgerEntry`）：收入、打款、其他支出，驱动偿付水位与前台筹资进度 |

**状态单向**：结算 `DRAFT → CONFIRMED → PAID`；提现 `PENDING → APPROVED → PAID`（`REJECTED` 终态且解冻）。确认后金额与名次冻结为快照 —— 已公示的数字必须永远可复算。

新增 tab 挂 `src/app/admin/layout.tsx`，图标加进 `src/components/admin/AdminTabs.tsx` 的 `TAB_ICONS`。

---

## 10. 模块划分

**不得塞进 `src/lib/site-config.ts`**（已 762 行，逼近 800 行硬上限）：

| 新模块 | 职责 |
|---|---|
| `src/lib/points-config.ts` | zod schema + **全部默认值**、`levelOf()`、等级与原因文案表（不依赖 server） |
| `src/lib/points.ts` | `awardPoints()` 唯一写入口 + 读侧（榜单、流水）；超 600 行拆 `points-rank.ts` |
| `src/lib/ip.ts` | `hashIp()` / `subjectKeyFor()` —— IP 哈希**唯一实现**，`track/route.ts` 与下载去重共用 |
| `src/lib/download-record.ts` | 下载去重 + 月度配额 + 机会式清理 |
| `src/lib/coin.ts` | PIX 账户与流水：入账、扣减、冻结、解冻、换算、**偿付水位计算**；超 600 行拆 `coin-ledger.ts` |
| `src/lib/tip.ts` | 打赏转账（事务内双向记账，保证净额为零） |
| `src/lib/settle.ts` | 纯函数 `allocate()` + 结算期读写 + 偿付校验；超 600 行拆 `settle-allocate.ts` |
| `src/lib/money.ts` | 分/元换算与 `formatYuan()`（纯函数，前后端共用） |
| `src/lib/fund.ts` | `/fund` 公示页的公开聚合只读层（水位 / 台账分页 / 鸣谢墙 / 累计数字）；**只读，不写任何账** |
| `src/lib/actions/incentive.ts` | 保存配置 |
| `src/lib/actions/settlement.ts` | 收入录入、生成草稿、确认、异常查询 |
| `src/lib/actions/withdrawal.ts` | 用户发起提现、后台审核/打款/驳回 |
| `src/lib/actions/tip.ts` | 发起打赏 |

---

## 11. 分期

### 一期：荣誉体系（基建）

1. 数据模型 + `0006_creator_incentive.sql` 迁移
2. `points-config.ts` / `points.ts` + 六处 action 挂计分
3. `ip.ts` + `download-record.ts`，重写 `incrementDownloadAction`（下载量与计分共用去重）
4. 等级 + `LevelBadge` + 个人主页展示
5. `/creators` 榜单 + `/creators/me` 贡献页
6. 首页 `creators` 板块与侧栏 widget 的 `sort` / `period`
7. `/admin/incentive` 全量配置
8. `prisma/backfill-points.ts` 存量回填（幂等可重跑）

### 二期：PIX 与结算

9. `coin.ts` + `CoinAccount` / `CoinLedger` + **偿付水位计算**
10. `/admin/finance` 收支台账 + `/admin/settlement` 收入录入与结算台
11. 结算确认时的偿付校验 + 确认后入账 PIX
12. `/creators` 公示区
13. **`/fund` 公示页骨架**：`src/lib/fund.ts` + 水位条 + 收支明细（读 `LedgerEntry`）+ 各期结算公示（§8.1 ① ② ③）

> 若「支付一期」尚未上线，`LedgerEntry` 只有成本没有收入 → 先由后台 `/admin/finance` 手工录收入兜住，页面的赞助入口与鸣谢墙暂时隐藏（不出现空区块），支付上线后自动补齐。

### 三期：打赏与提现

14. `tip.ts` + `actions/tip.ts` + 详情页打赏面板 + `/me/coins` 打赏记录
15. `/me/coins` 提现表单与校验（门槛 / 冷却 / 余额 / **现金水位**）
16. 冻结与解冻、`/admin/withdrawals` 审核队列 + 打款回填
17. **`/fund` 收口**：提现打款流水并入区块 ②、鸣谢墙与赞助入口对接支付、`/sponsor` 与 `/sponsors` 301 → `/fund#sponsor` · `/fund#thanks`

### 四期（可选）

- 自动打款（需商户能力，另立项）
- 成就徽章、周榜结算通知
- 功能型权益（评论带图门槛、分级上传额度）

---

## 12. 验收

| 项 | 方式 |
|---|---|
| 类型/静态 | `node node_modules/typescript/bin/tsc --noEmit` 零错误；`node node_modules/eslint/bin/eslint.js src` 不新增 warning |
| 构建/冒烟 | `npm run build`；`npm run test:smoke` |
| **金额与 PIX 守恒** | 反证：① `allocate()` 总额恒等于池子（含余数场景）② 封顶生效且溢出正确回流 ③ 相同输入两次运行逐分相同 ④ 折算后 `Σcoin × 单位 = 池子`（无漂移） |
| **跨期守恒**（`carryIn` 不打折） | 反证：① `carryOut(上期) === carryIn(下期)` 逐分相等 ② `Σpayouts + carryOut === poolFen` ③ **构造「上期有结转」场景，断言 `poolFen === floor(收入 × rate/10000) + carryIn` 而非 `floor((收入 + carryIn) × rate/10000)`** —— 这一条专防 §3.1 那个会吞掉结转的写法回归 |
| **偿付闸门** | 反证：① 可用现金不足时**结算确认被拒**并给出水位明细 ② 现金不足时**提现申请被拒** ③ buffer 生效（`L ≤ C × 0.9`）④ 打款后水位正确下降 |
| **打赏守恒** | 反证：① 一笔打赏后全站 `Σ PIX` **不变**（转出 = 转入）② 余额不足时拒绝 ③ 冻结中的 PIX 不能用于打赏 ④ 不能打赏自己 ⑤ 同一请求重复提交只产生一笔 `TipRecord` 与两条 `CoinLedger` ⑥ 打赏**不产生任何贡献分** |
| **提现状态机** | 反证：① 未达门槛 / 冷却中 / 余额不足 三种情况均被拒 ② 提交后可用额下降、冻结额上升 ③ 驳回后解冻退回 ④ 重复提交不双扣 ⑤ `PAID` 后余额与冻结同时扣减且流水对平 |
| **代币幂等** | 同一期重复确认、同一打赏重复提交，`CoinLedger` 不产生第二条 `SETTLE` / `TIP_*` |
| 计分回归 | 反证：重复点赞不重复计分、自赞不加分、冻结用户不计分、扣分后等级回落 |
| **下载防刷** | ① 同一 IP 重复下载同一作品只计一次（下载量与计分同时只加一次）② 超月度配额后停止计分但**下载仍正常** ③ 登录用户换 IP 下载同一作品不再计分 ④ 并发同一作品只产生一条 `DownloadRecord` |
| **IP 哈希一致性** | 断言 `hashIp()` 与 `track/route.ts` 对同一 IP 产出相同哈希 |
| **反硬编码** | 逐行检查 `points.ts` / `download-record.ts` / `settle.ts` / `coin.ts` / `tip.ts`，阈值只允许出现在 `points-config.ts` 的 schema 默认值处；后台改配置后行为立即变化 |
| **付费不换地位** | 断言：站点赞助、PIX 入账后，`UserPoint.balance` 与 `level` **完全不变** |
| **公示页可追溯** | 反证：① 抽 3 笔收入 / 3 笔成本 / 3 笔打款，页面金额逐一对得上原始记录 ② 后台录入后 5 分钟内出现在 `/fund` ③ 水位数字与 `/admin/withdrawals` 顶部水位**完全一致**（复用同一函数，不得各算一遍） |
| **公示页不泄露** | 反证：源码与渲染结果中均不含 `accountInfo`、任何用户可提现余额、`epayKey`；匿名赞助在未登录视图下显示为匿名；`payRef` 只出现后 4 位 |
| **公示页分页** | 反证：游标翻页不重不漏（同一 `createdAt` 多条时仍正确）；首期无数据时有文案、不留空白区块 |
| **路由兼容** | `/sponsor`、`/sponsors` 均 301 到 `/fund` 对应锚点；页脚入口与历史外链不 404 |
| 迁移幂等 | `npx prisma db execute --file ...` 连执行两次无报错 |
| 视觉 | 真机量测 320 / 375 / 390 / 430 / 768 / 1024 / 1440px + 明暗双主题 |
| 存量兼容 | 不改后台任何配置，刷新首页 `creators` 板块与改前**完全一致** |

---

## 13. 已锁定的决定（仅记录默认值，全部可改）

| 项 | 你的决定 | 落地 |
|---|---|---|
| 提现门槛 | **可配置** | `withdraw.minCoin` 默认 **1000 PIX**（=10 元），后台可改 |
| 分成比例 | **提高到 60%** | `settlement.ratePermille` 默认 **6000**，后台可改。<br>⚠️ 60% 对**毛收入**切，隐含假设是「成本长期 ≤ 收入的 40%」，再扣 10% buffer 后留给成本的余量约 30%。成本一旦超过收入的 30%，结算确认就会被偿付闸门拒 —— 那时**下调比例**，不要关闸门。 |
| 打赏单笔上限 | **可配置** | `tip.maxCoin` 默认 **10000 PIX**（=100 元），下限默认 1，后台可改 |

以上三项**没有一个是写死的**，全部落在 §6 全量可配清单，并由 §12「反硬编码」验收项兜底。

**已按你的决定锁定、不再问**：PIX 名称与符号 · 兑换比例可配（默认 100 PIX = 1 元）· 点赞等互动默认**不计入结算** · PIX **不可购买 / 不可转让 / 不可赠送** · **打赏只能用 PIX** · 提现为用户自助、系统绝不自动打款 · 资金池公示页见 §8.1。

**已无待拍板项。** 说一句「开始」即进入 §11 一期实施；或先指出要调整的地方。

---

## 14. 风险与取舍

| 风险 | 处置 |
|---|---|
| **一提现就倒贴** | §3.4 偿付能力闸门：结算确认与提现申请两处强制校验 `L ≤ C × (1−buffer)`；收入录入强制"仅到账后录入"；打赏为净额零的内部转账，不新增 PIX |
| 收入录入不实（录了没到账） | 录入界面写死提示 + 后台水位常驻展示 + 提现时二次校验 |
| 刷分 = 偷钱 | 结算只认难刷指标 + 主体去重 + 月度配额 + 单人封顶 + 确认前人工审核 + 全链路可追溯（`actorId` / `refId`） |
| 打赏互刷 | 结构上无利可图：**净额为零、不产生贡献分、不影响榜单**；额外加频率限制与单笔上下限 |
| **PIX 的合规实质** | PIX **只改变展示，不改变可兑付的性质** —— 合规上仍等同余额。真红线是**不可购买、不可转让**（§0） |
| **提现的税务与资质** | 系统不代扣代缴；建议对累计提现较高的用户先要求身份信息。**合规结论请自行确认或咨询专业人士，系统不提供合规担保** |
| 下载量口径变化 | 切换后数字下降且与历史不可比（有意的口径修正），建议后台注明断点日期 |
| IP 去重被绕过 | 换 IP 可绕闸门一，靠月度配额压死收益上限 |
| **`x-forwarded-for` 可伪造** | 可信度取决于部署环境是否**覆盖**该头。Vercel 会覆盖，可信；若前面自建反代/CDN，必须确保是覆盖而非追加，否则闸门一可被绕过。上线前必须确认 |
| NAT 低估 | 同出口 IP 多用户只计一次，偏差方向是少算，接受 |
| 已公示金额被事后改 | 确认即冻结快照（`configSnapshot` + 明细 `score` / `amountFen` / `coin`），状态单向 |
| 金额浮点误差 | 全链路整数「分」+ 万分比 + 最大余数法 |
| 提现双扣 | 提交即冻结 + 状态机单向 + `CoinLedger` refId 幂等 |
| 阈值散落难改 | §6 全量可配清单 + §12 反硬编码验收项 |
| 计数器与分数漂移 | 口径"累计获得不回冲"；`PointLog` 是事实来源，`UserPoint.balance` 可重算对账 |
| 存量作者觉得不公 | `backfill-points.ts` 一次性回填（幂等可重跑） |
| 等级自动授权破坏风控 | **不做**自动免审；`User.trusted` 维持人工授予 |
| 模块超行数上限 | 独立 `points-config.ts` / `points.ts` / `settle.ts` / `coin.ts` / `tip.ts`，不塞进 762 行的 `site-config.ts` |
