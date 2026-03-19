import mongoose from "mongoose";

const actionLogsSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: undefined, // Algunos eventos pueden ser solo a nivel de usuario.
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: undefined,
    },
    type: {
      type: String,
      enum: [
        "ETL_SYNC",
        "AI_INSIGHT",
        "AI_SIMULATION",
        "AUTH_EVENT",
        "API_CALL",
        "API_ERROR",
        "ACTION_EXECUTED",
        "ACTION_REVERTED",
      ],
      required: [true, "type es obligatorio"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAIL", "PENDING"],
      required: [true, "status es obligatorio"],
      trim: true,
    },
    message: {
      type: String,
      required: [true, "message es obligatorio"],
      trim: true,
      maxlength: [2000, "message no puede superar 2000 caracteres"],
    },
    duration: {
      type: Number,
      default: 0, // ms
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined, // Payload flexible: se debe sanitizar antes de guardar.
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Índice para consultar logs por store rápidamente (createdAt descendente).
actionLogsSchema.index({ storeId: 1, createdAt: -1 });

const ActionLogs = mongoose.model("ActionLogs", actionLogsSchema);
export default ActionLogs;

