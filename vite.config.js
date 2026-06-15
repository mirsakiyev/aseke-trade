import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { handler as marketIndicesHandler } from "./netlify/functions/market-indices";
function marketIndicesDevApiPlugin() {
    return {
        name: "market-indices-dev-api",
        configureServer(server) {
            server.middlewares.use("/api/market-indices", async (request, response) => {
                try {
                    const result = await marketIndicesHandler({ httpMethod: request.method ?? "GET" });
                    response.statusCode = result.statusCode;
                    for (const [key, value] of Object.entries(result.headers)) {
                        response.setHeader(key, value);
                    }
                    response.end(result.body);
                }
                catch {
                    response.statusCode = 500;
                    response.setHeader("Content-Type", "application/json");
                    response.setHeader("Cache-Control", "no-store");
                    response.end(JSON.stringify({ error: "Market index data unavailable." }));
                }
            });
        }
    };
}
export default defineConfig({
    plugins: [react(), marketIndicesDevApiPlugin()],
    build: {
        sourcemap: false,
        target: "es2020"
    }
});
