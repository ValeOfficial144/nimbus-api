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
import { createMailbox, getDomains } from "./mail/useOther.js";

interface SoraResponse {
  status: string;
  data: {
    profile: { id: string; name: string };
    user: { id: string; email: string };
  };
}

function randomPassword(length = 14): string {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const special = "!@#$%^&*";
  const all = lower + upper + digits + special;
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const pick = (set: string) =>
    set[crypto.getRandomValues(new Uint8Array(1))[0]! % set.length]!;
  const required = [pick(lower), pick(upper), pick(digits), pick(special)];
  const rest = Array.from(bytes.slice(4), (b) => all[b % all.length]!);
  return [...required, ...rest].sort(() => Math.random() - 0.5).join("");
}

function extractCode(text: string): string | null {
  // Match any 4-8 digit standalone code
  const m = text.match(/\b(\d{4,8})\b/);
  return m?.[1] ?? null;
}

class SorastreamClient {
  private client: AxiosInstance;

  constructor(private readonly logger: FastifyInstance["log"]) {
    const jar = new CookieJar();
    const base = axios.create({
      baseURL: "https://www.sorastream.com",
      timeout: 20_000,
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

  async register(): Promise<{
    email: string;
    password: string;
    token: string;
    userId: string;
    profileId: string;
  }> {
    const domains = await getDomains();
    const preferred = domains.find((d) => d.domain === "temp.tf") ?? domains[0];
    if (!preferred) throw new Error("No active mail.tm domains available");
    const mailbox = await createMailbox({ domain: preferred.domain });
    const email = mailbox.address;
    const password = randomPassword();

    this.logger.info({ email }, "Creating Sorastream account");

    const signupRes = await this.client.post<SoraResponse>(
      "/api/signup",
      {
        data: {
          user: {
            username: email,
            password,
            ctry_code: "",
            preferred_lang: "en-US",
            accepted_terms: 1,
            accepted_news: 0,
          },
          profile: {
            name: "User",
            role: "super",
            birthday: "1970-01-01T00:00:00Z",
            avatar: { avatar_id: "" },
          },
        },
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`,
          Referer: "https://www.sorastream.com/en-US/sign-up",
        },
      },
    );

    if (signupRes.data.status !== "OK") {
      throw new Error(`Sorastream signup failed: ${JSON.stringify(signupRes.data)}`);
    }

    const { user, profile } = signupRes.data.data;

    const setCookie = signupRes.headers["set-cookie"];
    const rawToken = Array.isArray(setCookie)
      ? setCookie.find((c) => c.startsWith("token="))
      : setCookie?.startsWith("token=") ? setCookie : undefined;
    const token = rawToken?.split(";")[0]?.replace("token=", "") ?? "";
    this.logger.info({ tokenLength: token.length }, "Extracted signup token");

    const authCookie = `token=${token}; userId=${user.id}; profileId=${profile.id}`;

    // Wait for verification email and confirm
    this.logger.info({ email }, "Waiting for verification email");
    const msg = await mailbox.waitForMessage({ timeout: 60_000, interval: 2_000 });

    this.logger.info({ from: msg.from.address, subject: msg.subject }, "Got verification email");
    const body = msg.text || msg.html?.join("") || msg.intro || "";
    const code = extractCode(body) ?? extractCode(msg.subject);
    if (!code) throw new Error(`Could not extract verification code from email: ${msg.subject}`);

    this.logger.info({ code }, "Verifying email with code");
    await this.client.get(`/api/self/login-methods/email/verify-code`, {
      params: { token: code },
      headers: { Cookie: authCookie },
    });

    // Activate free trial
    await this.client.post(
      "/api/self/purchases/free-trial",
      null,
      {
        headers: {
          Cookie: authCookie,
          Referer: "https://www.sorastream.com/en-US/billing/choose-plan",
        },
      },
    );

    return { email, password, token, userId: user.id, profileId: profile.id };
  }
}

const accountRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  fastify.post(
    "/accounts",
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const sora = new SorastreamClient(fastify.log);
      try {
        const account = await sora.register();
        return reply.code(201).send({ success: true, data: account });
      } catch (error: any) {
        const detail = error.response?.data ?? error.message;
        fastify.log.error({ detail }, "account registration failed");
        return reply.code(500).send({ success: false, error: error.message, detail });
      }
    },
  );
};

export default accountRoutes;
