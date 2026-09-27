import {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import axios from "axios";
import type { AxiosInstance, AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { v4 as uuidv4 } from "uuid";

interface StreamSessionRequest {
  accessToken: string;
  gameId: string;
}

interface StreamStartResponse {
  streamId?: string;
  url?: string;
  status?: string;
  [key: string]: any;
}

class BlacknutStreamClient {
  private client: AxiosInstance;
  private logger: FastifyInstance["log"];
  private jar: CookieJar;

  constructor(logger: FastifyInstance["log"]) {
    this.logger = logger;
    this.jar = new CookieJar();

    const baseClient = axios.create({
      baseURL: "https://api.blacknut.com",
      timeout: 15000,
      withCredentials: true,
      maxRedirects: 5,
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "application/json",
        Origin: "https://app.blacknut.com",
        Pragma: "no-cache",
        Referer: "https://app.blacknut.com/",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
        "X-Blk-Brand": "blacknut",
        "X-Blk-User-Agent":
          "Blacknut/5.0.4 client-desk/5.18.3 (Linux;DESKTOP;;)",
        "X-Blk-Secure-Token":
          "1790469387h7MEjGO8eqEUe5psaiBy_EDGkonIqMAp5oQTv4xZKEU=",
        "sec-ch-ua":
          '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Linux"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
      },
    });

    this.client = wrapper(baseClient);
    (this.client.defaults as any).jar = this.jar;
  }

  public async startStream(
    accessToken: string,
    gameId: string,
  ): Promise<StreamStartResponse> {
    const timestamp = Date.now();
    const playerUUID = uuidv4();

    this.logger.info(
      { gameId, playerUUID },
      "Forking auth token for companion stream",
    );

    try {
      await this.client.post(
        `/api/v1/auth/fork?cb=${timestamp}`,
        {
          accessToken: accessToken,
          target: "companion_app",
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      this.logger.info(
        { gameId },
        "Initiating WebRTC game stream start sequence",
      );

      const startResponse: AxiosResponse<StreamStartResponse> =
        await this.client.post(
          `/api/v1/games/${gameId}/start?cb=${Date.now()}`,
          {
            client: {
              id: "blacknut",
              version: "5.18.3",
              os: "unknown",
              bearer: "unknown",
              protocol: "webrtc",
            },
            keyboardLayout: "qwerty",
            playerUUID: playerUUID,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

      let streamDetailsData = null;
      try {
        const streamDetails: AxiosResponse<StreamStartResponse> =
          await this.client.get(`/api/v1/streams?cb=${Date.now()}`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
        streamDetailsData = streamDetails.data;
      } catch (streamErr: any) {
        this.logger.warn(
          { err: streamErr.message },
          "Active streams query returned non-fatal notice",
        );
      }

      return {
        startResult: startResponse.data,
        activeStreams: streamDetailsData,
      };
    } catch (error: any) {
      this.logger.error(
        { err: error.message, response: error.response?.data },
        "Stream initialization sequence failed",
      );
      throw new Error(
        `Streaming failed: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`,
      );
    }
  }
}

const streamRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  const streamClient = new BlacknutStreamClient(fastify.log);

  fastify.post<{ Body: StreamSessionRequest }>(
    "/stream",
    {
      schema: {
        body: {
          type: "object",
          required: ["accessToken", "gameId"],
          properties: {
            accessToken: { type: "string" },
            gameId: { type: "string" },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: StreamSessionRequest }>,
      reply: FastifyReply,
    ) => {
      const { accessToken, gameId } = request.body;

      try {
        const result = await streamClient.startStream(accessToken, gameId);
        return reply.code(200).send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    },
  );
};

export { streamRoutes, BlacknutStreamClient };
