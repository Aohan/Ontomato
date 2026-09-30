import { z } from "zod";
import {
  governanceSessionSchema,
  governanceSummarySchema,
  governanceSourceReadSchema,
} from "@ontomato/contracts/knowledge-governance";
import { nodeApiGet, nodeApiPost } from "../../utils/api";

const base = "/knowledge-governance";
export const governanceApi = {
  async list(signal?: AbortSignal) {
    return z.array(governanceSummarySchema).parse(await nodeApiGet(base, { signal }));
  },
  async read(id: string, signal?: AbortSignal) {
    return governanceSessionSchema.parse(
      await nodeApiGet(`${base}/${encodeURIComponent(id)}`, { signal })
    );
  },
  async start(signal?: AbortSignal) {
    return governanceSessionSchema.parse(await nodeApiPost(base, {}, { signal }));
  },
  async respond(id: string, message: string, signal?: AbortSignal) {
    return governanceSessionSchema.parse(
      await nodeApiPost(`${base}/${encodeURIComponent(id)}/messages`, { message }, { signal })
    );
  },
  async stop(id: string, signal?: AbortSignal) {
    await nodeApiPost(`${base}/${encodeURIComponent(id)}/stop`, {}, { signal });
  },
  async source(id: string, sourceId: string, offset: number, signal?: AbortSignal) {
    return governanceSourceReadSchema.parse(
      await nodeApiGet(
        `${base}/${encodeURIComponent(id)}/sources/${encodeURIComponent(sourceId)}?offset=${offset}`,
        { signal }
      )
    );
  },
};
