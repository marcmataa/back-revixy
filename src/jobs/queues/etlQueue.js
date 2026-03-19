import { Queue } from "bullmq";
import connection from "../../config/redis.config.js";

const ETL_QUEUE_NAME = "etl-sync";

const etlQueue = new Queue(ETL_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

const addEtlJob = async (storeId, options = {}) => {
  const normalizedStoreId = String(storeId || "").trim();
  if (!normalizedStoreId) {
    throw new Error("storeId is required to enqueue ETL job");
  }

  return etlQueue.add(
    ETL_QUEUE_NAME,
    { storeId: normalizedStoreId },
    {
      jobId: normalizedStoreId,
      ...options,
    }
  );
};

export { ETL_QUEUE_NAME, etlQueue, addEtlJob };
