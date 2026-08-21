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
} satisfies Record<SwarmDropKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The SwarmDrop panel's copy. */
    swarmdrop: SwarmDropKey
  }
}
