import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import axios from "axios";
import type { AxiosInstance, AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { v4 as uuidv4 } from "uuid";

interface BlacknutTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface BlacknutAccountResponse {
  userToken: BlacknutTokenPair;
  familyToken: BlacknutTokenPair;
}

class BlacknutClient {
  private client: AxiosInstance;
  private jar: CookieJar;

  constructor(private readonly logger: FastifyInstance["log"]) {
    this.jar = new CookieJar();

    const base = axios.create({
      baseURL: "https://crm-mgr.blacknut.com",
      timeout: 15_000,
      withCredentials: true,
      maxRedirects: 5,
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
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
          "17904599167YFxukrG03aXiawhhX-Sh4GLOa3qLtd4Xs9usC067yo=",
        "sec-ch-ua":
          '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Linux"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
      },
    });

    this.client = wrapper(base);
    (this.client.defaults as any).jar = this.jar;
  }

  private async warmSession(): Promise<void> {
    try {
      await this.client.get(`/api/v1/public/config?cb=${Date.now()}`);
    } catch (err: any) {
      this.logger.warn(
        { err: err.message },
        "Session warm-up warning (non-fatal)",
      );
    }
  }

  async register(): Promise<{
    nickname: string;
    sessionID: string;
    tokens: BlacknutAccountResponse;
  }> {
    await this.warmSession();

    const sessionID = uuidv4();
    const nickname = `Player_${Math.floor(1000 + Math.random() * 9000)}`;

    this.logger.info({ sessionID, nickname }, "Creating Blacknut account");

    try {
      const res: AxiosResponse<BlacknutAccountResponse> =
        await this.client.post(
          `/api/v1/public/store/blacknut/account?cb=${Date.now()}`,
          { sessionID, nickname },
        );

      return { nickname, sessionID, tokens: res.data };
    } catch (err: any) {
      const detail = err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;
      this.logger.error(
        { err: err.message, response: err.response?.data },
        "Blacknut registration failed",
      );
      throw new Error(`Blacknut registration failed: ${detail}`);
    }
  }
}

const accountRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  fastify.post(
    "/accounts",
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const blacknut = new BlacknutClient(fastify.log);
      const account = await blacknut.register();

      return reply.code(201).send({
        success: true,
        data: account,
      });
    },
  );
};

export default accountRoutes;