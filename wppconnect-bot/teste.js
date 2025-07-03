import axios from 'axios'; // ✅

/**
 * Busca as informações completas do Pokémon na PokéAPI
 * @param {string} nome - Nome do Pokémon em minúsculas (ex: "pikachu")
 * @returns {Promise<object>} - Objeto com dados do Pokémon ou erro
 */
async function buscarPokemon(nome) {
    try {
        // 1. Busca os dados básicos do Pokémon (altura, peso, tipos)
        const urlPokemon = `https://pokeapi.co/api/v2/pokemon/${nome}`;
        const resPokemon = await axios.get(urlPokemon);
        const dataPokemon = resPokemon.data;

        // Altura (em decímetros) e Peso (em hectogramas)
        const altura = dataPokemon.height / 10; // em metros
        const peso = dataPokemon.weight / 10; // em kg

        // Tipos (ex: ["electric"])
        const tipos = dataPokemon.types.map(t => t.type.name);

        // 2. Busca a cor do Pokémon (API diferente)
        const urlSpecies = `https://pokeapi.co/api/v2/pokemon-species/${nome}`;
        const resSpecies = await axios.get(urlSpecies);
        const cor = resSpecies.data.color.name; // ex: "yellow"

        // 3. Para cada tipo, busca vantagens e fraquezas
        const vantagensSet = new Set();
        const fraquezasSet = new Set();

        for (const tipo of tipos) {
            const urlTipo = `https://pokeapi.co/api/v2/type/${tipo}`;
            const resTipo = await axios.get(urlTipo);
            const damage = resTipo.data.damage_relations;

            // Tipos contra os quais este Pokémon causa dano dobrado (vantagens)
            damage.double_damage_to.forEach(t => vantagensSet.add(t.name));
            // Tipos que causam dano dobrado a este Pokémon (fraquezas)
            damage.double_damage_from.forEach(t => fraquezasSet.add(t.name));
        }

        // Transformar sets em arrays ordenados
        const vantagens = Array.from(vantagensSet).sort();
        const fraquezas = Array.from(fraquezasSet).sort();

        return {
            sucesso: true,
            altura: `${altura} m`,
            peso: `${peso} kg`,
            cor,
            tipos,
            vantagens,
            fraquezas
        };

    } catch (error) {
        console.error('[ERRO] buscarPokemon:', error.message);
        return {
            sucesso: false,
            erro: `Não consegui encontrar informações para o Pokémon "${nome}". Verifique o nome e tente novamente.`
        };
    }
}


const resultado = await buscarPokemon('pikachu');

if (resultado.sucesso) {
    console.log('Altura:', resultado.altura);
    console.log('Peso:', resultado.peso);
    console.log('Cor:', resultado.cor);
    console.log('Tipos:', resultado.tipos.join(', '));
    console.log('Vantagens:', resultado.vantagens.join(', '));
    console.log('Fraquezas:', resultado.fraquezas.join(', '));
} else {
    console.log('Erro:', resultado.erro);
}
