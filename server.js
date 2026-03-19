// server.js  ← Punto de entrada de la aplicación
import "dotenv/config";
import app from "./app.js";
import connectDB from "./src/config/db.js";

const PORT = process.env.PORT || 3000;

// Conectar a MongoDB y luego iniciar el servidor
const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📋 Entorno: ${process.env.NODE_ENV || "development"}`);
  });

  // ─── MANEJO DE SEÑALES DEL SO ────────────────────────────────────────
  const shutdown = async (signal) => {
    console.log(`\n⚠️  ${signal} recibido. Cerrando servidor...`);
    server.close(async () => {
      const mongoose = require("mongoose");
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