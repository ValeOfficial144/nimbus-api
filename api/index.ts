import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import path from "path";
import { fileURLToPath } from "url";
import accountRoutes from "./accounts.js";
import catalogRoutes from "./catalog.js";
import { streamRoutes } from "./stream.js";
import { signalRoutes } from "./signal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
      },
    },
  });

  await app.register(fastifyWebsocket);

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "../public"),
    prefix: "/",
    index: "embed.html",
  });

  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  await app.register(accountRoutes, { prefix: "/api" });
  await app.register(catalogRoutes, { prefix: "/api" });
  await app.register(streamRoutes, { prefix: "/api" });
  await app.register(signalRoutes, { prefix: "/api" });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const server = await buildServer();
      const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
      const host = process.env.HOST || "0.0.0.0";

      await server.listen({ port, host });
      server.log.info(`Service architecture online at http://${host}:${port}`);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}

export { buildServer };
