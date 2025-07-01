require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env
const express = require('express'); // Framework para criar o servidor web
const axios = require('axios'); // Para requisições HTTP (usado para enviar mensagens)
const { create } = require('@wppconnect-team/wppconnect'); // Biblioteca para integração com WhatsApp
// const OpenAI = require('openai'); // REMOVIDO: Não precisaremos mais do SDK da OpenAI
const { GoogleGenerativeAI } = require('@google/generative-ai'); // ADICIONADO: SDK do Google Gemini

// Inicializa o servidor Express
const app = express();
const port = process.env.PORT || 3000; // Usa a porta do .env ou 3000

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
        const text = response.text(); // Extrai o texto da resposta

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
async function processarMensagem(mensagemRecebida) {
    console.debug('[DEBUG] Processando mensagem:', mensagemRecebida);

    // 1. Primeiro verifica comandos internos
    const comandosInternos = {
        'estoque': `Temos ${Math.floor(Math.random() * 100)} itens em estoque.`,
        'faturamento': `Faturamento: R$ ${formatarNumeroBR(Math.random() * 50000)}`
    };

    const msg = mensagemRecebida.toLowerCase().trim();
    if (comandosInternos[msg]) {
        console.debug('[DEBUG] Usando resposta interna para:', msg);
        return comandosInternos[msg];
    }

    // 2. Todas outras mensagens vão para a IA
    try {
        console.debug('[DEBUG] Chamando Gemini para:', mensagemRecebida);

        // O prompt para a IA foi movido para dentro da chamada para ser mais dinâmico
        const respostaIA = await chamarGeminiSDK( // <-- Agora chamando a função para o Gemini
            `Você é um assistente cobrindo o atendimento no lugar de Sávio. ` +
            `Responda de forma natural em português brasileiro. ` +
            `Mensagem recebida: "${mensagemRecebida}"`
        );

        return respostaIA || "Sávio já foi avisado e vai responder em breve!";
    } catch (error) {
        console.error('[ERRO] Falha ao processar mensagem com IA (Gemini):', error);
        return "Estou com problemas técnicos, mas Sávio já foi avisado!";
    }
}

/**
 * Verifica a conexão com o Google Gemini fazendo uma requisição simples.
 * @returns {Promise<boolean>} True se a conexão for bem-sucedida, false caso contrário.
 */
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
 * ATENÇÃO: Use com cautela para evitar spam ou bloqueio do WhatsApp.
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
            if (message.isGroupMsg || message.isStatus || isNewsletter) {
                console.debug(`Mensagem ignorada (grupo, status ou newsletter): ${message.from} - ${message.body?.substring(0, 50) || ''}...`);
                return; // Sai da função, não processa a mensagem
            }

            console.info(`[MENSAGEM RECEBIDA] De: ${message.from} (${message.sender?.name || 'sem nome'}) | Conteúdo: ${message.body}`);

            try {
                // Processa a mensagem e obtém a resposta da IA ou comando interno
                const resposta = await processarMensagem(message.body);
                // Envia a resposta de volta ao usuário
                await client.sendText(message.from, resposta);
                console.info(`[INFO] Resposta enviada para ${message.from}`);
            } catch (error) {
                console.error('[ERRO] Falha ao processar ou enviar resposta:', error);
                // Tenta enviar uma mensagem de erro genérica para o usuário
                await client.sendText(message.from, 'Ops, tive um probleminha para te responder. Tente novamente mais tarde!');
            }
        });

        // Exemplo de como chamar a função de envio em massa (NÃO EXECUTAR AUTOMATICAMENTE)
        // Se você quiser enviar uma mensagem para todos os contatos individuais,
        // você pode chamar esta função manualmente aqui ou através de uma rota Express separada.
        // Exemplo:
        // setTimeout(() => {
        //     enviarParaContatosSeguro(client);
        // }, 10000); // Envia 10 segundos após a conexão (apenas para teste)

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
