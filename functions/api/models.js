import { Client } from '@neondatabase/serverless'; // 或使用 pg 模块

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 初始化数据库连接
    const client = new Client(env.DATABASE_URL);
    await client.connect();

    // 跨域响应头
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // 1. GET 请求：读取模型数据
        if (request.method === 'GET') {
            const modelId = url.searchParams.get('id');

            if (modelId) {
                const result = await client.query('SELECT * FROM models WHERE id = $1', [modelId]);
                return new Response(JSON.stringify(result.rows[0] || {}), { headers: corsHeaders });
            } else {
                const result = await client.query('SELECT id, name, updated_at FROM models ORDER BY updated_at DESC');
                return new Response(JSON.stringify(result.rows), { headers: corsHeaders });
            }
        }

        // 2. POST 请求：写入/更新模型数据
        if (request.method === 'POST') {
            const body = await request.json();
            const { id, name, config } = body;

            const query = `
        INSERT INTO models (id, name, config, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (id) 
        DO UPDATE SET name = EXCLUDED.name, config = EXCLUDED.config, updated_at = NOW()
        RETURNING *;
      `;

            const result = await client.query(query, [id, name, JSON.stringify(config)]);
            return new Response(JSON.stringify({ success: true, data: result.rows[0] }), { headers: corsHeaders });
        }

        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    } finally {
        context.waitUntil(client.end());
    }
}