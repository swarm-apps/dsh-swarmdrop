/**
 * The panel's dictionaries.
 *
 * `zh` is the source: this plugin's users write Chinese, and translating out of
 * the language the copy was thought in loses less than translating into it.
 * `en` is pinned to the same key set by `satisfies`, so a key added to one and
 * forgotten in the other is a compile error rather than a blank label.
 *
 * ## Vocabulary rules the wording follows
 *
 * - **"unknown" is never rendered as "offline".** The CLI is emphatic that a
 *   null online state means nobody has probed, and the copy has to preserve
 *   that or the user goes to debug a network that is fine.
 * - **Nothing here is a sentence about what to do next.** The panel is a status
 *   surface; instructions belong to the CLI's own error text, which the panel
 *   shows verbatim when something fails.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'swarmdrop'

/** Simplified Chinese panel copy (source). */
export const zh = {
  name: 'SwarmDrop',

  node: '节点',
  nodeRunning: '运行中',
  nodeStopped: '已停止',
  nodeUnknown: '读取中…',
  start: '启动',
  stop: '停止',

  network: '网络',
  nat: 'NAT',
  relay: '中继',
  relayReady: '已就绪',
  relayWaiting: '未就绪',
  bootstrap: '引导节点',
  bootstrapConnected: '已连接',
  bootstrapWaiting: '未连接',
  peers: '已连接节点',
  listen: '监听地址',
  listenCount: '{count} 个',

  devices: '已配对设备',
  noDevices: '还没有配对任何设备',
  forget: '解除',
  forgetConfirm: '确认解除',

  pairing: '配对',
  addDevice: '添加设备',
  waitingForDevice: '等待设备扫码…',
  pairingHint: '在手机上打开这个链接，页面会显示二维码；用手机上的 SwarmDrop 扫它。',
  copyLink: '复制链接',
  copied: '已复制',
  copyFailed: '复制失败',
  openLink: '打开',
  cancel: '取消',
  pairingRequestTitle: '收到配对请求',
  device: '设备',
  unnamedDevice: '（未命名）',
  system: '系统',
  link: '链路',
  linkLan: '局域网',
  linkRelay: '中继',
  linkDirect: '直连',
  linkUnknown: '未知',
  verifyHint: '请对方念一遍节点标识的开头几位——设备名是对方自己填的，标识不是。',
  accept: '接受',
  decline: '拒绝',
  pairedWith: '已与「{device}」配对',
  done: '完成',

  inbox: '收件箱',
  inboxCount: '{count} 项',
  inboxMore: '更多在设置 → SwarmDrop 里',

  inFlight: '正在传输',
  transferSending: '发往',
  transferReceiving: '来自',
  // 速率与剩余时间说不出来时的占位符。**不写「0 B/s」**：核心把速率归零表达的是
  // 「一个窗口内没有新字节」（对端在确认、接收方正在保存收齐的文件），说成 0 是在
  // 报告一个没发生的停滞。
  transferUnknownRate: '—',
  transferEta: '剩余 {eta}',
  transferPhaseOffered: '等待对方确认',
  transferPhaseWaitingAccept: '等待对方确认',
  transferPhaseSuspended: '已暂停',

  stale: '与 SwarmDrop 的订阅断了，正在重连；下面的信息可能是旧的。',

  // ── 设置页 ──
  //
  // 与面板同一份字典：两处说的是同一个子系统，同一件事在两个界面里长出两种叫法，
  // 用户会以为它们是两回事。
  navOverview: '概览',
  navInvites: '邀请',
  navInbox: '收件箱',
  navTransfers: '传输记录',
  navSettings: '设置',
  navBootstrap: '引导节点',
  navAbout: '关于',

  refresh: '刷新',
  loading: '读取中…',
  notLoaded: '还没有读取',
  dismiss: '知道了',
  edit: '修改',
  save: '保存',
  clear: '清除',
  remove: '移除',
  copyNodeId: '复制节点标识',
  copyAddress: '复制地址',
  copyPath: '复制路径',
  noListenAddrs: '（无）',

  invites: '已发出的邀请',
  invitesHint: '邀请有效 24 小时、跨重启存活，且谁拿到谁就能配对。泄露了就在这里撤销。',
  noInvites: '当前没有未过期的邀请',
  revoke: '撤销',
  revokeAll: '全部撤销',
  inviteConsumed: '已被使用',
  inviteExpiresIn: '{minutes} 分钟后过期',

  inboxEmpty: '收件箱是空的',
  inboxFrom: '来自 {device}',
  inboxMissing: '文件已不在磁盘上，导不出来。',
  export: '导出',
  exportTo: '导出到',

  transfers: '传输记录',
  noTransfers: '还没有传输记录',
  directionSend: '发送',
  directionReceive: '接收',
  pause: '暂停',
  resume: '恢复',
  cancelTransfer: '取消',

  settings: '本机设置',
  settingDeviceName: '设备名',
  settingReceiveDir: '接收落点',
  inEffect: '当前生效',
  valueUnset: '（未设置）',
  sourceEnv: '来自环境变量',
  sourceConfig: '你设置的',
  sourceDefault: '默认值',
  overriddenBy: '此刻被环境变量 {variable} 压着，改这里要等它取消后才生效。',

  bootstrapNodes: '引导 / 中继节点',
  bootstrapHint: '跨网互通的入口。内置那几条随版本更新；你的增删是叠加在它之上的。',
  bootstrapEmpty: '清单是空的——本机只能在局域网内发现设备，跨网不可达。',
  addBootstrap: '添加',
  originBuiltin: '内置',
  originCustom: '自定义',
  relayConnecting: '中继连接中',
  relayFailed: '中继连不上',

  about: '关于',
  pluginVersion: '插件版本',
  cliVersion: 'swarmdrop 版本',
  cliMissing: '没找到（未安装或不在 PATH 上）',
  checkUpdate: '检查更新',
  updateAvailable: '有新版本 {version}，停下节点后运行 swarmdrop update 安装它。',
  updateUpToDate: '已是最新版本。',
  updateUnknown: '这份 swarmdrop 由别的方式安装（Homebrew / npm），请用那边更新。',
} satisfies Record<string, string>

/** The panel's key set. */
export type SwarmDropKey = keyof typeof zh

/** English panel copy. */
export const en = {
  name: 'SwarmDrop',

  node: 'Node',
  nodeRunning: 'Running',
  nodeStopped: 'Stopped',
  nodeUnknown: 'Checking…',
  start: 'Start',
  stop: 'Stop',

  network: 'Network',
  nat: 'NAT',
  relay: 'Relay',
  relayReady: 'Ready',
  relayWaiting: 'Not ready',
  bootstrap: 'Bootstrap',
  bootstrapConnected: 'Connected',
  bootstrapWaiting: 'Not connected',
  peers: 'Connected peers',
  listen: 'Listen addresses',
  listenCount: '{count}',

  devices: 'Paired devices',
  noDevices: 'No devices paired yet',
  forget: 'Unpair',
  forgetConfirm: 'Confirm',

  pairing: 'Pairing',
  addDevice: 'Add a device',
  waitingForDevice: 'Waiting for a device…',
  pairingHint: 'Open this link on the phone — the page shows a QR code for SwarmDrop to scan.',
  copyLink: 'Copy link',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  openLink: 'Open',
  cancel: 'Cancel',
  pairingRequestTitle: 'Pairing request',
  device: 'Device',
  unnamedDevice: '(unnamed)',
  system: 'System',
  link: 'Link',
  linkLan: 'Local network',
  linkRelay: 'Relay',
  linkDirect: 'Direct',
  linkUnknown: 'Unknown',
  verifyHint: 'Have them read back the first characters of the node id — the display name is self-reported, the id is not.',
  accept: 'Accept',
  decline: 'Decline',
  pairedWith: 'Paired with {device}',
  done: 'Done',

  inbox: 'Inbox',
  inboxCount: '{count}',
  inboxMore: 'More in Settings → SwarmDrop',

  inFlight: 'In flight',
  transferSending: 'To',
  transferReceiving: 'From',
  transferUnknownRate: '—',
  transferEta: '{eta} left',
  transferPhaseOffered: 'Waiting for the other end',
  transferPhaseWaitingAccept: 'Waiting for the other end',
  transferPhaseSuspended: 'Paused',

  stale: 'Lost the SwarmDrop subscription and is reconnecting; what follows may be out of date.',

  navOverview: 'Overview',
  navInvites: 'Invites',
  navInbox: 'Inbox',
  navTransfers: 'Transfers',
  navSettings: 'Settings',
  navBootstrap: 'Bootstrap',
  navAbout: 'About',

  refresh: 'Refresh',
  loading: 'Loading…',
  notLoaded: 'Not loaded yet',
  dismiss: 'Dismiss',
  edit: 'Edit',
  save: 'Save',
  clear: 'Clear',
  remove: 'Remove',
  copyNodeId: 'Copy node id',
  copyAddress: 'Copy address',
  copyPath: 'Copy path',
  noListenAddrs: 'None',

  invites: 'Issued invites',
  invitesHint: 'An invite is valid for 24 hours, survives restarts, and whoever holds it can pair. Revoke one here if it leaked.',
  noInvites: 'No unexpired invites',
  revoke: 'Revoke',
  revokeAll: 'Revoke all',
  inviteConsumed: 'Already used',
  inviteExpiresIn: 'Expires in {minutes} min',

  inboxEmpty: 'The inbox is empty',
  inboxFrom: 'From {device}',
  inboxMissing: 'The files are gone from disk; this cannot be exported.',
  export: 'Export',
  exportTo: 'Export to',

  transfers: 'Transfers',
  noTransfers: 'No transfers yet',
  directionSend: 'Sent',
  directionReceive: 'Received',
  pause: 'Pause',
  resume: 'Resume',
  cancelTransfer: 'Cancel',

  settings: 'This machine',
  settingDeviceName: 'Device name',
  settingReceiveDir: 'Receive directory',
  inEffect: 'In effect',
  valueUnset: 'Not set',
  sourceEnv: 'From an environment variable',
  sourceConfig: 'Set by you',
  sourceDefault: 'Default',
  overriddenBy: 'Held down by {variable} right now — editing this takes effect once that is unset.',

  bootstrapNodes: 'Bootstrap / relay nodes',
  bootstrapHint: 'How this machine reaches the outside. The built-in ones follow the release; your changes layer on top of them.',
  bootstrapEmpty: 'The list is empty — this machine can only find devices on the local network.',
  addBootstrap: 'Add',
  originBuiltin: 'Built-in',
  originCustom: 'Custom',
  relayConnecting: 'Relay connecting',
  relayFailed: 'Relay unreachable',

  about: 'About',
  pluginVersion: 'Plugin version',
  cliVersion: 'swarmdrop version',
  cliMissing: 'Not found (not installed, or not on PATH)',
  checkUpdate: 'Check for updates',
  updateAvailable: 'Version {version} is available — stop the node, then run `swarmdrop update`.',
  updateUpToDate: 'Already up to date.',
  updateUnknown: 'This swarmdrop was installed another way (Homebrew / npm); update it there.',
} satisfies Record<SwarmDropKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The SwarmDrop panel's copy. */
    swarmdrop: SwarmDropKey
  }
}
