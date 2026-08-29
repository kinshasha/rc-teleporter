import fs from 'fs';
import path from 'path';
import url from 'url';

const dirname = path.dirname(url.fileURLToPath(import.meta.url));
const streamsFile = path.resolve(dirname, '../server/streams.json');
const allowedHosts = [/\.liveatc\.net$/i, /^broadcastify\.cdnstream1\.com$/i];
const streams = JSON.parse(fs.readFileSync(streamsFile, 'utf8'));

if (!Array.isArray(streams)) {
    throw new Error('server/streams.json must contain an array');
}

const numbers = new Set();

for (const stream of streams) {
    const parsedUrl = new URL(stream.url);

    if (!allowedHosts.some((pattern) => pattern.test(parsedUrl.hostname))) {
        throw new Error(`Stream ${stream.number} uses a non-approved host: ${parsedUrl.hostname}`);
    }

    if (numbers.has(stream.number)) {
        throw new Error(`Duplicate stream number: ${stream.number}`);
    }

    numbers.add(stream.number);
}

console.log(`Validated ${streams.length} approved stream entries`);
