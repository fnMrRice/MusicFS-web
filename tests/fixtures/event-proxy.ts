import { createServer, request } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { Duplex } from "node:stream";

/** 转发真实服务响应，并允许精确中断控制 WebSocket。 */
export async function eventProxy(target: string) {
  const streams = new Set<Duplex>();
  const connections = new Set<Socket>();
  const proxy = createServer((incoming, outgoing) => {
    const upstream = request(new URL(incoming.url ?? "/", target), {
      method: incoming.method, headers: incoming.headers,
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => outgoing.destroy());
    outgoing.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });
  proxy.on("connection", (socket) => {
    connections.add(socket); socket.on("close", () => connections.delete(socket));
  });
  proxy.on("upgrade", (incoming, socket, head) => {
    const upstream = request(new URL(incoming.url ?? "/", target), { headers: incoming.headers });
    upstream.on("upgrade", (response, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${Object.entries(response.headers)
        .map(([name, value]) => `${name}: ${value}`).join("\r\n")}\r\n\r\n`);
      if (head.length) remote.write(head);
      if (remoteHead.length) socket.write(remoteHead);
      streams.add(socket);
      socket.on("close", () => { streams.delete(socket); remote.destroy(); });
      remote.on("close", () => socket.destroy());
      remote.on("error", () => socket.destroy());
      socket.on("error", () => remote.destroy());
      socket.pipe(remote).pipe(socket);
    });
    upstream.on("response", () => socket.destroy());
    upstream.on("error", () => socket.destroy());
    upstream.end();
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    interrupt: () => { const count = streams.size; streams.forEach(stream => stream.destroy()); return count; },
    stop: () => new Promise<void>((resolve) => {
      proxy.close(() => resolve());
      streams.forEach(stream => stream.destroy());
      connections.forEach(socket => socket.destroy());
      proxy.closeAllConnections();
    }),
  };
}
