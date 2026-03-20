import mongoose from "mongoose";
import crypto from "crypto";

function encryptAccessToken(plainTextToken) {
  // Ciframos en reposo con AES-256 para proteger tokens Shopify.
  // Usamos el ENCRYPTION_KEY del entorno y derivamos una clave de 32 bytes.
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY no definida en el entorno");
  }

  const key = crypto
    .createHash("sha256")
    .update(String(encryptionKey))
    .digest(); // 32 bytes
  const iv = crypto.randomBytes(16); // tamaño IV recomendado para AES-CBC

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(String(plainTextToken), "utf8", "base64");
  encrypted += cipher.final("base64");

  return `enc:${iv.toString("base64")}:${encrypted}`;
}

function decryptAccessToken(encryptedToken) {
  // Desencriptamos solo bajo demanda (nunca en logs ni respuestas).
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY no definida en el entorno");
  }

  if (
    typeof encryptedToken !== "string" ||
    !encryptedToken.startsWith("enc:")
  ) {
    // Si por cualquier motivo llega sin prefijo, lo devolvemos tal cual.
    return encryptedToken;
  }

  const parts = encryptedToken.split(":");
  // Formato: enc:<ivBase64>:<cipherBase64>
  if (parts.length !== 3) {
    throw new Error("Token cifrado con formato inválido");
  }

  const [, ivBase64, cipherBase64] = parts;
  const key = crypto
    .createHash("sha256")
    .update(String(encryptionKey))
    .digest();
  const iv = Buffer.from(ivBase64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(cipherBase64, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

const storeSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "El owner es obligatorio"],
      unique: true, // MVP: un store por owner.
    },
    shopifyDomain: {
      type: String,
      required: [true, "El shopifyDomain es obligatorio"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    accessToken: {
      type: String,
      required: [true, "El accessToken es obligatorio"],
      select: false, // Nunca exponemos el token por defecto.
    },
    metaAdAccountId: {
      type: String,
      default: undefined,
    },
    currency: {
      type: String,
      default: "EUR",
      trim: true,
    },
    language: {
      type: String,
      enum: ["es", "en", "ca"],
      default: "es",
    },
    timezone: {
      type: String,
      required: [true, "El timezone es obligatorio"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "REAUTH_REQUIRED", "INACTIVE"],
      default: "ACTIVE",
    },
    aiUsage: {
      dailyTokensUsed: {
        type: Number,
        default: 0,
      },
      lastResetAt: {
        type: Date,
        default: null,
      },
    },
    settings: {
      defaultMarginPercent: {
        type: Number,
        min: [0, "defaultMarginPercent no puede ser menor a 0"],
        max: [100, "defaultMarginPercent no puede ser mayor a 100"],
        required: [true, "defaultMarginPercent es obligatorio"],
      },
      defaultGatewayFeePercent: {
        type: Number,
        default: 2.1,
      },
      defaultGatewayFeeFixed: {
        type: Number,
        default: 25,
        validate: {
          validator: Number.isInteger,
          message: "defaultGatewayFeeFixed debe ser un entero (cents)",
        },
      },
      defaultShippingCost: {
        type: Number,
        required: [true, "defaultShippingCost es obligatorio"],
        validate: {
          validator: Number.isInteger,
          message: "defaultShippingCost debe ser un entero (cents)",
        },
      },
      executionMode: {
        type: String,
        enum: ["READ_ONLY", "COPILOT", "AUTOPILOT"],
        default: "COPILOT",
      },
      strategy: {
        type: String,
        enum: ["PROFIT", "GROWTH", "BALANCED"],
        default: "BALANCED",
      },
      industry: {
        type: String,
        enum: ["FASHION", "ELECTRONICS", "COSMETICS", "FOOD", "HOME", "OTHER"],
        default: "OTHER",
      },
    },
    monthlyGoals: {
      targetRevenue: {
        type: Number,
        default: 0, // en cents
      },
      targetROAS: {
        type: Number,
        default: 0,
      },
      targetAdSpend: {
        type: Number,
        default: 0, // en cents
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        // Eliminamos datos sensibles al serializar.
        delete ret.accessToken;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.accessToken;
        return ret;
      },
    },
  },
);

// Ciframos el token solo cuando se guarda y fue modificado.
storeSchema.pre("save", function preSaveAccessToken() {
  if (!this.isModified("accessToken")) return;
  if (typeof this.accessToken !== "string" || !this.accessToken) {
    throw new Error("accessToken inválido para cifrar");
  }
  if (this.accessToken.startsWith("enc:")) return;
  this.accessToken = encryptAccessToken(this.accessToken);
});

// Método para obtener el token en claro bajo demanda.
storeSchema.methods.getDecryptedAccessToken =
  function getDecryptedAccessToken() {
    if (!this.accessToken) {
      // Como accessToken tiene select:false, se requiere explícitamente:
      // Store.find(...).select("+accessToken")
      throw new Error("accessToken no cargado. Usa .select('+accessToken')");
    }
    return decryptAccessToken(this.accessToken);
  };

const Store = mongoose.model("Store", storeSchema);
export default Store;
