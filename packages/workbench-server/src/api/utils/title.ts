import { createModel } from "../../config/model-factory";
import { renderPrompt } from "../../core/prompts/loader";
import { getCheckpointer } from "../../infrastructure/connection";
import { createLogger } from "../../logging/logger";
import { tApp } from "../../i18n";
import { updateThreadTitle } from "../../services/chat/thread-store";

const logger = createLogger("api:title");

export async function generateTitleAsync(
  message: string,
  threadId: string,
  userId: string,
  domainId: string
): Promise<string | null> {
  try {
    const model = await createModel({ temperature: 0.3, agentName: "API-TitleGenerator" });
    const response = await model.invoke([
      {
        role: "system",
        content: renderPrompt("standard-chat.title-generator.system"),
      },
      { role: "user", content: renderPrompt("standard-chat.title-generator.user", { message }) },
    ]);

    const title = response.content.toString().trim().slice(0, 20);
    const checkpointerInstance = getCheckpointer();
    if (checkpointerInstance) {
      if (await checkpointerInstance.isThreadTitleLocked(threadId)) {
        return null;
      }

      const updated = await updateThreadTitle(threadId, title, userId, domainId);
      if (!updated) return null;
    }

    return title;
  } catch (error) {
    logger.warn(tApp("foundation.log.title.failed"), error);
    return null;
  }
}
