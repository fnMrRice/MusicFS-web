interface MusicKitInstance {
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
}
interface MusicKitAPI {
  configure(options: { developerToken: string; app: { name: string; build: string } }): Promise<MusicKitInstance>;
}
declare global { interface Window { MusicKit?: MusicKitAPI } }
let loading: Promise<MusicKitAPI> | undefined;
export function loadMusicKit(): Promise<MusicKitAPI> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  if (!loading) loading = new Promise<MusicKitAPI>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => finish(new Error("Apple Music 授权组件加载超时")), 15000);
    function finish(error?: Error) {
      window.clearTimeout(timer);
      document.removeEventListener("musickitloaded", ready);
      if (error) { script.remove(); loading = undefined; reject(error); }
      else if (window.MusicKit) resolve(window.MusicKit);
      else { loading = undefined; reject(new Error("Apple Music 授权组件不可用")); }
    }
    function ready() { finish(); }
    document.addEventListener("musickitloaded", ready, { once: true });
    script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
    script.async = true;
    script.onerror = () => finish(new Error("无法加载 Apple Music 授权组件"));
    document.head.append(script);
  });
  return loading;
}
export type { MusicKitInstance };
