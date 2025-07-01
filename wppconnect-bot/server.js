const { create } = require('@wppconnect-team/wppconnect');

create({
  session: 'session-name', // nome da sessão
  puppeteerOptions: {
    headless: false // usa headless false pra ver o QR code no browser
  }
}).then((client) => start(client))
  .catch((error) => console.log(error));

function start(client) {
  console.log('WPPConnect Server iniciado');

  client.onMessage(message => {
    if (message.body === 'ping') {
      client.sendText(message.from, 'pong');
    }
  });
}
