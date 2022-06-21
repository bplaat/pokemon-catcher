// The Pokemon Catcher message broker server
// The server protocol is super simple but not very safe or effiecent: but who cares...
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';

// Utils
function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

// Config
const SERVER_PORT = process.env.PORT || 8080;
const POKEMONS_MAX = 12;

// Load data
const pokemons = JSON.parse(readFileSync('pokemons.json'));

const spawns = [
    { id: uuidv4(), name: 'Post 1', latitude: 52.005302938354355, longitude: 4.751652132282453, radius: 25, timeout: 60 * 1000 },
    { id: uuidv4(), name: 'Post 2', latitude: 52.005117123634726, longitude: 4.7539506386986075, radius: 25, timeout: 60 * 1000 }
];

// Websocket server
const wss = new WebSocketServer({ noServer: true });
let clients = [];
wss.on('connection', ws => {
    let playerId = undefined;
    function send(type, data) {
        ws.send(JSON.stringify({ type, data }));
    }
    function broadcast(type, data) {
        for (const client of clients) {
            if (client.player.id != playerId) {
                client.ws.send(JSON.stringify({ type, data }));
            }
        }
    }

    ws.on('message', message => {
        const { type, data } = JSON.parse(message.toString());
        console.log('[WS]', playerId, type, data);

        if (type == 'player.connect') {
            const client = clients.find(client => client.player.id == data.player.id);
            if (client != null) client.ws.close();

            playerId = data.player.id;
            send('info', { pokemons, spawns, pokemonsMax: POKEMONS_MAX });
            for (const client of clients) {
                console.log(client.player)
                send('player.connect', { player: client.player });
            }
            clients.push({ player: data.player, ws });
            broadcast('player.connect', { player: data.player });
        }

        if (type == 'player.update') {
            const client = clients.find(client => client.player.id == playerId);
            const otherClient = clients.find(client => client.player.id == data.player.id);
            if (otherClient == null) return;
            if (!(data.player.id == playerId || client.player.admin)) return;

            otherClient.player.name = data.player.name;
            otherClient.player.admin = data.player.admin;
            otherClient.player.pokemons = data.player.pokemons;
            broadcast('player.update', { player: data.player });
        }
    });

    ws.on('close', () => {
        if (playerId != undefined) {
            clients = clients.filter(client => client.player.id != playerId);
            broadcast('player.disconnect', { player: { id: playerId } });
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
