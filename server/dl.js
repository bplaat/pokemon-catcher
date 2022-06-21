// A script the downloads all pokemon info and images we need to a json file
import fs from 'fs';

const pokemons = [];
const lastId = 649;
for (let id = 1; id <= lastId; id++) {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}/`);
    const pokemon = await response.json();
    pokemons.push({
        id,
        name: pokemon.name.charAt(0).toUpperCase() + pokemon.name.substring(1),
        health: pokemon.stats.find(stat => stat.stat.name == 'hp').base_stat * 2,
        attack: pokemon.stats.find(stat => stat.stat.name == 'attack').base_stat,
        defense: pokemon.stats.find(stat => stat.stat.name == 'defense').base_stat
    });

    const imageResponse = await fetch(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`);
    fs.writeFileSync(`../client/images/pokemons/${id}.png`, new Buffer(await imageResponse.arrayBuffer()));

    console.log((id / lastId * 100).toFixed(2) + '%');
}
fs.writeFileSync('pokemons.json', JSON.stringify(pokemons));
