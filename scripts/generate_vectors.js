import fs from 'fs';
import readline from 'readline';
import https from 'https';
import { pipeline, env } from '@xenova/transformers';

// 禁用本地模型缓存下载逻辑，适应 CI 环境
env.allowLocalModels = false;

async function main() {
    const ATOMS_URL = 'https://raw.githubusercontent.com/dontbesilent2025/dbskill/refs/heads/main/%E7%9F%A5%E8%AF%86%E5%BA%93/%E5%8E%9F%E5%AD%90%E5%BA%93/atoms.jsonl';
    const ATOMS_FILE = 'atoms.jsonl';

    console.log(`正在从远程下载 ${ATOMS_FILE}...`);
    try {
        await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(ATOMS_FILE);
            https.get(ATOMS_URL, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`下载失败: ${response.statusCode}`));
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(ATOMS_FILE, () => reject(err));
            });
        });
        console.log(`${ATOMS_FILE} 下载完成`);
    } catch (err) {
        console.error(`${ATOMS_FILE} 下载失败: ${err.message}`);
        // 如果文件已存在，可以继续，否则退出
        if (!fs.existsSync(ATOMS_FILE)) {
            process.exit(1);
        }
        console.log(`使用本地已有的 ${ATOMS_FILE}`);
    }

    // 从配置文件读取本地模型 ID
    const config = JSON.parse(fs.readFileSync('model.config.json', 'utf8'));
    const LOCAL_MODEL_ID = config.local_model_id;

    console.log(`加载本地 ${LOCAL_MODEL_ID} 模型...`);
    // 使用配置文件中的模型提取特征
    const extractor = await pipeline('feature-extraction', LOCAL_MODEL_ID, {
    quantized: true // 使用量化版本降低内存消耗
    });

    const fileStream = fs.createReadStream(ATOMS_FILE);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const writeStream = fs.createWriteStream('vectors.ndjson');

    console.log('开始处理 atoms.jsonl...');
    for await (const line of rl) {
        if (!line.trim()) continue;
        const atom = JSON.parse(line);

        // 将原知识和上下文拼接作为嵌入文本
        const textToEmbed = `标签: ${atom.topics?.join(',')}\n结论: ${atom.knowledge}`;

        const output = await extractor(textToEmbed, { 
            pooling: config.pooling, 
            normalize: config.normalize 
        });
        const vector = Array.from(output.data);

        // 组装 Cloudflare Vectorize 所需的 NDJSON 格式
        const record = {
            id: atom.id,
            values: vector,
            metadata: {
                knowledge: atom.knowledge || "",
                original: atom.original || "",
                topics: atom.topics ? atom.topics.join(',') : "",
                type: atom.type || ""
            }
        };

        writeStream.write(JSON.stringify(record) + '\n');
    }

    writeStream.end();
    console.log('向量化完成，已生成 vectors.ndjson');
}

main().catch(console.error);