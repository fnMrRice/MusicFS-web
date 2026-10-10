import { createServer, request, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** Forwards real Server responses and permits an exact SSE connection cut. */
export async function eventProxy(target: string) {
  const streams = new Set<ServerResponse>();
  const proxy = createServer((incoming, outgoing) => {
    const upstream = request(new URL(incoming.url ?? "/", target), {
      method: incoming.method, headers: incoming.headers,
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      if (incoming.url === "/api/v1/events") streams.add(outgoing);
      response.pipe(outgoing);
    });
    upstream.on("error", () => outgoing.destroy());
    outgoing.on("close", () => { streams.delete(outgoing); upstream.destroy(); });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    interrupt: () => {
      const count = streams.size;
      streams.forEach(stream => stream.end());
      return count;
    },
    stop: () => new Promise<void>((resolve) => {
      proxy.closeAllConnections();
      proxy.close(() => resolve());
    }),
  };
}
