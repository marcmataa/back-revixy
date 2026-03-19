// src/config/db.js
import mongoose from "mongoose";
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Opciones recomendadas para producción
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`✅ MongoDB conectado: ${conn.connection.host}`);

    // Eventos de conexión
    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️  MongoDB desconectado. Intentando reconectar...");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("🔄 MongoDB reconectado");
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ Error de MongoDB:", err.message);
    });
  } catch (error) {
    console.error("❌ Error al conectar MongoDB:", error.message);
    process.exit(1); // Detener el proceso si no hay BD
  }
};

export default connectDB;
