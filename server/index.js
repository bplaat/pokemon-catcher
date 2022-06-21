// The Pokemon Catcher message broker server
// The server protocol is super simple but not very safe or effiecent: but who cares...
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { WebSocketServer } from 'ws';

// Config
const SERVER_PORT = process.env.PORT || 8080;
const POKEMONS_MAX = 12;

// Load data
const pokemons = JSON.parse(readFileSync('pokemons.json'));

const spawns = [
    { lon: 52.0050831, lat: 4.7512805 },
    { lon: 52.005187, lat: 4.752355 },
];

// Websocket server
const wss = new WebSocketServer({ noServer: true });
let clients = [];
wss.on('connection', ws => {
    let player = undefined;

    function send(type, data) {
        ws.send(JSON.stringify({ type, data }));
    }

    function broadcast(type, data) {
        for (const client of clients) {
            if (client.player.id != player.id) {
                client.ws.send(JSON.stringify({ type, data }));
            }
        }
    }

    ws.on('message', message => {
        const { type, data } = JSON.parse(message.toString());
        console.log('[WS]', type);

        if (type == 'player.connect') {
            const client = clients.find(client => client.player.id == data.player.id);
            if (client != null) client.ws.close();

            player = data.player;
            send('info', { pokemons, spawns, pokemonsMax: POKEMONS_MAX });
            for (const client of clients) {
                send('player.connect', { player: client.player });
            }
            clients.push({ player, ws });
            broadcast('player.connect', { player });
        }

        if (type == 'player.update') {
            player = data.player;
            broadcast('player.update', { player });
        }
    });

    ws.on('close', () => {
        if (player != undefined) {
            clients = clients.filter(client => client.player.id != player.id);
            broadcast('player.disconnect', { player: { id: player.id } });
        }
    });
});

// Web server
const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}/`);
    console.log(`[HTTP] ${req.method} ${pathname}`);

    if (pathname == '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Pokemon Catcher Server');
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
});

server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}/`);
    console.log(`[HTTP] ${req.method} UPGRADE ${pathname}`);

    if (pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, req);
        });
        return;
    }
    socket.destroy();
});

server.listen(SERVER_PORT, () => {
    console.log(`[HTTP] Server is listening on http://localhost:${SERVER_PORT}/`);
});
