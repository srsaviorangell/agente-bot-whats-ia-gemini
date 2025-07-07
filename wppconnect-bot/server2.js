require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env
const express = require('express'); // Framework para criar o servidor web
const axios = require('axios'); // Para requisições HTTP (usado para enviar mensagens)
const { create } = require('@wppconnect-team/wppconnect'); // Biblioteca para integração com WhatsApp
// const OpenAI = require('openai'); // REMOVIDO: Não precisaremos mais do SDK da OpenAI
const { GoogleGenerativeAI } = require('@google/generative-ai'); // ADICIONADO: SDK do Google Gemini

// Inicializa o servidor Express
const app = express();
const port = process.env.PORT || 3000; // Usa a porta do .env ou 3000

const userContexts = {}; // Objeto para armazenar o contexto de cada usuário
function getUserContext(from) {
    if (!userContexts[from]) {
        userContexts[from] = {
            lastPokemon: null // Armazena o último Pokémon discutido com este usuário
        };
    }
    return userContexts[from];
}

// Middleware para parsear JSON e logs de requisições HTTP
app.use(express.json());
app.use((req, res, next) => {
    console.info(`[${new Date().toLocaleString('pt-BR')}] ${req.method} ${req.path}`);
    next();
});

// REMOVIDO: Configuração do cliente OpenRouter
// const openrouterClient = new OpenAI({ ... });

// ADICIONADO: Configuração do cliente Google Gemini
// A chave da API é lida do .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Corrigido o nome do modelo para 'gemini-2.0-flash'
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Usando o modelo gemini-2.0-flash

// ==============================================
// FUNÇÕES AUXILIARES
// ==============================================

/**
 * Formata números no padrão brasileiro
 * @param {number} numero - Valor a ser formatado
 * @returns {string} Número formatado (ex: 1.234,56)
 */
function formatarNumeroBR(numero) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'decimal',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(numero);
}

/**
 * Chama a API do Google Gemini via SDK
 * @param {string} prompt - Texto para enviar à IA
 * @returns {Promise<string>} Resposta da IA
 */
async function chamarGeminiSDK(prompt) {
    console.debug('[DEBUG] Enviando para Gemini:', prompt.substring(0, Math.min(prompt.length, 100)) + '...');

    try {
        // O Gemini SDK usa generateContent diretamente com o prompt de texto
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        let text = response.text(); // Extrai o texto da resposta
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
        const match = text.match(jsonBlockRegex);
        if (match && match[1]) {
            text = match[1].trim(); // Pega apenas o conteúdo dentro do bloco ```json
        } else {
            // Se não encontrar o bloco ```json```, tenta remover apenas ``` se houver
            text = text.replace(/```/g, '').trim();
        }

        console.debug('[DEBUG] Resposta do Gemini:', text?.substring(0, Math.min(text.length, 100)) + '...');
        return text || 'Desculpe, não consegui gerar uma resposta. Pode reformular?';
    } catch (error) {
        console.error('[ERRO] Gemini AI:', {
            message: error.message,
            // Detalhes de erro do Gemini podem ser diferentes da OpenRouter.
            // Para depuração, você pode logar o objeto de erro completo:
            // errorObject: error
        });
        // Propaga o erro para ser tratado pela função chamadora
        throw error;
    }
}

/**
 * Envia uma mensagem de texto via WPPConnect (usando o servidor local)
 * @param {string} para - Número do destinatário (ex: 5511999999999@c.us)
 * @param {string} texto - Conteúdo da mensagem
 * @returns {Promise<any>} Resposta da API de envio
 */
async function enviarMensagem(para, texto) {
    try {
        // Delay para evitar flood no WhatsApp e dar tempo para processar
        await new Promise(resolve => setTimeout(resolve, 1000));

        // URL do servidor local que envia mensagens (ajuste se for diferente)
        const url = 'http://localhost:21465/api/send-message';
        const response = await axios.post(url, {
            phone: para,
            message: texto,
            waitForAck: true, // Opcional: espera confirmação de entrega
            ...(texto.length > 160 && { format: 'full' }) // Envia como mensagem completa se for muito longa
        });

        console.info(`[INFO] Mensagem enviada para ${para}`);
        return response.data;
    } catch (error) {
        console.error('[ERRO] Falha ao enviar mensagem:', {
            numero: para,
            erro: error.message,
            stack: error.stack
        });
        // Propaga o erro para ser tratado pela função chamadora
        throw error;
    }
}

/**
 * Processa a mensagem recebida e decide a resposta (comandos internos ou IA)
 * @param {string} mensagemRecebida - Texto recebido do usuário
 * @returns {Promise<string>} Resposta para o usuário
 */
async function processarMensagem(mensagemRecebida, context) {
    console.debug('[DEBUG] Processando mensagem:', mensagemRecebida);

    // 1. Primeiro verifica comandos internos

    const msg = mensagemRecebida.toLowerCase().trim();
    let pokemonNomeParaContexto = null;
    const palavrasChaveTudo = ['tudo', 'mais', 'completo', 'infor']; // Pode adicionar outras palavras-chave

    if (palavrasChaveTudo.includes(msg) && context.lastPokemon) {
        pokemonNomeParaContexto = context.lastPokemon;
    }
    const promptParaGemini = ` 
          SUA ÚNICA RESPOSTA DEVE SER UM OBJETO JSON VÁLIDO.
            NÃO INCLUA NENHUM TEXTO, SAUDAÇÃO, EXPLICAÇÃO OU FORMATAÇÃO ADICIONAL, APENAS O JSON PURO.
            Analise a seguinte "Frase do usuário" para determinar o pedido.

            // --- Nova Intenção: Sugestão de Pokémon ---
            Se a frase for um pedido para "sugerir", "dar nomes de", "me fala X pokemons" ou "quais pokemons do tipo Y", retorne o JSON assim:
            {
              "acao": "sugerir_pokemon",
              "quantidade": [número identificado na frase (ex: "5"), ou 1 se não especificado, ou null se não houver um número claro],
              "tipo": "[nome do tipo em INGLÊS e em minúsculas (ex: "fire", "water", "grass", "electric", "psychic", etc.), ou null se não especificado]" // <-- MUDANÇA AQUI
            }
            Exemplos de saída para sugestão:
            - Frase: "Me dá 3 pokemons do tipo água" -> {"acao": "sugerir_pokemon", "quantidade": 3, "tipo": "water"} // <-- EXEMPLO REFORÇANDO
            - Frase: "Sugere um pokemon de planta" -> {"acao": "sugerir_pokemon", "quantidade": 1, "tipo": "grass"} // <-- EXEMPLO REFORÇANDO
            - Frase: "Nome de 5 pokemons" -> {"acao": "sugerir_pokemon", "quantidade": 5, "tipo": null}

            // --- Intenção Existente: Consulta de Pokémon Específico ---
            Se a frase for sobre um Pokémon ESPECÍFICO e pedir informações sobre ele (não uma sugestão genérica), retorne um JSON com:
            - "ePokemon": true
            - "nome": o nome do Pokémon IDENTIFICADO NA FRASE do usuário, em minúsculas e formato que a PokeAPI reconheça (singular, sem acentos, etc.).
                ${pokemonNomeParaContexto ? `Se a frase for curta (ex: "tudo") e o usuário está pedindo mais informações sobre o Pokémon do contexto, use "${pokemonNomeParaContexto}".` : ''}
                Se não houver um nome CLARO ou inferível de Pokémon, deixe como null.
            - "perguntas": um array com os tópicos específicos que o usuário deseja saber (ex: "cor", "altura", "peso", "vantagens", "fraquezas", "tipo").
                - Se o usuário perguntar "qual tributo [pokemon]", inclua "tipo" no array "perguntas".
                - Se a frase for "tudo" ou similar (e já houver um Pokémon no contexto), ou se o usuário não especificar perguntas, o array "perguntas" deve estar vazio.
            - "responderCompleto": true se a frase for "tudo" ou similar (e já houver um Pokémon no contexto), ou se o usuário pedir "tudo sobre" o Pokémon explicitamente, OU SE AS "perguntas" ESTIVEREM VAZIAS. Caso contrário, false.

            // --- Intenção de Não-Pokémon ---
            Se a frase NÃO for sobre Pokémon (nem consulta específica, nem sugestão), ou você não conseguir identificar nada válido, retorne um JSON com:
            - "ePokemon": false

            ---
            Frase do usuário: "${msg}"
            ---
            JSON de saída:
    `; // Fecha a template string aqui

    const respostaIA = await chamarGeminiSDK(promptParaGemini)

    try {
        const dados = JSON.parse(respostaIA);

          if (dados.acao === "sugerir_pokemon") {
            const sugestoes = await buscarSugestoesPokemon(dados.quantidade, dados.tipo);
            if (sugestoes.sucesso) {
                context.lastPokemon = null; // Limpa o contexto, pois não é sobre um Pokémon específico
                return `Aqui estão algumas sugestões de Pokémon${dados.tipo ? ` do tipo ${dados.tipo}` : ''}:\n\n${sugestoes.nomes.map(n => `- ${n.charAt(0).toUpperCase() + n.slice(1)}`).join('\n')}\n\nPosso ajudar com mais alguma coisa?`;
            } else {
                context.lastPokemon = null;
                return sugestoes.erro; // Retorna a mensagem de erro da função de sugestão
            }
        }
         if (!dados.ePokemon) {
            // Limpa o contexto do último Pokémon se a IA não identificar um Pokémon
            context.lastPokemon = null; 
            return "Desculpe, só consigo ajudar com informações sobre Pokémon no momento. Poderia perguntar sobre um Pokémon?";
        }
        if (dados.nome) {
            context.lastPokemon = dados.nome;
        }
        // Aqui você chamaria sua função que busca essas informações:
        const info = await buscarPokemon(dados.nome);

        if (!info.sucesso) {
            return info.erro;
        }

        let resposta = `🔍 Informações sobre o Pokémon ${dados.nome}:\n`;
        let followUpQuestion= '';


        // Verifica quais atributos ele quer (ou todos, se responderCompleto for true)
        const atributos = dados.responderCompleto
            ? ["cor", "altura", "peso", "tipo", "vantagens", "fraquezas"]
            : dados.perguntas;

        if (atributos.includes("cor")) resposta += `🎨 Cor: ${info.cor}\n`;
        if (atributos.includes("altura")) resposta += `📏 Altura: ${info.altura}\n`;
        if (atributos.includes("peso")) resposta += `⚖️ Peso: ${info.peso}\n`;
        if (atributos.includes("tipo")) resposta += `💠 Tipo(s): ${info.tipos.join(", ")}\n`;
        if (atributos.includes("vantagens")) resposta += `✅ Vantagens contra: ${info.vantagens.join(", ")}\n`;
        if (atributos.includes("fraquezas")) resposta += `❌ Fraco contra: ${info.fraquezas.join(", ")}\n`;

        resposta += '\n';
        // Lógica para a pergunta de continuação
        if (dados.responderCompleto) {
            followUpQuestion = `Espero que estas informações completas sobre o ${dados.nome} sejam úteis! Há algo mais em que posso ajudar ou outro Pokémon que você gostaria de pesquisar?`;
        } else if (dados.perguntas.length > 0) { // Se perguntas específicas foram feitas
            // Identifica quais atributos NÃO foram perguntados mas estão disponíveis
            const allAvailableAttributes = ["cor", "altura", "peso", "tipo", "vantagens", "fraquezas"];
            const unaskedAttributes = allAvailableAttributes.filter(attr => !dados.perguntas.includes(attr));

            if (unaskedAttributes.length > 0) {
                 // Formata a lista de sugestões (ex: "cor, altura, ou peso")
                 const suggestions = unaskedAttributes.join(', ').replace(/, ([^,]*)$/, ' ou $1');
                 followUpQuestion = `Gostaria de saber mais sobre outros atributos do ${dados.nome}, como ${suggestions}?`;
            } else { // Todas as informações disponíveis foram pedidas
                followUpQuestion = `Espero ter ajudado com as informações sobre o ${dados.nome}! Há mais algo que você queira perguntar ou outro Pokémon?`;
            }
        } else { // Caso fallback (não deveria ocorrer com prompt atualizado de responderCompleto)
            followUpQuestion = `O que mais você gostaria de saber sobre o ${dados.nome}?`;
        }

        return resposta + followUpQuestion;

    } catch (err) {
        console.error('[ERRO] IA não retornou JSON válido:', respostaIA,err);
        return "Tive dificuldade para entender sua pergunta. Pode repetir com outras palavras?";
    }
}


/**
 * Busca as informações completas do Pokémon na PokéAPI
 * @param {string} nome - Nome do Pokémon em minúsculas (ex: "pikachu")
 * @returns {Promise<object>} - Objeto com dados do Pokémon ou erro
 */

async function buscarPokemon(nome) {
    try{
        const urlPokemon = `https://pokeapi.co/api/v2/pokemon/${nome}`;
        const resPokemon = await  axios.get(urlPokemon);
        const dataPokemon = resPokemon.data;

        const altura = dataPokemon.height / 10;
        const peso = dataPokemon.weight /10;
        const tipos = dataPokemon.types.map(t =>t.type.name);
        const urlSpecies = ` https://pokeapi.co/api/v2/pokemon-species/${nome}`;
        const resSpecies = await axios.get(urlSpecies);
        const cor = resSpecies.data.color.name;

        const vantagensSet = new Set();
        const fraquezasSet = new Set();

        for (const tipo of tipos){
            const urlTipo = `https://pokeapi.co/api/v2/type/${tipo}`;
            const resTipo = await axios.get(urlTipo);
            const damage = resTipo.data.damage_relations;
            damage.double_damage_to.forEach(t => vantagensSet.add(t.name));
            damage.double_damage_from.forEach(t => fraquezasSet.add(t.name));

        }
    const vantagens = Array.from(vantagensSet).sort();
    const fraquezas = Array.from(fraquezasSet).sort();

    return{
        sucesso:true,
        altura: `${altura}m`,
        peso: `${peso}kg`,
        cor,
        tipos,
        vantagens,
        fraquezas
    };

    }catch (error) {
        console.error('[ERRO] buscarPokemon:', error.message);
        return {
            sucesso: false,
            erro: `Não consegui encontrar informações para o Pokémon "${nome}". Verifique o nome e tente novamente.`
        };
    }
}
/**
 * @param {number}quantidade
 * @param {string|null} tipo
 * @returns {promise<object>}
 */

async function buscarSugestoesPokemon(quantidade = 1 ,tipo = null) {
    try{
        let pokemonNames = [];

        if(tipo){
            const typeUrl = `https://pokeapi.co/api/v2/type/${tipo.toLowerCase()}`;
            const typeRes = await axios.get(typeUrl);
            const pokemonsInType = typeRes.data.pokemon.map(p => p.pokemon.name);
            pokemonNames = pokemonsInType.slice(0,quantidade);

        }else {
            const allPokemonsUrl = `https://pokeapi.co/api/v2/pokemon?limit=${quantidade}`;
            const allPokemonsRes = await axios.get(allPokemonsUrl);
            pokemonNames = allPokemonsRes.data.results.map(p => p.name);

        }

        if (pokemonNames.length === 0){
            return { sucesso: false, erro: "Não consegui encontrar Pokémons com esses critérios." };

        }
        return { sucesso: true, nomes: pokemonNames };

    }catch (error) {
        console.error('[ERRO] buscarSugestoesPokemon:', error.message);
        // Retorna um erro amigável se o tipo não existir, por exemplo
        if (error.response && error.response.status === 404) {
             return { sucesso: false, erro: `Não encontrei o tipo "${tipo}". Verifique se o nome está correto.` };
        }
        return { sucesso: false, erro: "Ocorreu um erro ao buscar sugestões de Pokémon." };
    }
}

async function verificarConexaoGemini() {
    console.info('🔍 Verificando conexão com Google Gemini...');
    try {
        // Usa o modelo Gemini 2.0 Flash para um teste simples
        const testModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Corrigido o nome do modelo
        const result = await testModel.generateContent("Olá, Gemini. Responda apenas 'OK'");
        const response = await result.response;
        const text = response.text();

        const status = text.trim() === 'OK';
        console.info(status ? '✅ Conexão Google Gemini OK!' : '⚠️ Resposta inesperada do Gemini.');
        return status;
    } catch (error) {
        console.error('❌ Falha na conexão com Google Gemini:', error.message);
        return false;
    }
}

/**
 * Envia uma mensagem para todos os contatos individuais (DM)
 * @param {object} client - Instância do cliente WPPConnect.
 */
async function enviarParaContatosSeguro(client) {
    try {
        console.info('📋 Obtendo chats individuais para envio...');
        const chats = await client.getAllChats();
        const contatosIndividuais = chats.filter(chat => {
            // Filtra apenas chats individuais que não são de grupo e não são status
            return !chat.isGroup && !chat.isStatus;
        });

        console.info(`📋 ${contatosIndividuais.length} contatos individuais válidos encontrados.`);

        for (const contato of contatosIndividuais) {
            try {
                const mensagemParaEnviar = "Olá! Esta é uma mensagem de teste do meu bot. Como você está?"; // Personalize sua mensagem aqui
                console.info(`✉️ Enviando para: ${contato.name || contato.id.user}`);

                await client.sendText(
                    contato.id._serialized,
                    mensagemParaEnviar
                );

                // Delay importante para evitar bloqueio por flood
                await new Promise(resolve => setTimeout(resolve, 2500));

            } catch (error) {
                console.error(`[ERRO] Falha ao enviar para ${contato.id.user}:`, error.message);
            }
        }
        console.info('✅ Envio para todos os contatos concluído.');
    } catch (error) {
        console.error('[ERRO GERAL] Falha ao enviar para contatos:', error);
    }
}

// ==============================================
// INICIALIZAÇÃO DO SISTEMA
// ==============================================

// Declara a variável server fora do escopo do app.listen
let server;

// Inicia o servidor Express
server = app.listen(port, async () => { // Atribui a instância do servidor à variável server
    console.info(`🚀 Servidor rodando na porta ${port}`);
    console.info(`Modo: ${process.env.NODE_ENV || 'desenvolvimento'}`);
    console.info(`Modelo IA: gemini-2.0-flash`); // Agora é fixo para Gemini 2.0 Flash

    // 1. Verifica a conexão com o Google Gemini antes de iniciar o WhatsApp
    const geminiStatus = await verificarConexaoGemini();
    if (!geminiStatus) {
        console.error('❌ Não foi possível estabelecer conexão com o Google Gemini. O bot de IA não funcionará.');
        // Você pode optar por encerrar o processo aqui se a IA for essencial: process.exit(1);
    }

    // 2. Inicia a sessão do WPPConnect
    create({
        session: 'whatsapp-bot', // Nome da sessão do WhatsApp
        headless: true, // Roda o navegador em segundo plano
        puppeteerOptions: { args: ['--no-sandbox'] }, // Necessário para alguns ambientes
        disableWelcome: true, // Desativa a mensagem de boas-vindas
        logQR: true, // Mostra o QR Code no console
        catchQR: (base64Qr, asciiQR) => {
            console.info('=== ESCANEIE O QR CODE PARA CONECTAR ===');
            console.info(asciiQR); // QR Code em texto para escanear
        },
        statusFind: (statusSession) => {
            console.info('Status da sessão WhatsApp:', statusSession);
        },
        onLoading: (percent, message) => {
            console.info(`Carregando WhatsApp: ${percent}% - ${message}`);
        },
        // Configurações para ignorar status e evitar verificações desnecessárias
        updateCheckInterval: 0,
        disableAutoStatus: true,
        disableAutoStatusSave: true
    })
    .then((client) => {
        console.info('✅ WhatsApp conectado com sucesso!');

        // Handler de mensagens recebidas
        client.onMessage(async (message) => {
            // Verifica se é mensagem de grupo, status ou newsletter
            const isNewsletter = message.from.endsWith('@newsletter'); // Verifica se é newsletter
            if (message.isGroupMsg || message.isStatus || isNewsletter ||  !message.body || message.body.trim() === '') {
        console.debug(`Mensagem ignorada: De ${message.from} (Tipo: ${message.isGroupMsg ? 'Grupo' : message.isStatus ? 'Status' : isNewsletter ? 'Newsletter' : 'Vazia/Sem Corpo'}) | Conteúdo: ${message.body?.substring(0, 50) || 'N/A'}`);
        
        return; // Sai da função, não processa a mensagem
            }

            console.info(`[MENSAGEM RECEBIDA] De: ${message.from} (${message.sender?.name || 'sem nome'}) | Conteúdo: ${message.body}`);
            const context = getUserContext(message.from);

            try {
                // Processa a mensagem e obtém a resposta da IA ou comando interno
                  const resposta = await processarMensagem(message.body, context); // <-- AQUI
                // Envia a resposta de volta ao usuário
                await client.sendText(message.from, resposta);
                console.info(`[INFO] Resposta enviada para ${message.from}`);
            } catch (error) {
                console.error('[ERRO] Falha ao processar ou enviar resposta:', error);
                // Tenta enviar uma mensagem de erro genérica para o usuário
                await client.sendText(message.from, 'Ops, tive um probleminha para te responder. Tente novamente mais tarde!');
            }
        });
    })
    .catch((err) => {
        console.error('❌ Erro crítico ao iniciar WPPConnect:', err);
        process.exit(1); // Encerra o processo se o WhatsApp não puder iniciar
    });
});

// Tratamento de encerramento gracioso do servidor Node.js
process.on('SIGINT', () => {
    console.info('\n🔴 Recebido SIGINT. Encerrando servidor...');
    server.close(() => {
        console.info('Servidor encerrado.');
        process.exit(0);
    });
});
