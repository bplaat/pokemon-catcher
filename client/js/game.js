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
    return d * 1000;
}

// Global state
let ws = undefined, pokemons = [], spawns = [];
function send(type, data) {
    console.log('SEND', type, data);
    ws.send(JSON.stringify({ type, data }));
}

// Pokemon item component
Vue.component('pokemon-item', {
    template: document.getElementById('pokemon-item-template').innerHTML,
    props: [ 'player', 'pokemon' ],
    data() {
        return {
            isDeleting: false
        };
    },
    methods: {
        revivePokemon() {
            this.$parent.$emit('revivePokemon', this.pokemon.uniqueId);
        },
        upgradePokemon() {
            this.$parent.$emit('upgradePokemon', this.pokemon.uniqueId);
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
        authed: false,
        tracking: false,
        player: { id: uuidv4(), name: '', admin: false, pokemons: [], doneSpawns: [] },
        otherPlayers: [],
        pokemonsMax: undefined,
        pendingSpawns: []
    },

    created() {
        this.$on('revivePokemon', this.revivePokemon);
        this.$on('upgradePokemon', this.upgradePokemon);
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
                this.page = 'game';
                this.player = JSON.parse(localStorage.getItem('player'));
                if (this.player.doneSpawns == undefined) this.player.doneSpawns = [];
                send('player.connect', { player: this.player });
            } else {
                this.page = 'auth';
            }
        },

        onMessage(message) {
            const { type, data } = JSON.parse(message.data);
            console.log('RECEIVE', type, data);

            if (type == 'info') {
                this.authed = true;
                pokemons = data.pokemons;
                spawns = data.spawns;
                this.pokemonsMax = data.pokemonsMax;
                navigator.geolocation.watchPosition(this.onLocationUpdate.bind(this));
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

            if (type == 'player.disconnect') {
                this.otherPlayers = this.otherPlayers.filter(player => player.id != data.player.id);
            }
        },

        onClose() {
            this.page = 'connection-close';
            this.connected = false;
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
                        this.pendingSpawns.push({ id: spawn.id, time: Date.now(), timeout: spawn.timeout });
                    }
                }
            }
        },

        authPlayer() {
            if (this.player.name.length >= 2 && this.player.name.length <= 32) {
                this.page = 'game';
                send('player.connect', { player: this.player });
            }
        },

        catchFirstSpawn() {
            const spawn = this.pendingSpawns.shift();
            this.player.doneSpawns.push(spawn);

            const pokemon = { ...pokemons[rand(0, pokemons.length)] };
            pokemon.uniqueId = uuidv4();
            pokemon.level = 1;
            pokemon.currentHealth = pokemon.health;
            this.player.pokemons.unshift(pokemon);
            send('player.update', { player: this.player });
        },

        revivePokemon(uniqueId) {
            const pokemon = this.player.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
            if (pokemon != undefined) {
                pokemon.currentHealth = pokemon.health;
                send('player.update', { player: this.player });
            } else if (this.player.admin) {
                for (const otherPlayer of this.otherPlayers) {
                    const pokemon = otherPlayer.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
                    if (pokemon != undefined) {
                        pokemon.currentHealth = pokemon.health;
                        send('player.update', { player: otherPlayer });
                    }
                }
            }
        },

        upgradePokemonStats(pokemon) {
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

        upgradePokemon(uniqueId) {
            const pokemon = this.player.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
            if (pokemon != undefined) {
                this.upgradePokemonStats(pokemon);
                send('player.update', { player: this.player });
            } else if (this.player.admin) {
                for (const otherPlayer of this.otherPlayers) {
                    const pokemon = otherPlayer.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
                    if (pokemon != undefined) {
                        this.upgradePokemonStats(pokemon);
                        send('player.update', { player: otherPlayer });
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
