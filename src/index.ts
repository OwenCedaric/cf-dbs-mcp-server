import modelConfig from '../model.config.json';

export interface Env {
    VECTOR_INDEX: VectorizeIndex;
    AI: any;
    AUTH_TOKEN?: string;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // Security middleware
        const authToken = env.AUTH_TOKEN;
        if (authToken) {
            const authHeader = request.headers.get('Authorization');
            if (authHeader !== `Bearer ${authToken}` && authHeader !== authToken) {
                return new Response(JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing Authorization token' }), { 
                    status: 401, 
                    headers: corsHeaders() 
                });
            }
        }

        if (request.method === 'OPTIONS') {
            return handleCors(request);
        }

        // MCP Discovery & REST API
        if (request.method === 'GET') {
            if (path === '/' || path === '/mcp') {
                const { readable, writable } = new TransformStream();
                const writer = writable.getWriter();
                const encoder = new TextEncoder();
                const endpoint = new URL('/mcp', request.url).toString();
                
                // MCP SSE Discovery
                writer.write(encoder.encode(`event: endpoint\ndata: ${endpoint}\n\n`));
                writer.close();

                return new Response(readable, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            if (path === '/mcp/tools') {
                return new Response(JSON.stringify({ tools: getToolDefinitions() }), { headers: corsHeaders() });
            }
        }

        // MCP JSON-RPC & Legacy API
        if (request.method === 'POST') {
            try {
                const body = await request.json() as any;
                const { method, params, id, jsonrpc } = body;

                // Handle standard MCP JSON-RPC
                if (method || jsonrpc === "2.0") {
                    if (method === 'initialize') {
                        return mcpResponse(id, {
                            protocolVersion: "2024-11-05",
                            capabilities: { tools: {}, resources: {} },
                            serverInfo: { name: "cf-dbs-mcp-server", version: "1.0.0" }
                        });
                    }

                    if (method === 'tools/list') {
                        return mcpResponse(id, { tools: getToolDefinitions() });
                    }

                    if (method === 'tools/call') {
                        const { name, arguments: args } = params || {};
                        if (name === 'search' && args?.query) {
                            return mcpResponse(id, await handleSearch(args.query, args.top_k || 10, env));
                        }
                    }

                    return mcpResponse(id, {});
                }

                // Legacy custom POST API (/search)
                if (path === '/search' && body.query) {
                    const result = await handleSearch(body.query, body.top_k || 10, env);
                    return new Response(JSON.stringify(result), { headers: corsHeaders() });
                }

                return new Response(JSON.stringify({ error: "Method not found or invalid body" }), { status: 404, headers: corsHeaders() });

            } catch (e: any) {
                return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders() });
            }
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders() });
    }
};

function handleCors(request: Request): Response {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
    });
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };
}

function getToolDefinitions() {
    return [
        {
            name: "search",
            description: "语义检索知识库 (Semantically search the knowledge base)",
            inputSchema: {
                type: "object",
                properties: { 
                    query: { type: "string", description: "搜索关键词" }, 
                    top_k: { type: "number", default: 10, description: "返回结果数量" } 
                },
                required: ["query"]
            }
        }
    ];
}

async function handleSearch(query: string, topK: number, env: Env) {
    const aiResp = await env.AI.run(modelConfig.remote_model_id, { text: query });
    const queryVector = aiResp.data[0];
    
    if (!queryVector) {
        throw new Error("Failed to generate embedding");
    }

    const matches = await env.VECTOR_INDEX.query(queryVector, { 
        topK: topK, 
        returnMetadata: true 
    });

    const results = matches.matches.map((match: any) => ({
        score: match.score,
        knowledge: match.metadata?.knowledge,
        topics: match.metadata?.topics,
        original: match.metadata?.original
    }));

    return { 
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }] 
    };
}

function mcpResponse(id: any, result: any) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
        headers: corsHeaders()
    });
}