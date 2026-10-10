export default {
  "插件状态": ["Plugin status", "外掛程式狀態", "プラグインの状態"],
  "待配置": ["Needs configuration", "待設定", "設定が必要"],
  "已禁用": ["Disabled", "已停用", "無効"],
  "正在启动": ["Starting", "正在啟動", "起動中"],
  "正在停止": ["Stopping", "正在停止", "停止中"],
  "启动或运行失败": ["Startup or runtime failure", "啟動或執行失敗", "起動または実行に失敗"],
  "随包插件在配置齐全且未禁用时自动启动。待配置的插件不会阻止服务运行。": [
    "Bundled plugins start automatically when configured and enabled. Plugins awaiting configuration do not prevent the server from running.",
    "隨附外掛程式在設定完整且未停用時自動啟動。待設定的外掛程式不會阻止服務執行。",
    "同梱プラグインは設定済みで無効化されていなければ自動起動します。未設定のプラグインがあってもサービスは動作します。",
  ],
  "请在服务端配置可访问的音乐目录。": ["Configure an accessible music folder on the server.", "請在伺服器設定可存取的音樂目錄。", "サーバーでアクセス可能な音楽フォルダーを設定してください。"],
  "请在服务端配置可用的 FFmpeg 和 ffprobe 路径。": ["Configure valid FFmpeg and ffprobe paths on the server.", "請在伺服器設定可用的 FFmpeg 和 ffprobe 路徑。", "サーバーで有効な FFmpeg と ffprobe のパスを設定してください。"],
  "未发现已安装插件。": ["No installed plugins found.", "未找到已安裝的外掛程式。", "インストール済みプラグインが見つかりません。"],
  "刷新插件状态": ["Refresh plugin status", "重新整理外掛程式狀態", "プラグインの状態を更新"],
} satisfies Record<string, readonly [string, string, string]>;
