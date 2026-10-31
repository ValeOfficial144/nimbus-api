import type { FastifyInstance, FastifyPluginAsync } from "fastify";

export const signalRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  fastify.get(
    "/signal",
    { websocket: true },
    (socket, request) => {
      const { server } = (request.query as Record<string, string>);
      if (!server) {
        socket.close(1008, "missing server param");
        return;
      }

      fastify.log.info({ server }, "Opening ludiumlab signal WebSocket");

      const upstream = new WebSocket(`wss://${server}`, ["sorartc-1.0"]);

      upstream.onmessage = (e) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(e.data as string);
        }
      };

      upstream.onclose = (e) => {
        if (socket.readyState === socket.OPEN) socket.close(e.code, e.reason);
      };

      upstream.onerror = () => {
        fastify.log.error({ server }, "upstream ludiumlab WS error");
        if (socket.readyState === socket.OPEN) socket.close(1011, "upstream error");
      };

      socket.on("message", (data: Buffer | string) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data instanceof Buffer ? data.toString() : data);
        }
      });

      socket.on("close", () => {
        if (upstream.readyState === WebSocket.OPEN) upstream.close();
      });
    },
  );
};
