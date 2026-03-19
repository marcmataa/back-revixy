import { Worker } from "bullmq";
import ActionLogs from "../models/ActionLogs.model.js";
import Store from "../models/Store.model.js";
import connection from "../config/redis.config.js";
import { ETL_QUEUE_NAME } from "../jobs/queues/etlQueue.js";
import { runForStore } from "../services/etl.service.js";

function maskStoreId(storeId) {
  return String(storeId || "").slice(0, 8);
}

const etlWorker = new Worker(
  ETL_QUEUE_NAME,
  async (job) => {
    const startedAt = Date.now();
    const storeId = job?.data?.storeId;

    try {
      if (!storeId) {
        throw new Error("Missing storeId in ETL job payload");
      }

      const store = await Store.findById(storeId).select("+accessToken");
      if (!store) {
        throw new Error(`Store not found for ETL job: ${maskStoreId(storeId)}`);
      }

      if (store.status === "REAUTH_REQUIRED") {
        // Saltamos stores que necesitan reconexión para evitar errores repetitivos.
        await ActionLogs.create({
          storeId: store._id,
          type: "ETL_SYNC",
          status: "PENDING",
          message: "ETL skipped: store requires re-authentication",
          duration: Date.now() - startedAt,
          metadata: { storeId: maskStoreId(store._id) },
        });
        return { skipped: true };
      }

      const result = await runForStore(store);
      if (!result?.success) {
        throw new Error(result?.error || "ETL run failed");
      }

      await ActionLogs.create({
        storeId: store._id,
        type: "ETL_SYNC",
        status: "SUCCESS",
        message: "ETL worker processed store successfully",
        duration: Date.now() - startedAt,
        metadata: {
          storeId: maskStoreId(store._id),
          daysProcessed: result.daysProcessed,
          calculationVersion: result.calculationVersion,
        },
      });

      return result;
    } catch (error) {
      await ActionLogs.create({
        storeId,
        type: "ETL_SYNC",
        status: "FAIL",
        message: "ETL worker failed for store job",
        duration: Date.now() - startedAt,
        metadata: { storeId: maskStoreId(storeId), error: error.message },
      });

      // Re-lanzamos para que BullMQ marque el job como failed y aplique retries.
      throw error;
    }
  },
  {
    connection,
    concurrency: 3,
  }
);

etlWorker.on("failed", (job, error) => {
  const storeId = job?.data?.storeId;
  console.error(`ETL job failed for store ${maskStoreId(storeId)}:`, error.message);
});

etlWorker.on("error", (error) => {
  console.error("ETL worker error:", error.message);
});

export default etlWorker;
