import { ApiClient, ApiError, errorMessage } from '../api/client';
import { AuthApi } from '../api/auth';
import type { AuthSession } from '../api/types';
import type { Layout } from '../ui/layout';

export class Application {
  readonly client = new ApiClient();
  private auth = new AuthApi(this.client);
  private signedIn = false;
  onLogin: (() => Promise<void>) | null = null;
  onLogout: (() => void) | null = null;
  constructor(private ui: Layout) {
    this.client.onUnauthorized = () => this.clear();
    ui.retry.onclick = () => { void this.connect(); };
    ui.login.onsubmit = (event) => { event.preventDefault(); void this.login(); };
    ui.logout.onclick = () => { void this.logout(); };
  }
  private clear(): void {
    this.signedIn = false; this.client.csrfToken = null;
    this.ui.login.hidden = false; this.ui.logout.hidden = true;
    this.ui.library.hidden = true; this.ui.player.hidden = true; this.ui.identity.textContent = '';
    this.ui.status.textContent = '未登录，请输入管理员登录令牌。'; this.onLogout?.();
  }
  private async accept(session: AuthSession): Promise<void> {
    this.signedIn = true; this.ui.token.value = ''; this.ui.login.hidden = true;
    this.ui.logout.hidden = false; this.ui.library.hidden = false; this.ui.player.hidden = false;
    this.ui.identity.textContent = `已登录：${session.user.id} `; this.ui.status.textContent = '已连接';
    await this.onLogin?.();
  }
  async connect(): Promise<void> {
    this.ui.status.textContent = '正在连接…'; this.ui.retry.hidden = true;
    try {
      const ready = await this.auth.ready();
      if (!ready || ready.product !== 'MusicFS' || ready.apiVersion !== '1') {
        this.ui.status.textContent = '版本不兼容：需要 MusicFS API v1。'; this.ui.retry.hidden = false; return;
      }
      if (!ready.ready) { this.ui.status.textContent = 'Server 尚未就绪，请稍后重试。'; this.ui.retry.hidden = false; return; }
      try { await this.accept(await this.auth.restore()); }
      catch (error) { if (error instanceof ApiError && error.status === 401) this.clear(); else throw error; }
    } catch (error) { this.ui.status.textContent = errorMessage(error); this.ui.retry.hidden = false; }
  }
  private async login(): Promise<void> {
    this.ui.loginButton.disabled = true;
    try { await this.accept(await this.auth.login(this.ui.token.value)); }
    catch (error) { this.ui.status.textContent = errorMessage(error); }
    finally { this.ui.loginButton.disabled = false; }
  }
  private async logout(): Promise<void> {
    if (!this.signedIn) return;
    this.ui.logout.disabled = true;
    this.onLogout?.();
    try { await this.auth.logout(); this.clear(); }
    catch (error) { this.ui.status.textContent = errorMessage(error); }
    finally { this.ui.logout.disabled = false; }
  }
}
