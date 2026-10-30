// 零依賴靜態伺服器：服務 docs/，隨機埠（測試用，不部署）
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function startServer(rootDir) {
    const root = path.resolve(rootDir);
    const server = http.createServer((req, res) => {
        let file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
        if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
        if (file.endsWith(path.sep)) file += 'index.html';
        fs.readFile(file, (err, buf) => {
            if (err) { res.writeHead(404); return res.end('404'); }
            res.writeHead(200, {
                'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            res.end(buf);
        });
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                url: `http://127.0.0.1:${server.address().port}`,
                close: () => { server.closeAllConnections(); server.close(); }
            });
        });
    });
}

module.exports = { startServer };
