import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import axios from "axios";
import type { AxiosInstance } from "axios";

const soraClient: AxiosInstance = axios.create({
  baseURL: "https://www.sorastream.com",
  timeout: 15_000,
  headers: {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  },
});

const catalogRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
): Promise<void> => {
  fastify.get(
    "/catalog/games",
    async (
      request: FastifyRequest<{
        Querystring: { locale?: string; page?: string; size?: string; genre?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { locale = "en-US", page = "0", size = "24", genre } = request.query;
      const params: Record<string, string> = { locale, page, size };
      if (genre) params.genre = genre;

      const res = await soraClient.get("/api/games", { params });
      return reply.code(200).send(res.data);
    },
  );

  fastify.get(
    "/catalog/genres",
    async (
      request: FastifyRequest<{ Querystring: { lang?: string } }>,
      reply: FastifyReply,
    ) => {
      const { lang = "en-US" } = request.query;
      const res = await soraClient.get("/api/genres", { params: { lang } });
      return reply.code(200).send(res.data);
    },
  );

  fastify.get(
    "/catalog/games/:id",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { lang?: string; profileId?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const { lang = "en-US", profileId } = request.query;
      const params: Record<string, string> = { lang };
      if (profileId) params.profile_id = profileId;

      const res = await soraClient.get(`/api/games/${id}`, { params });
      return reply.code(200).send(res.data);
    },
  );
};

export default catalogRoutes;
