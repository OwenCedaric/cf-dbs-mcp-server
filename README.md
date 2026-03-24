# Cloudflare DBS MCP Server

这是一个运行在 Cloudflare Workers 上的轻量级 Model Context Protocol (MCP) 服务端，支持语义检索。

## 功能特性

- **标准 MCP 支持**: 完整实现 MCP JSON-RPC 协议与 SSE 发现。
- **免 SDK 设计**: 零依赖 `@modelcontextprotocol/sdk`，更轻量、响应更快、适配 Serverless。
- **语义检索**: 通过向量数据库实现高精度的知识库搜索。
- **安全验证**: 支持 `AUTH_TOKEN` 验证。
- **高性能**: 利用 Cloudflare Workers AI + Vectorize。

## 快速开始

1.  **安装依赖**: `pnpm install`
2.  **配置**: 修改 `wrangler.toml` 中的 `AI` 和 `VECTOR_INDEX` 绑定。
3.  **本地构建向量**: `pnpm run build-vectors`
4.  **部署**: `pnpm run deploy`

## 接入方式 (How to Connect)

### 1. 标准 MCP SSE 接入
- **SSE URL**: `https://<your-worker-url>/mcp`
- **Method**: `GET` (开启会话) -> `POST` (发送指令)
- **Headers**: `Authorization: Bearer YOUR_TOKEN`

### 2. 直接 JSON-RPC 接入 (Stateless HTTP)
- **URL**: `https://<your-worker-url>/mcp`
- **Method**: `POST`
- **Body**: Standard JSON-RPC 2.0
- **Example**:
  ```bash
  curl -X POST https://.../mcp \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -d '{ "jsonrpc": "2.0", "id": "1", "method": "tools/list" }'
  ```

### 3. 遗留 API 接入
- **URL**: `/search`
- **Method**: `POST`
- **Body**: `{ "query": "关键词", "top_k": 10 }`

## 开发调试

使用 `pnpm run dev` 启动本地开发服务器。

### 示例请求 (curl)

```bash
curl -X POST https://dbs-mcp-server.<your-subdomain>.workers.dev/search \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"query": "如何使用这个 API"}'
```

## 返回结果示例

```json
{
  "success": true,
  "query": "如何使用这个 API",
  "results": [
    {
      "score": 0.89,
      "knowledge": "...",
      "topics": ["...", "..."],
      "original": "..."
    }
  ]
}
```
