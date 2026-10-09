export interface Layout {
  status: HTMLParagraphElement; retry: HTMLButtonElement; login: HTMLFormElement;
  token: HTMLInputElement; loginButton: HTMLButtonElement; logout: HTMLButtonElement;
  library: HTMLElement; player: HTMLElement; identity: HTMLElement;
}

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}

export function createLayout(root: HTMLElement): Layout {
  const title = element('h1', 'MusicFS');
  const intro = element('p', '浏览 Server 音乐目录，选择一首歌开始播放。');
  const status = element('p', '正在连接…'); status.setAttribute('role', 'status');
  const retry = element('button', '重新连接'); retry.type = 'button'; retry.hidden = true;
  const identity = element('span');
  const logout = element('button', '退出登录'); logout.type = 'button'; logout.hidden = true;
  const login = element('form'); login.hidden = true;
  const label = element('label', '管理员登录令牌'); label.htmlFor = 'owner-token';
  const token = element('input'); token.id = 'owner-token'; token.type = 'password';
  token.autocomplete = 'off'; token.required = true; token.spellcheck = false;
  const loginButton = element('button', '登录'); loginButton.type = 'submit';
  login.append(label, token, loginButton);
  const library = element('section'); library.setAttribute('aria-label', '音乐文件'); library.hidden = true;
  const player = element('section'); player.setAttribute('aria-label', '播放器'); player.hidden = true;
  root.replaceChildren(title, intro, status, retry, identity, logout, login, library, player);
  return { status, retry, login, token, loginButton, logout, library, player, identity };
}
