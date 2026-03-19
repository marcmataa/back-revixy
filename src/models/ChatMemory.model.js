import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: [true, "role is required"],
    },
    content: {
      type: String,
      required: [true, "content is required"],
      maxlength: [4000, "content cannot exceed 4000 characters"],
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    tokensUsed: {
      type: Number,
      default: 0,
      min: [0, "tokensUsed cannot be negative"],
    },
  },
  { _id: false }
);

const chatMemorySchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: [true, "storeId is required"],
      index: true,
    },
    sessionId: {
      type: String,
      required: [true, "sessionId is required"],
      trim: true,
    },
    messages: {
      type: [chatMessageSchema],
      default: [],
    },
    summary: {
      type: String,
      default: "",
      maxlength: [2000, "summary cannot exceed 2000 characters"],
      trim: true,
    },
    totalTokensUsed: {
      type: Number,
      default: 0,
      min: [0, "totalTokensUsed cannot be negative"],
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

chatMemorySchema.index({ storeId: 1, lastActiveAt: -1 });
chatMemorySchema.index({ sessionId: 1 }, { unique: true });

const ChatMemory = mongoose.model("ChatMemory", chatMemorySchema);
export default ChatMemory;
