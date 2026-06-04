import systrayModule from 'systray2';
import type { MenuItem, Menu, ClickEvent } from 'systray2';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// systray2 ESM default 导出嵌套了两层，需要取出真正的构造函数
const SysTray = (systrayModule as any).default ?? systrayModule;

// separator 从构造函数上取
const separator: MenuItem = (SysTray as any).separator ?? { title: '', tooltip: '', enabled: false };

// ─── 常量 ────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ICON_PNG = resolve(PROJECT_ROOT, 'assets', 'icon.png');
const ICON_ICO = resolve(PROJECT_ROOT, 'assets', 'icon.ico');

// ─── 类型 ────────────────────────────────────────────────

export interface TrayCallbacks {
  /** 查看提醒 */
  onViewReminders: () => void;
  /** 暂停/恢复切换 */
  onTogglePause: () => boolean; // 返回当前暂停状态
  /** 退出 */
  onExit: () => void;
}

// ─── TrayService ─────────────────────────────────────────

/**
 * 系统托盘服务
 *
 * 使用 systray2 在 Windows 系统托盘显示图标和右键菜单。
 * 菜单选项：查看提醒 | 暂停/恢复 | 退出
 */
export class TrayService {
  private tray: InstanceType<typeof SysTray> | null = null;
  private paused = false;
  private callbacks: TrayCallbacks;

  constructor(callbacks: TrayCallbacks) {
    this.callbacks = callbacks;
  }

  /** 启动托盘 */
  async start(): Promise<void> {
    const icon = this.resolveIcon();
    const menu: Menu = {
      icon,
      title: '提醒助手',
      tooltip: '提醒助手 - 运行中',
      items: [
        { title: '查看提醒', tooltip: '查看所有提醒', enabled: true },
        { title: '暂停提醒', tooltip: '暂停提醒服务', enabled: true },
        separator,
        { title: '退出', tooltip: '完全关闭程序', enabled: true },
      ],
    };

    this.tray = new SysTray({ menu, debug: false });

    this.tray.onReady(() => {
      console.log('[TrayService] 系统托盘已启动');
    });

    this.tray.onError((err: Error) => {
      console.error('[TrayService] 托盘错误:', err.message);
    });

    this.tray.onExit((code: number | null, signal: string | null) => {
      console.log(`[TrayService] 托盘进程退出 (code=${code}, signal=${signal})`);
    });

    await this.tray.ready();

    // 处理菜单点击
    await this.tray.onClick((action: any) => {
      this.handleClick(action);
    });
  }

  /** 处理菜单项点击 */
  private handleClick(action: { item: MenuItem }): void {
    const title = action.item.title;

    switch (title) {
      case '查看提醒':
        this.callbacks.onViewReminders();
        break;

      case '暂停提醒':
      case '恢复提醒':
        this.paused = this.callbacks.onTogglePause();
        this.updateMenu();
        break;

      case '退出':
        this.callbacks.onExit();
        break;
    }
  }

  /** 更新菜单（暂停/恢复文字切换） */
  private updateMenu(): void {
    if (!this.tray) return;

    const icon = this.resolveIcon();
    this.tray.sendAction({
      type: 'update-menu',
      menu: {
        icon,
        title: '提醒助手',
        tooltip: this.paused ? '提醒助手 - 已暂停' : '提醒助手 - 运行中',
        items: [
          { title: '查看提醒', tooltip: '查看所有提醒', enabled: true },
          { title: this.paused ? '恢复提醒' : '暂停提醒', tooltip: this.paused ? '恢复提醒服务' : '暂停提醒服务', enabled: true },
          separator,
          { title: '退出', tooltip: '完全关闭程序', enabled: true },
        ],
      },
    });
  }

  /** 更新托盘提示文字（活跃提醒数） */
  updateTooltip(activeCount: number): void {
    if (!this.tray) return;

    const icon = this.resolveIcon();
    const statusText = this.paused ? '已暂停' : '运行中';
    this.tray.sendAction({
      type: 'update-menu',
      menu: {
        icon,
        title: '提醒助手',
        tooltip: `提醒助手 - ${activeCount} 个活跃提醒 (${statusText})`,
        items: [
          { title: '查看提醒', tooltip: '查看所有提醒', enabled: true },
          { title: this.paused ? '恢复提醒' : '暂停提醒', tooltip: this.paused ? '恢复提醒服务' : '暂停提醒服务', enabled: true },
          separator,
          { title: '退出', tooltip: '完全关闭程序', enabled: true },
        ],
      },
    });
  }

  /** 停止托盘 */
  async stop(): Promise<void> {
    if (this.tray) {
      await this.tray.kill(false);
      this.tray = null;
    }
  }

  /** 解析图标路径，优先 ICO 格式（Windows 原生），回退 PNG */
  private resolveIcon(): string {
    if (existsSync(ICON_ICO)) return ICON_ICO;
    if (existsSync(ICON_PNG)) return ICON_PNG;
    // 尝试 dist 相对路径
    const distIco = resolve(__dirname, '..', '..', '..', 'assets', 'icon.ico');
    if (existsSync(distIco)) return distIco;
    const distPng = resolve(__dirname, '..', '..', '..', 'assets', 'icon.png');
    if (existsSync(distPng)) return distPng;
    return '';
  }
}
