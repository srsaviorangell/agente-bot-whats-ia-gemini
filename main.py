from fastapi import FastAPI, Request, UploadFile, File, Header, HTTPException, Query
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
import openai
import httpx
import os
import tempfile
from pydub import AudioSegment
from gtts import gTTS

# Carrega variáveis do .env
load_dotenv()

# Configurações de API
openai.api_key = os.getenv("OPENAI_API_KEY")
TINY_API_TOKEN = os.getenv("TINY_API_TOKEN")
VOZ_API_KEY = os.getenv("VOZ_API_KEY", "1segredo123")
VERIFY_TOKEN = os.getenv("VERIFY_TOKEN", "meu_token_secreto")

app = FastAPI()

# Verificação do Webhook do Meta (GET)
@app.get("/webhook")
async def verificar_webhook(
    hub_mode: str = Query(..., alias="hub.mode"),
    hub_challenge: str = Query(..., alias="hub.challenge"),
    hub_verify_token: str = Query(..., alias="hub.verify_token")
):
    if hub_mode == "subscribe" and hub_verify_token == VERIFY_TOKEN:
        return PlainTextResponse(content=hub_challenge, status_code=200)
    return PlainTextResponse(content="Token inválido", status_code=403)


# Recebe mensagem do WhatsApp via WPPConnect (POST)
@app.post("/webhook")
async def receber_mensagem(request: Request):
    body = await request.json()
    print("Mensagem recebida:", body)

    numero = body.get("from")
    texto = body.get("body", "")

    if numero and texto:
        resposta = await responder_ia(texto)
        await enviar_mensagem(numero, resposta)

    return PlainTextResponse("OK")


# Gera resposta da IA com OpenAI (GPT e Tiny ERP)
async def responder_ia(mensagem: str) -> str:
    try:
        if "estoque" in mensagem.lower():
            estoque = await consultar_estoque()
            return f"A empresa possui {estoque} produtos no estoque."

        if "faturamento" in mensagem.lower():
            fat = await consultar_faturamento()
            return f"O faturamento total da empresa é R$ {fat}."

        resposta = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "Você é um assistente da empresa com acesso ao Tiny ERP."},
                {"role": "user", "content": mensagem}
            ]
        )
        return resposta.choices[0].message.content.strip()
    except Exception as e:
        print("Erro IA:", e)
        return "Erro ao gerar resposta."


# Consulta estoque no Tiny ERP
async def consultar_estoque():
    try:
        url = f"https://api.tiny.com.br/api2/produtos.pesquisa.php?token={TINY_API_TOKEN}&formato=json"
        async with httpx.AsyncClient() as client:
            r = await client.get(url)
            data = r.json()
            produtos = data.get("retorno", {}).get("produtos", [])
            return len(produtos)
    except Exception as e:
        print("Erro estoque:", e)
        return "não foi possível consultar o estoque"


# Consulta faturamento no Tiny ERP
async def consultar_faturamento():
    try:
        url = f"https://api.tiny.com.br/api2/pedidos.pesquisa.php?token={TINY_API_TOKEN}&formato=json"
        async with httpx.AsyncClient() as client:
            r = await client.get(url)
            data = r.json()
            pedidos = data.get("retorno", {}).get("pedidos", [])
            total = sum(float(p.get("pedido", {}).get("valor", 0)) for p in pedidos)
            return round(total, 2)
    except Exception as e:
        print("Erro faturamento:", e)
        return "não foi possível consultar o faturamento"


# Envia mensagem via WPPConnect
async def enviar_mensagem(numero: str, texto: str):
    url = "http://localhost:21465/api/send-message"
    payload = {
        "phone": numero,
        "message": texto
    }
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(url, json=payload)
            print("Enviado:", r.status_code, r.text)
        except Exception as e:
            print("Erro envio WPP:", e)


# Gera áudio com gTTS
async def gerar_audio(resposta: str, nome_arquivo: str = "resposta.mp3"):
    tts = gTTS(resposta, lang='pt')
    path = f"/tmp/{nome_arquivo}"
    tts.save(path)
    return path


# Endpoint para transcrição de áudio com Whisper
@app.post("/voz")
async def receber_audio(file: UploadFile = File(...), x_token: str = Header(None)):
    if x_token != VOZ_API_KEY:
        raise HTTPException(status_code=403, detail="Token inválido.")

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".ogg") as temp:
            temp.write(await file.read())
            temp.flush()

        audio = AudioSegment.from_file(temp.name)
        mp3_path = temp.name.replace(".ogg", ".mp3")
        audio.export(mp3_path, format="mp3")

        with open(mp3_path, "rb") as audio_file:
            transcript = openai.Audio.transcribe("whisper-1", audio_file, language="pt")
            texto = transcript["text"]

        resposta = await responder_ia(texto)
        caminho_audio = await gerar_audio(resposta)

        return {"pergunta": texto, "resposta": resposta, "audio": caminho_audio}

    except Exception as e:
        print("Erro no reconhecimento de voz com Whisper:", e)
        return {"erro": "Não foi possível processar o áudio."}