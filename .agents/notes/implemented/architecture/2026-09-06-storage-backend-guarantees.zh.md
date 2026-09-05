# Agent Note: 存储后端保证与私有 SQLite 所有权

Status: implemented

[English](2026-09-06-storage-backend-guarantees.md) | 中文

## 问题

部分权威领域需要比通用 KV 约定更强的属性。后端名称或介质类型不能证明只有一个 Host 拥有介质、已 resolve 的提交采用显式同步级别，或数据库位于仅所有者可访问的目录。把这些属性当作假设，会让路由静默削弱使用它的领域。

SQLite provider 也只注册一个固定名称。组合若要同时挂载普通共享实例和严格实例，就只能增加另一个 provider，或改变所有已有消费方。

## 决策

`StorageBackend.guarantees` 声明一组封闭的配置属性：`single-writer`、`commit-sync` 与 `private-root`。`DomainSpec` 可以列出所需保证。`DomainFacility.open()` 在打开 KV 分面前比较要求与已路由后端，缺少声明时以 `backend-requirement-unsatisfied` 拒绝。

声明只是路由元数据，本身不是证明。后端只在配置选择相应落实方式时声明保证，而真实 `open()` 仍会在介质不满足该配置时失败。没有要求的领域和没有声明的后端继续遵循通用约定。

SQLite provider 接受 `backendName`，因此一个组合可以注册多个独立实例。相对路径继续默认基于进程 cwd；`pathBase: dsh-home` 会显式锚定到已解析的 Harness home。

## SQLite 落实方式

`ownership: exclusive` 只对采用 `delete` journal 的文件数据库有效。连接使用零 busy timeout，在 ready 前取得真实 `BEGIN EXCLUSIVE` 锁，并保持独占锁直到关闭。竞争所有者会失败；provider 不会等待、终止或抢占另一个进程。

`synchronous: full` 与 `synchronous: extra` 在 SQLite 返回所选值后声明 `commit-sync`。`applicationId` 仅适用于文件库，并会在 provider 创建存储表前拒绝外来、部分初始化和身份不匹配的数据库。连接安全设置、journal mode、应用身份、物理格式与基础 schema 都在 ready 前核对；schema 和单元物化使用事务。

`privateDirectory` 声明 `private-root`。在 Windows 上，provider 只接受本地 NTFS 路径，拒绝 reparse point 和硬链接别名，以受保护 DACL 逐层创建并复验缺失目录，并且只核对而不改写既有目录与文件 ACL。固定 PowerShell helper 使用共享的已清洗父进程环境，只额外接收两个显式路径输入。允许的身份是当前用户、SYSTEM 与本机 Administrators。在 POSIX 文件系统上，它要求目标仅供所有者访问，拒绝符号链接数据库和不安全的可写祖先。

## 考虑过的替代方案

**根据后端名称推断保证。** 拒绝，因为两个 SQLite 实例可以有意采用不同的锁、同步和目录策略。名称表示路由身份，不表示介质行为。

**允许领域打开任意后端，随后再检查。** 拒绝，因为语义消费方会依赖 provider 内部实现，而且不兼容介质可能在失败前已被触碰。

**使用 PID 或按年龄回收的锁文件。** 拒绝，因为旧所有者回收会重复操作系统所有权语义，并可能夺取仍在使用的数据库。拥有进程退出时，SQLite 已会释放连接锁。

**创建数据库后再应用 Windows 权限。** 拒绝，因为限制生效前内容可能已经存在，而且继承 ACL 可能仍比预期更宽。新私有目录在创建时获得 DACL；既有路径只做校验。

## 后果

敏感领域可以在路由丢失所需属性时失败关闭，而已有领域保持当前行为。命名 SQLite 实例避免建立第二套存储控制面，并让策略继续由组合拥有。

独占所有权会有意阻止直接并发读取，包括文件复制备份工具。备份与其他界面必须通过拥有 Host，或先关闭该 Host。

Windows ACL 隔离的是 Windows 主体，不是以同一用户运行的进程。Agent 能力发现与授权仍由单独策略负责；`private-root` 不声称可以隔离同用户进程、管理员或有故障的存储硬件。
