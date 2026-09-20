import client from "./client";
export async function askPlatformAssistant(question) { const { data } = await client.post("/platform-assistant/ask", { question }); return data; }
