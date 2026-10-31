import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import axios from "axios";
import type { AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";

interface StreamRequest {
  token: string;
  userId: string;
  profileId: string;
  gameId: string;
  gameName?: string;
  lang?: string;
}

interface ExecData {
  exec_ip: string;
  exec_token: string;
  entry_id: string;
  lang_code: string;
  region_code: string;
}

interface SoraExecResponse {
  status: string;
  data: ExecData;
}

interface QueueUpdate {
  position: number | string;
  retryIn: number;
}

class SorastreamStreamClient {
  private client: AxiosInstance;

  constructor(private readonly logger: FastifyInstance["log"]) {
    const jar = new CookieJar();
    const base = axios.create({
      baseURL: "https://www.sorastream.com",
      timeout: 15_000,
      withCredentials: true,
      headers: {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        Origin: "https://www.sorastream.com",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "sec-gpc": "1",
      },
    });
    this.client = wrapper(base);
    (this.client.defaults as any).jar = jar;
  }

  async startSession(
    token: string,
    userId: string,
    profileId: string,
    gameId: string,
    gameName = "",
    lang = "en-US",
    onQueue?: (update: QueueUpdate) => void,
  ): Promise<{ server: string; execToken: string }> {
    this.logger.info({ profileId, gameId }, "Starting Sorastream game session");

    const execBody = {
      data: {
        client_id: "WebBrowser",
        region_code: "US",
        lang_code: lang,
        entry_id: gameId,
      },
    };
    const execHeaders = {
      Cookie: `token=${token}; userId=${userId}; profileId=${profileId}`,
      Referer: `https://www.sorastream.com/en-US/games/${gameId}`,
    };

    const deadline = Date.now() + 10 * 60 * 1000;

    while (Date.now() < deadline) {
      try {
        const res = await this.client.post<SoraExecResponse>(
          `/api/profiles/${profileId}/execs`,
          execBody,
          { headers: execHeaders },
        );

        if (res.data.status !== "OK") {
          throw new Error(`Sorastream exec failed: ${JSON.stringify(res.data)}`);
        }

        const { exec_ip: server, exec_token: execToken } = res.data.data;
        return { server, execToken };
      } catch (err: any) {
        const errData = err.response?.data;
        const errors: any[] = errData?.error?.errors ?? [];
        const queued = errors.find((e: any) => e.string === "IrisErrnoUserHasBeenEnqueued");

        if (queued) {
          const retryIn: number = errData?.error?.data?.retry_in ?? 5;
          const position: number | string = errData?.error?.data?.position ?? "?";
          this.logger.info({ position, retryIn }, "Queued for game server, retrying…");
          onQueue?.({ position, retryIn });
          await new Promise((r) => setTimeout(r, retryIn * 1000));
          continue;
        }

        throw err;
      }
    }

    throw new Error("Game server queue timed out after 10 minutes");
  }
}

export const streamRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  const streamClient = new SorastreamStreamClient(fastify.log);

  fastify.post<{ Body: StreamRequest }>(
    "/stream",
    {
      schema: {
        body: {
          type: "object",
          required: ["token", "userId", "profileId", "gameId"],
          properties: {
            token: { type: "string" },
            userId: { type: "string" },
            profileId: { type: "string" },
            gameId: { type: "string" },
            gameName: { type: "string" },
            lang: { type: "string" },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: StreamRequest }>,
      reply: FastifyReply,
    ) => {
      const { token, userId, profileId, gameId, gameName, lang } = request.body;
      const acceptSSE = request.headers.accept === "text/event-stream";

      if (acceptSSE) {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const sendEvent = (event: string, data: unknown) => {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
          const result = await streamClient.startSession(
            token, userId, profileId, gameId, gameName, lang,
            (update) => sendEvent("queue", update),
          );
          sendEvent("ready", result);
        } catch (error: any) {
          sendEvent("error", { error: error.message });
        }
        reply.raw.end();
        return;
      }

      try {
        const result = await streamClient.startSession(
          token, userId, profileId, gameId, gameName, lang,
        );
        return reply.code(200).send({ success: true, data: result });
      } catch (error: any) {
        const detail = error.response?.data ?? error.message;
        fastify.log.error({ detail }, "stream session failed");
        return reply.code(500).send({ success: false, error: error.message, detail });
      }
    },
  );
};
