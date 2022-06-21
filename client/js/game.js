// Utils
function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
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
        player: { id: uuidv4(), name: '', admin: false, pokemons: [] },
        otherPlayers: [],
        pokemonsMax: undefined
    },

    created() {
        this.$on('revivePokemon', this.revivePokemon);
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
            if (localStorage.player != null) {
                this.page = 'game';
                this.player = JSON.parse(localStorage.player);
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

        authPlayer() {
            if (this.player.name.length >= 2 && this.player.name.length <= 32) {
                this.page = 'game';
                send('player.connect', { player: this.player });
            }
        },

        randomPokemon() {
            if (this.player.pokemons.length < this.pokemonsMax) {
                const pokemon = JSON.parse(JSON.stringify(pokemons[rand(0, pokemons.length)]));
                pokemon.uniqueId = uuidv4();
                pokemon.currentHealth = Math.floor(pokemon.health * (rand(1, 10) / 10));
                this.player.pokemons.unshift(pokemon);
                send('player.update', { player: this.player });
            }
        },

        revivePokemon(uniqueId) {
            const pokemon = this.player.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
            if (pokemon != null) {
                pokemon.currentHealth = pokemon.health;
                send('player.update', { player: this.player });
            } else if (this.player.admin) {
                for (const otherPlayer of this.otherPlayers) {
                    const pokemon = otherPlayer.pokemons.find(pokemon => pokemon.uniqueId == uniqueId);
                    if (pokemon != null) {
                        pokemon.currentHealth = pokemon.health;
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
