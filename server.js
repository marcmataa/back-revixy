// server.js  ← Punto de entrada de la aplicación
import "dotenv/config";
import app from "./app.js";
import connectDB from "./src/config/db.js";
import Store from "./src/models/Store.model.js";
import { addEtlJob } from "./src/jobs/queues/etlQueue.js";
import etlWorker from "./src/workers/etl.worker.js";

const PORT = process.env.PORT || 3000;
const ETL_REPEAT_EVERY_MS = 6 * 60 * 60 * 1000;
const ETL_REPEAT_START_OFFSET_MS = 30 * 1000;

const scheduleRecurringEtlJobs = async () => {
  try {
    // Programamos un job recurrente por store para sincronizar cada 6 horas.
    const stores = await Store.find({ status: "ACTIVE" }).select("_id");

    await Promise.all(
      stores.map((store) =>
        addEtlJob(store._id, {
          repeat: {
            every: ETL_REPEAT_EVERY_MS,
            immediately: true,
          },
          delay: ETL_REPEAT_START_OFFSET_MS,
        })
      )
    );

    console.log(`🧩 ETL recurrente configurado para ${stores.length} stores activos.`);
  } catch (error) {
    console.error("❌ Error al programar ETL recurrente:", error.message);
  }
};

// Conectar a MongoDB y luego iniciar el servidor
const startServer = async () => {
  await connectDB();
  await scheduleRecurringEtlJobs();

  const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📋 Entorno: ${process.env.NODE_ENV || "development"}`);
    console.log(`🛠️ ETL worker activo con concurrencia: ${etlWorker.opts.concurrency || 3}`);
  });

  // ─── MANEJO DE SEÑALES DEL SO ────────────────────────────────────────
  const shutdown = async (signal) => {
    console.log(`\n⚠️  ${signal} recibido. Cerrando servidor...`);
    server.close(async () => {
      const { default: mongoose } = await import("mongoose");
      await mongoose.connection.close();
      console.log("✅ MongoDB desconectado. Servidor cerrado.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Capturar excepciones no manejadas
  process.on("unhandledRejection", (err) => {
    console.error("❌ UnhandledRejection:", err.message);
    server.close(() => process.exit(1));
  });

  process.on("uncaughtException", (err) => {
    console.error("❌ UncaughtException:", err.message);
    process.exit(1);
  });
};

startServer();