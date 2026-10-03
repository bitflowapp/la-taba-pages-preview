import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import os from 'node:os';
import OpenAI from 'openai';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const host = '0.0.0.0';
const model = process.env.OPENAI_MODEL || 'gpt-5.2';
const maxImageBytes = 8 * 1024 * 1024;

if (!process.env.OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY no esta configurada. Los endpoints de IA devolveran error.');
}

let openai = null;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '12mb' }));
app.use(
  '/api',
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    limit: Number(process.env.RATE_LIMIT_MAX ?? 30),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espera un momento y vuelve a intentar.' },
  }),
);

const baseInstructions = `
Eres Ojo Claro, un asistente de accesibilidad para personas no videntes.
Responde en espanol claro, breve y accionable.
Prioriza seguridad practica: obstaculos, personas, puertas, escaleras, vehiculos, calles, senales, texto visible, dinero, productos, precios y riesgos inmediatos.
No inventes. Si una imagen es borrosa, parcial o no permite confirmar algo importante, dilo explicitamente.
No confirmes medicamentos, billetes, semaforos, senales de transito, instrucciones medicas o informacion peligrosa si no se ve con claridad.
Cuando haya riesgo, indica una accion prudente: detenerse, acercar la camara, pedir ayuda o verificar con otra fuente.
`;

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('El backend no tiene OPENAI_API_KEY configurada.');
    error.status = 503;
    throw error;
  }
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

function textFromResponse(response) {
  const text = response.output_text?.trim();
  if (!text) {
    const error = new Error('La IA no devolvio texto util.');
    error.status = 502;
    throw error;
  }
  return text;
}

function validateImagePayload(body) {
  const imageBase64 = String(body?.imageBase64 ?? '');
  const mimeType = String(body?.mimeType ?? 'image/jpeg');

  if (!imageBase64) {
    const error = new Error('Falta imageBase64.');
    error.status = 400;
    throw error;
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    const error = new Error('Formato de imagen no soportado. Usa JPEG, PNG o WEBP.');
    error.status = 400;
    throw error;
  }

  const approxBytes = Math.floor((imageBase64.length * 3) / 4);
  if (approxBytes > maxImageBytes) {
    const error = new Error('La imagen es demasiado grande. Usa una captura mas liviana.');
    error.status = 413;
    throw error;
  }

  return { imageBase64, mimeType };
}

async function createTextResponse({ instructions, input }) {
  const client = requireApiKey();
  const response = await client.responses.create({
    model,
    instructions,
    input,
    max_output_tokens: 450,
  });
  return textFromResponse(response);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ojo-claro-backend' });
});

app.post('/api/ask', async (req, res, next) => {
  try {
    const question = String(req.body?.question ?? '').trim();
    if (question.length < 2) {
      return res.status(400).json({ error: 'Escribe o dicta una pregunta.' });
    }

    const answer = await createTextResponse({
      instructions: `${baseInstructions}
Responde como asistente conversacional. Si la pregunta requiere ver el entorno, pide usar la camara.`,
      input: [{ role: 'user', content: [{ type: 'input_text', text: question }] }],
    });

    res.json({ answer });
  } catch (error) {
    next(error);
  }
});

app.post('/api/vision', async (req, res, next) => {
  try {
    const { imageBase64, mimeType } = validateImagePayload(req.body);
    const userPrompt = String(req.body?.prompt ?? '').trim() || 'Describe que tengo enfrente.';

    const answer = await createTextResponse({
      instructions: `${baseInstructions}
Describe la escena para movilidad y orientacion. Menciona primero peligros u obstaculos cercanos, luego objetos utiles y texto visible. No des seguridad falsa.`,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userPrompt },
            { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: 'auto' },
          ],
        },
      ],
    });

    res.json({ answer });
  } catch (error) {
    next(error);
  }
});

app.post('/api/read-text', async (req, res, next) => {
  try {
    const { imageBase64, mimeType } = validateImagePayload(req.body);

    const answer = await createTextResponse({
      instructions: `${baseInstructions}
Lee y resume texto visible. Conserva numeros importantes como precios, fechas, direcciones, telefonos, nombres de producto y advertencias. Si el texto no se ve bien, dilo y pide acercar o enfocar mejor.`,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Lee el texto visible y explicalo de forma simple.' },
            { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' },
          ],
        },
      ],
    });

    res.json({ answer });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = Number(error.status || error.statusCode || 500);
  const publicMessage =
    status >= 500
      ? 'No pude completar la consulta de IA. Revisa el backend, la clave de OpenAI o intenta nuevamente.'
      : error.message;

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({ error: publicMessage });
});

function localLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => item.address);
}

app.listen(port, host, () => {
  const lanUrls = localLanAddresses().map((address) => `http://${address}:${port}`);
  console.log('Ojo Claro backend iniciado');
  console.log(`Host: ${host}`);
  console.log(`Puerto: ${port}`);
  console.log(`URL local: http://localhost:${port}`);
  console.log(`URL LAN sugerida: ${lanUrls[0] ?? 'no detectada'}`);
  if (lanUrls.length > 1) {
    console.log(`URLs LAN adicionales: ${lanUrls.slice(1).join(', ')}`);
  }
});
