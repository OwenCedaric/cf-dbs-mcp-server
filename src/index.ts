import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import modelConfig from '../model.config.json';

type Bindings = {
    AI: any;
    VECTOR_INDEX: any;
    AUTH_TOKEN?: string;
};

const envStorage = new AsyncLocalStorage<Bindings>();
const app = new Hono<{ Bindings: Bindings }>();

// Middleware to expose env through AsyncLocalStorage
app.use('*', async (c, next) => {
    return envStorage.run(c.env, () => next());
});

// Middleware to validate Token
app.use('/mcp', async (c, next) => {
    const authToken = c.env.AUTH_TOKEN;
    if (!authToken) {
        return await next();
    }

    const authHeader = c.req.header('Authorization');
    if (authHeader !== `Bearer ${authToken}` && authHeader !== authToken) {
        return c.json({ error: 'Unauthorized', message: 'Invalid or missing Authorization token' }, 401);
    }
    await next();
});

// 初始化 MCP Server
const server = new McpServer({
    name: "DBS-Traffic-Molds-MCP",
    version: "1.0.0"
});

/**
 * 注册查询工具
 * 基于 Cloudflare Vectorize 和 AI 绑定实现语义检索
 */
server.tool(
    "search_knowledge",
    {
        query: z.string().describe("知识库搜索词")
    },
    async ({ query }) => {
        const env = envStorage.getStore();
        if (!env) {
            return {
                content: [{ type: "text", text: "环境变量未加载" }],
                isError: true
            };
        }

        try {
            // 1. 调用远程 Cloudflare AI 生成查询向量
            // 注: BGE-M3 在 Cloudflare 上默认使用 CLS pooling 并通过归一化，与 model.config.json 保持一致
            const aiResponse = await env.AI.run(modelConfig.remote_model_id, {
                text: [query]
            });
            const queryVector = aiResponse.data[0];

            if (!queryVector) {
                return {
                    content: [{ type: "text", text: "未能生成向量" }],
                    isError: true
                };
            }

            // 2. 在 Vectorize 中检索
            const matches = await env.VECTOR_INDEX.query(queryVector, {
                topK: 3,
                returnMetadata: true
            });

            // 3. 提取结果
            const results = matches.matches.map((match: any) => ({
                score: match.score,
                knowledge: match.metadata.knowledge,
                original: match.metadata.original,
                topics: match.metadata.topics
            }));

            return {
                content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `搜索失败: ${error.message}` }],
                isError: true
            };
        }
    }
);

// 创建 Web Standard 传输层
// 在 CF Workers 中，我们通常为每个请求或会话创建传输层，或者使用全局传输层配合 sessionIdGenerator
const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID()
});

// 连接 Server 和 Transport
await server.connect(transport);

// 统一 MCP 处理路径 (处理 GET, POST, DELETE)
app.all('/mcp', async (c) => {
    return transport.handleRequest(c.req.raw);
});

// 兼容旧路径 (可选)
app.all('/sse', async (c) => transport.handleRequest(c.req.raw));
app.all('/messages', async (c) => transport.handleRequest(c.req.raw));

// 默认根路径提示
app.get('/', (c) => c.text('DBS MCP Server is running. Use /mcp for MCP connection.'));

export default app;