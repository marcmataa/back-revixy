import mongoose from "mongoose";

function isIntegerNumber(value) {
  return typeof value === "number" && Number.isInteger(value);
}

function isIntegerCents(value) {
  // Cualquier dinero se modela como entero en cents (no floats).
  return isIntegerNumber(value);
}

// Normalizamos el día a UTC (00:00:00.000) para que el "day key" sea estable.
// El cálculo de qué día corresponde a la zona horaria del store debe hacerse en ETL.
function normalizeDayToUTC(value) {
  if (!value) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
  }

  if (typeof value === "string") {
    // Esperamos YYYY-MM-DD
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  return value;
}

function formatDayUTCToISO(dateValue) {
  if (!dateValue || !(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return dateValue;
  const y = dateValue.getUTCFullYear();
  const m = String(dateValue.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateValue.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const dailyStatsSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: [true, "storeId es obligatorio"],
    },
    date: {
      type: Date,
      required: [true, "date es obligatorio"],
      set: normalizeDayToUTC,
      get: formatDayUTCToISO,
    },
    calculationVersion: {
      type: String,
      required: [true, "calculationVersion es obligatorio"],
      default: "v1.0",
    },

    // Raw inputs (enteros en cents; sin floats).
    grossRevenue: {
      type: Number,
      required: [true, "grossRevenue es obligatorio"],
      validate: { validator: isIntegerCents, message: "grossRevenue debe ser entero (cents)" },
    },
    discounts: {
      type: Number,
      required: [true, "discounts es obligatorio"],
      validate: { validator: isIntegerCents, message: "discounts debe ser entero (cents)" },
    },
    refunds: {
      type: Number,
      required: [true, "refunds es obligatorio"],
      validate: { validator: isIntegerCents, message: "refunds debe ser entero (cents)" },
    },
    adSpend: {
      type: Number,
      required: [true, "adSpend es obligatorio"],
      validate: { validator: isIntegerCents, message: "adSpend debe ser entero (cents)" },
    },
    cogs: {
      type: Number,
      required: [true, "cogs es obligatorio"],
      validate: { validator: isIntegerCents, message: "cogs debe ser entero (cents)" },
    },
    gatewayFees: {
      type: Number,
      required: [true, "gatewayFees es obligatorio"],
      validate: { validator: isIntegerCents, message: "gatewayFees debe ser entero (cents)" },
    },
    shippingCosts: {
      type: Number,
      required: [true, "shippingCosts es obligatorio"],
      validate: { validator: isIntegerCents, message: "shippingCosts debe ser entero (cents)" },
    },
    taxes: {
      type: Number,
      required: [true, "taxes es obligatorio"],
      validate: { validator: isIntegerCents, message: "taxes debe ser entero (cents)" },
    },

    // Pre-calculated fields (ETL los calcula y los persiste).
    netRevenue: {
      type: Number,
      required: [true, "netRevenue es obligatorio"],
      validate: { validator: isIntegerCents, message: "netRevenue debe ser entero (cents)" },
    },
    netProfit: {
      type: Number,
      required: [true, "netProfit es obligatorio"],
      validate: { validator: isIntegerCents, message: "netProfit debe ser entero (cents)" },
    },
    blendedROAS: {
      type: Number,
      default: null, // Null cuando adSpend = 0
    },
    breakEvenROAS: {
      type: Number,
      required: [true, "breakEvenROAS es obligatorio"],
    },
    contributionMargin: {
      type: Number,
      default: null, // Null cuando netRevenue = 0
    },

    // Attribution & confidence.
    confidenceScore: {
      type: Number,
      required: [true, "confidenceScore es obligatorio"],
      min: [0, "confidenceScore no puede ser menor a 0"],
      max: [100, "confidenceScore no puede ser mayor a 100"],
    },
    dataFlags: {
      // Cada flag debe pertenecer a un conjunto predefinido.
      type: [
        {
          type: String,
          enum: ["LOW_ROAS", "HIGH_CPC", "STOCK_RISK", "LOW_CONFIDENCE", "PROFIT_NEGATIVE", "SCALE_OPPORTUNITY", "CTR_DECLINING", "REVENUE_DROP"],
        },
      ],
      default: [],
    },

    // Meta Ads snapshot.
    metaData: {
      impressions: {
        type: Number,
        required: [true, "metaData.impressions es obligatorio"],
        validate: { validator: isIntegerNumber, message: "impressions debe ser entero" },
      },
      clicks: {
        type: Number,
        required: [true, "metaData.clicks es obligatorio"],
        validate: { validator: isIntegerNumber, message: "clicks debe ser entero" },
      },
      ctr: {
        type: Number,
        required: [true, "metaData.ctr es obligatorio"],
      },
      cpc: {
        type: Number,
        required: [true, "metaData.cpc es obligatorio"],
      },
      campaignsActive: {
        type: Number,
        required: [true, "metaData.campaignsActive es obligatorio"],
        validate: { validator: isIntegerNumber, message: "campaignsActive debe ser entero" },
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      getters: true, // Para que date se serialice como YYYY-MM-DD.
    },
    toObject: {
      virtuals: true,
      getters: true,
    },
  }
);

// Índice compuesto obligatorio para dashboards: storeId + date (orden descendente por día).
dailyStatsSchema.index({ storeId: 1, date: -1 });

const DailyStats = mongoose.model("DailyStats", dailyStatsSchema);
export default DailyStats;

