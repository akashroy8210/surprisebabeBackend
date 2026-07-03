import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import registerSocketHandlers from "./socketHandlers.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bubu123";

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Custom instances directory setup
const instancesDir = path.join(__dirname, "db_instances");
if (!fs.existsSync(instancesDir)) {
  fs.mkdirSync(instancesDir, { recursive: true });
}

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"]
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static(uploadsDir));

// Voice upload endpoint
app.post("/api/admin/upload-voice", (req, res) => {
  const { audioData } = req.body;
  if (!audioData) {
    return res.status(400).json({ success: false, error: "No audio data provided" });
  }

  const base64Data = audioData.replace(/^data:audio\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const filename = `voice_${Date.now()}.webm`;
  const filePath = path.join(uploadsDir, filename);

  fs.writeFile(filePath, buffer, (err) => {
    if (err) {
      console.error("Audio save error:", err);
      return res.status(500).json({ success: false, error: "Failed to save audio" });
    }
    const serverUrl = process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`;
    const audioUrl = `${serverUrl}/uploads/${filename}`;
    return res.status(200).json({ success: true, audioUrl });
  });
});

// Admin Login endpoint using Option 2 (ANKA API delegation)
app.post("/api/admin/login", async (req, res) => {
  console.log("Admin login request received:", req.body);
  const { id, pass, password } = req.body;
  
  // Backwards compatibility for older password-only admin client
  const loginId = id || "admin";
  const loginPass = pass || password;

  const ANKA_AUTH_URL = process.env.ANKA_AUTH_URL;
  console.log(`Admin login attempt: ID=${loginId}, ANKA_AUTH_URL=${ANKA_AUTH_URL ? "set" : "not set"}`);
  if (ANKA_AUTH_URL) {
    console.log(`Delegating admin authentication to ANKA API at ${ANKA_AUTH_URL}`);
    try {
      const response = await fetch(ANKA_AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: loginId, password: loginPass })
      });
      const data = await response.json();
      if (response.status === 200 && (data.success || data.token || data.authenticated)) {
        return res.status(200).json({ success: true, token: data.token || "admin-secret-token-bubu" });
      }
      return res.status(401).json({ success: false, error: data.message || data.error || "Incorrect ID or password, baby 😔" });
    } catch (err) {
      console.error("Anka auth failed:", err);
      return res.status(500).json({ success: false, error: "Authentication server is unreachable 😔" });
    }
  } else {
    // Mock local authentication fallback
    if ((loginId === "admin" && loginPass === "bubu123") || loginPass === ADMIN_PASSWORD) {
      return res.status(200).json({ success: true, token: "admin-secret-token-bubu" });
    }
    return res.status(401).json({ success: false, error: "Incorrect ID or password, baby 😔" });
  }
});

// POST /api/instances - save customized date portal instance
app.post("/api/instances", (req, res) => {
  const { id, config } = req.body;
  if (!id || !config) {
    return res.status(400).json({ success: false, error: "Missing instance ID or configuration data" });
  }

  const filePath = path.join(instancesDir, `${id}.json`);
  fs.writeFile(filePath, JSON.stringify(config, null, 2), (err) => {
    if (err) {
      console.error("Instance save error:", err);
      return res.status(500).json({ success: false, error: "Failed to save configuration" });
    }
    return res.status(200).json({ success: true, id });
  });
});

// GET /api/instances/:id - load customized date portal instance
app.get("/api/instances/:id", (req, res) => {
  const { id } = req.params;
  const filePath = path.join(instancesDir, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: "Configuration not found" });
  }

  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error("Instance load error:", err);
      return res.status(500).json({ success: false, error: "Failed to load configuration" });
    }
    return res.status(200).json({ success: true, config: JSON.parse(data) });
  });
});

// POST /api/ai/generate - generate romantic text using Gemini API
app.post("/api/ai/generate", async (req, res) => {
  const { prompt, type } = req.body;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  const systemPrompt = `You are a warm, emotional, and loving boyfriend writing a personal message to his girlfriend after two years of relationship.
The emotional tone should be: Safe, Comforting, Calm, Premium, Dreamlike, and deeply supportive.

CRITICAL RULES:
- Do NOT generate typical generic AI romantic slogans. Do NOT write clichés like "you are the light of my life", "I cherish every moment with you", or "your smile brightens my day".
- Write it in a cozy, intimate, slightly playful, and natural tone (as if written by a real boyfriend after spending two years together).
- Keep the output length appropriate for:
  * "welcome" -> 1 short comforting sentence.
  * "timeline" -> 2-3 sentences describing a shared memory.
  * "quote" -> 1 sweet, soft, starlit reminder.
  * "things_i_love" -> 1-2 sentences of why you love a small detail about her.
  * "letter" -> 3-4 sentences of a deep, warm love letter paragraph.

The user's prompt/idea is: "${prompt}"
Category: "${type}"
Generate only the raw text message. Do not include quotes around the output, markdown, or any conversational introduction.`;

  if (GEMINI_API_KEY) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: systemPrompt }]
            }]
          })
        }
      );
      const data = await response.json();
      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      if (generatedText) {
        return res.status(200).json({ success: true, text: generatedText });
      }
      throw new Error("Empty candidate parts");
    } catch (err) {
      console.error("Gemini API error:", err);
      return res.status(500).json({ success: false, error: "Failed to generate text using Gemini API." });
    }
  } else {
    // Elegant fallback pre-baked messages
    let fallbackText = "";
    const lowerPrompt = (prompt || "").toLowerCase();
    
    if (lowerPrompt.includes("temple") || lowerPrompt.includes("puja") || lowerPrompt.includes("praying")) {
      fallbackText = `I still remember standing next to you in the temple, listening to the bells ring. Seeing you close your eyes and pray so sincerely made me pray for just one thing—to keep holding your hand like this forever.`;
    } else if (lowerPrompt.includes("first met") || lowerPrompt.includes("photo") || lowerPrompt.includes("nervous")) {
      fallbackText = `That first photo we took together. I was so nervous and shy, my mind went completely blank, but you looked so warm and comfortable. When we kissed for the first time, all my shyness just melted away.`;
    } else if (lowerPrompt.includes("hand") || lowerPrompt.includes("hold")) {
      fallbackText = `Your hand in mine feels like the safest place in the whole world. It's funny how a simple squeeze from you can make all the noise in my head just disappear.`;
    } else if (type === "timeline") {
      fallbackText = `I still remember that day so clearly. Watching you laugh while we were together, I realized how lucky I am to have you in my life. I hope we keep making these silly, beautiful memories forever.`;
    } else if (type === "welcome") {
      fallbackText = `I'm so glad you're here. Let's forget about the world outside and just spend tonight under our own stars.`;
    } else if (type === "things_i_love") {
      fallbackText = `The way you talk about the things you love, with that little sparkle in your eyes. It makes me fall for you all over again.`;
    } else {
      fallbackText = `Hey my biwipie, I know today felt heavy, but I want to remind you that you are my safest harbor. No matter how gray the skies get, we'll keep holding each other tight. I love you so much.`;
    }
    return res.status(200).json({ success: true, text: fallbackText });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date() });
});

const httpServer = createServer(app);

// Initialize Socket.io with HTTP server
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`Surprise server running on port ${PORT}`);
});
