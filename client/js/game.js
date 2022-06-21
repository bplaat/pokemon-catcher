function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

let ws = undefined, pokemons = [], spawns = [], players = [];

function send(type, data) {
    ws.send(JSON.stringify({ type, data }));
}

Vue.component('pokemon-item', {
    template: document.getElementById('pokemon-item-template').innerHTML,
    props: [ 'pokemon' ],
    data() {
        return {
            isDeleting: false
        };
    },
    methods: {
        deletePokemon() {
            this.$parent.$emit('deletePokemon', this.pokemon.uniqueId);
        }
    }
});

const app = new Vue({
    el: '#app',
    data: {
        page: 'connecting',
        connected: false,
        authed: false,
        player: { id: uuidv4(), name: '', pokemons: [] },
        pokemonsMax: undefined
    },

    created() {
        this.$on('deletePokemon', this.deletePokemon);
        this.connect();
    },

    watch: {
        player: {
            handler(player) {
                if (this.authed) {
                    send('player.update', { player });
                }
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
            this.page = 'auth';
            this.connected = true;
            if (localStorage.player != null) {
                this.player = JSON.parse(localStorage.player);
                send('player.connect', { player: this.player });
                players.push(this.player);
                this.page = 'game';
            }
        },

        onMessage(message) {
            const { type, data } = JSON.parse(message.data);
            console.log(type, data);

            if (type == 'info') {
                this.authed = true;
                pokemons = data.pokemons;
                spawns = data.spawns;
                this.pokemonsMax = data.pokemonsMax;
            }

            if (type == 'player.connect') {
                players.push(data.player);
            }

            if (type == 'player.update') {
                const player = players.find(player => player.id == data.player.id);
                player.name = data.player.name;
                player.pokemons = data.player.pokemons;
            }

            if (type == 'player.disconnect') {
                players = players.filter(player => player.id != data.player.id);
            }
        },

        onClose() {
            this.page = 'connection-close';
            this.connected = false;
        },

        authPlayer() {
            if (this.player.name.length >= 2 && this.player.name.length <= 32) {
                send('player.connect', { player: this.player });
                players.push(this.player);
                this.page = 'game';
            }
        },

        randomPokemon() {
            if (this.player.pokemons.length < this.pokemonsMax) {
                const pokemon = JSON.parse(JSON.stringify(pokemons[rand(0, pokemons.length)]));
                pokemon.uniqueId = uuidv4();
                pokemon.currentHealth = Math.floor(pokemon.health * (rand(1, 10) / 10));
                this.player.pokemons.unshift(pokemon);
            }
        },

        deletePokemon(uniqueId) {
            this.player.pokemons = this.player.pokemons.filter(pokemon => pokemon.uniqueId != uniqueId);
        }
    }
});
