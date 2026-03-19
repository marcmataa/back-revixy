// Conexión centralizada a Redis — reutilizada por BullMQ y cualquier otro servicio.
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null, // Requerido por BullMQ.
  enableReadyCheck: false,
});

connection.on("error", (err) => {
  // Logueamos el error sin exponer la URL completa (puede contener credenciales).
  console.error("Redis connection error:", err.message);
});

export default connection;
