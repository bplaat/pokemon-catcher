// Utils
function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

function radians(x) {
    return x * Math.PI / 180;
}

function crow(lat1, lon1, lat2, lon2) {
    var R = 6371; // km
    var dLat = radians(lat2-lat1);
    var dLon = radians(lon2-lon1);
    var lat1 = radians(lat1);
    var lat2 = radians(lat2);
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    var d = R * c;
    return d * 1000; // km -> m
}

function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + ' s';
    if (s < 60 * 60) return Math.floor(s / 60) + ' m';
    return Math.floor(s / 3600) + ' h';
}

// Global state
let ws = undefined, pokemons = [], spawns = [];
function send(type, data) {
    ws.send(JSON.stringify({ type, data }));
}

// Pokemon item component
Vue.component('pokemon-item', {
    template: document.getElementById('pokemon-item-template').innerHTML,
    props: { 'player': {}, 'pokemon': {}, 'actions': { default() { return true } }, 'inline': { default() { return false } } },
    data() {
        return {
            isDeleting: false
        };
    },
    methods: {
        healPokemon() {
            this.$parent.$emit('healPokemon', this.pokemon.uniqueId);
        },
        levelPokemon() {
            this.$parent.$emit('levelPokemon', this.pokemon.uniqueId);
        },
        deletePokemon() {
            this.$parent.$emit('deletePokemon', this.pokemon.uniqueId);
        }
    }
});

// Main game component
const app = new Vue({
    el: '#app',
    data: {
        page: 'connecting',
        connected: false,
        tracking: false,
        spawnsMapCreated: false,
        isCatching: false,
        hasCatched: false,
        player: { id: uuidv4(), name: '', admin: false, pokemons: [], doneSpawns: [] },
        otherPlayers: [],
        pokemonsMax: undefined,
        pendingSpawns: [],
        catchSound: undefined,

        isBattling: false,
        battlePlayer: undefined,
        isAttacking: false,
        playerPokemonId: undefined,
        playerThrow: undefined,
        battlePlayerPokemonId: undefined,
        battlePlayerThrow: undefined
    },

    created() {
        this.$on('healPokemon', this.healPokemon);
        this.$on('levelPokemon', this.levelPokemon);
        this.$on('deletePokemon', this.deletePokemon);
        this.connect();
    },

    watch: {
        player: {
            handler(player) {
                localStorage.setItem('player', JSON.stringify(player));
            },
            deep: true
        }
    },

    methods: {
        connect() {
            if (window.location.hostname == 'pokemon-catcher.ml' || window.location.hostname == 'pokemon-catcher-game.netlify.app') {
                ws = new WebSocket('wss://pokemon-catcher-game.herokuapp.com/ws');
            } else {
                ws = new WebSocket('ws://localhost:8080/ws');
            }
            ws.onopen = this.onOpen.bind(this);
            ws.onmessage = this.onMessage.bind(this);
            ws.onclose = this.onClose.bind(this);
            ws.onerror = this.onClose.bind(this);
        },

        onOpen() {
            this.connected = true;
            if (localStorage.getItem('player') != null) {
                this.player = JSON.parse(localStorage.getItem('player'));
                if (this.player.doneSpawns == undefined) this.player.doneSpawns = [];
                send('player.connect', { player: this.player });
            } else {
                this.page = 'auth';
            }
        },

        onMessage(message) {
            const { type, data } = JSON.parse(message.data);

            if (type == 'info') {
                pokemons = data.pokemons;
                spawns = data.spawns;
                this.pokemonsMax = data.pokemonsMax;
                this.page = 'init';
            }

            if (type == 'player.connect') {
                this.otherPlayers.push(data.player);
            }

            if (type == 'player.update') {
                if (this.player.id == data.player.id) {
                    this.player.name = data.player.name;
                    this.player.admin = data.player.admin;
                    this.player.pokemons = data.player.pokemons;
                } else {
                    const otherPlayer = this.otherPlayers.find(player => player.id == data.player.id);
                    otherPlayer.name = data.player.name;
                    otherPlayer.admin = data.player.admin;
                    otherPlayer.pokemons = data.player.pokemons;
                }
            }

            if (type == 'player.sound') {
                if (data.sound == 'heal') new Audio('/sounds/heal.mp3').play();
                if (data.sound == 'level') new Audio('/sounds/level.mp3').play();
                if (data.sound == 'battle-start') new Audio('/sounds/battle-start.mp3').play();
                if (data.sound == 'battle-end') new Audio('/sounds/battle-end.mp3').play();
            }

            if (type == 'player.disconnect') {
                this.otherPlayers = this.otherPlayers.filter(player => player.id != data.player.id);
            }
        },

        onClose() {
            this.page = 'connection-close';
            this.connected = false;
        },

        initGame() {
            this.page = 'game';
            new Audio('/sounds/intro.mp3').play();
            this.requestLocation();
        },

        requestLocation() {
            navigator.geolocation.watchPosition(this.onLocationUpdate.bind(this));
        },

        createSpawnsMap() {
            const bounds = new L.LatLngBounds();
            for (const spawn of spawns) {
                bounds.extend([ spawn.latitude, spawn.longitude ]);
            }
            const map = L.map(this.$refs.spawnsMap).fitBounds(bounds);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);

            for (const spawn of spawns) {
                L.circle([ spawn.latitude, spawn.longitude ], { radius: spawn.radius }).addTo(map);
                L.marker([ spawn.latitude, spawn.longitude ]).addTo(map)
                    .bindPopup(`
                        <b>${spawn.name}</b><br>
                        ${spawn.latitude.toFixed(6)}, ${spawn.longitude.toFixed(6)}<br>
                        Timeout: ${formatDuration(spawn.timeout)}
                    `);
            }
        },

        onLocationUpdate(event) {
            this.tracking = true;
            const latitude = event.coords.latitude;
            const longitude = event.coords.longitude;

            this.player.doneSpawns = this.player.doneSpawns.filter(otherSpawn => (Date.now() - otherSpawn.time) < otherSpawn.timeout);
            for (const spawn of spawns) {
                if (crow(spawn.latitude, spawn.longitude, latitude, longitude) <= spawn.radius) {
                    const doneSpawn = this.player.doneSpawns.find(otherSpawn => otherSpawn.id == spawn.id);
                    const pendingSpawn = this.pendingSpawns.find(otherSpawn => otherSpawn.id == spawn.id);
                    if (doneSpawn == undefined && pendingSpawn == undefined) {
                        new Audio('/sounds/intro.mp3').play();
                        this.pendingSpawns.push({ id: spawn.id, time: Date.now(), timeout: spawn.timeout });
                    }
                }
            }

            if (this.player.admin && !this.spawnsMapCreated) {
                this.spawnsMapCreated = true;
                setTimeout(this.createSpawnsMap.bind(this), 0); // Hacky
            }
        },

        authPlayer() {
            if (this.player.name.length >= 2 && this.player.name.length <= 32) {
                if (this.player.name == 'bplaat') {
                    this.player.admin = true;
                }
                this.page = 'game';
                new Audio('/sounds/intro.mp3').play();
                send('player.connect', { player: this.player });
            }
        },

        otherPlayerChangeName(otherPlayerId) {
            const otherPlayer = this.otherPlayers.find(player => player.id == otherPlayerId);
            send('player.update', { player: otherPlayer });
        },

        otherPlayerToggleAdmin(otherPlayerId) {
            const otherPlayer = this.otherPlayers.find(player => player.id == otherPlayerId);
            otherPlayer.admin = !otherPlayer.admin;
            send('player.update', { player: otherPlayer });
        },

        battleStart(otherPlayerId) {
            this.isBattling = true;
            this.battlePlayer = this.otherPlayers.find(player => player.id == otherPlayerId);
            this.isBattlePlayerAttacking = true;
            new Audio('/sounds/battle-start.mp3').play();
            send('player.sound', { player: { id: this.battlePlayer.id }, sound: 'battle-start' });
        },

        battleTurn() {
            const playerPokemon = this.player.pokemons.find(pokemon => pokemon.uniqueId == this.playerPokemonId);
            const battlePlayerPokemon = this.battlePlayer.pokemons.find(pokemon => pokemon.uniqueId == this.battlePlayerPokemonId);

            const playerThrow = Math.max(Math.min(parseInt(this.playerThrow), 6), 1);
            const battlePlayerThrow = Math.max(Math.min(parseInt(this.battlePlayerThrow), 6), 1);

            if (this.isBattlePlayerAttacking) {
                this.isBattlePlayerAttacking = false;

                playerPokemon.currentHealth -= Math.max(Math.floor(battlePlayerPokemon.attack / 6 * battlePlayerThrow) -
                    Math.floor(playerPokemon.defense / 6 * playerThrow), 0);
                if (playerPokemon.currentHealth < 0) {
                    playerPokemon.currentHealth = 0;
                }

                send('player.update', { player: this.player });

                if (playerPokemon.currentHealth == 0) {
                    this.playerPokemonId = undefined;
                }
            }
            else {
                this.isBattlePlayerAttacking = true;

                battlePlayerPokemon.currentHealth -= Math.max(Math.floor(playerPokemon.attack / 6 * playerThrow) -
                    Math.floor(battlePlayerPokemon.defense / 6 * battlePlayerThrow), 0);
                if (battlePlayerPokemon.currentHealth < 0) {
                    battlePlayerPokemon.currentHealth = 0;
                }

                send('player.update', { player: this.battlePlayer });

                if (battlePlayerPokemon.currentHealth == 0) {
                    this.battlePlayerPokemonId = undefined;
                }
            }

            this.playerThrow = undefined;
            this.battlePlayerThrow = undefined;
        },

        battleEnd() {
            if (this.battlePlayer == undefined) return;
            new Audio('/sounds/battle-end.mp3').play();
            send('player.sound', { player: { id: this.battlePlayer.id }, sound: 'battle-end' });
            this.isBattling = false;
            this.battlePlayer = undefined;
            this.playerPokemonId = undefined;
            this.battlePlayerPokemonId = undefined;
        },

        levelPokemonStats(pokemon) {
            if (pokemon.level >= 25) return;
            pokemon.level++;

            if (rand(1, 6) == 1) {
                const healthIncrease = rand(200, 400);
                pokemon.currentHealth += healthIncrease;
                pokemon.health += healthIncrease;
            } else {
                const healthIncrease = rand(100, 200);
                pokemon.currentHealth += healthIncrease;
                pokemon.health += healthIncrease;
            }

            if (rand(1, 6) == 1) {
                pokemon.attack += rand(50, 100)
            } else {
                pokemon.attack += rand(25, 50);
            }

            if (rand(1, 6) == 1) {
                pokemon.defense += rand(50, 100)
            } else {
                pokemon.defense += rand(25, 50);
            }
        },

        catchFirstSpawn() {
            if (this.hasCatched) {
                this.isCatching = false;
                if (catchSound != undefined && !catchSound.paused) {
                    catchSound.pause();
                }
                return;
            }

            if (this.pendingSpawns.length > 0) {
                const spawn = this.pendingSpawns.shift();
                this.player.doneSpawns.push(spawn);
            }

            const pokemon = { ...pokemons[rand(0, rand(1, 4) == 1 ? pokemons.length - 1 : 151)] };
            pokemon.uniqueId = uuidv4();
            pokemon.level = 1;
            for (let i = 0; i < (rand(1, 3) == 1 ? rand(2, rand(1, 4) == 1 ? 10 : 5) : 1) - 1; i++) {
                this.levelPokemonStats(pokemon);
            }
            pokemon.currentHealth = rand(1, 3) == 1 ? pokemon.health : rand(Math.floor(pokemon.health / 3 * 2), pokemon.health);
            this.player.pokemons.unshift(pokemon);
            send('player.update', { player: this.player });

            this.hasCatched = true;
            catchSound = new Audio('/sounds/catch.mp3');
            catchSound.play();
            setTimeout(() => {
                this.$refs.pokemonBall.animate([
                    { transform: 'translate(-50%, 150%) scale(0)' },
                    { offset: 0.25, transform: 'translate(-150%, 50%) scale(1.5)' },
                    { offset: 0.5, transform: 'translate(-50%, -25%) scale(0.75)' },
                    { offset: 0.75, transform: 'translate(50%, 50%) scale(0.5)' },
                    { transform: 'translate(-50%, 50%) scale(0)' }
                ], { duration: 7250 });

                this.$refs.pokemonItem.animate([
                    { offset: 0.75, transform: 'scale(0)' },
                    { transform: 'scale(1)' }
                ], { duration: 7500, fill: 'forwards' });
            }, 0); // Hacky
        },

        healPokemon(uniqueId) {
            const pokemon = this.player.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
            if (pokemon != undefined) {
                pokemon.currentHealth = pokemon.health;
                send('player.update', { player: this.player });
                new Audio('/sounds/heal.mp3').play();
            } else if (this.player.admin) {
                for (const otherPlayer of this.otherPlayers) {
                    const pokemon = otherPlayer.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
                    if (pokemon != undefined) {
                        pokemon.currentHealth = pokemon.health;
                        send('player.update', { player: otherPlayer });
                        send('player.sound', { player: { id: otherPlayer.id }, sound: 'heal' });
                    }
                }
            }
        },

        levelPokemon(uniqueId) {
            const pokemon = this.player.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
            if (pokemon != undefined) {
                this.levelPokemonStats(pokemon);
                send('player.update', { player: this.player });
                new Audio('/sounds/level.mp3').play();
            } else if (this.player.admin) {
                for (const otherPlayer of this.otherPlayers) {
                    const pokemon = otherPlayer.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
                    if (pokemon != undefined) {
                        this.levelPokemonStats(pokemon);
                        send('player.update', { player: otherPlayer });
                        send('player.sound', { player: { id: otherPlayer.id }, sound: 'level' });
                    }
                }
            }
        },

        deletePokemon(uniqueId) {
            const pokemonsLength = this.player.pokemons.length;
            this.player.pokemons = this.player.pokemons.filter(pokemon => pokemon.uniqueId != uniqueId);
            if (this.player.pokemons.length != pokemonsLength) {
                send('player.update', { player: this.player });
            } else if (this.player.admin) {
                for (const otherPlayer of this.otherPlayers) {
                    const pokemonsLength = otherPlayer.pokemons.length;
                    otherPlayer.pokemons = otherPlayer.pokemons.filter(pokemon => pokemon.uniqueId != uniqueId);
                    if (otherPlayer.pokemons.length != pokemonsLength) {
                        send('player.update', { player: otherPlayer });
                        break;
                    }
                }
            }
        }
    }
});
