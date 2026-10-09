# 最小 Web 鉴权约定

- 同源 `/api/v1`；开发代理保留真实 Origin，Server 精确允许 `http://127.0.0.1:5173`。
- 首次登录只在请求头发送显式输入的 Bearer token；成功后清空输入。不写 URL、浏览器存储或构建变量。
- 后续使用 HttpOnly、SameSite=Strict cookie。生产 HTTPS 要求 Secure；本机 HTTP 例外由 Server 配置限定。
- 修改请求发送内存中的 `X-CSRF-Token`；退出同样校验 Origin 与 CSRF。
- `<audio>` 直接访问 Server 返回的同源地址，由 cookie 鉴权；不把整首音频下载成 Blob。
- 登录失效清理页面身份和媒体。错误只呈现中文业务说明与请求编号，不回显凭据或内部路径。

W0.2 完成：安全边界核对；实际 cookie/CSRF 检查在 W1.6 进行。
