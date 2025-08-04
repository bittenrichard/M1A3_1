// Local: server.ts

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { baserowServer } from './src/shared/services/baserowServerClient.js';
import fetch from 'node-fetch';
import bcrypt from 'bcryptjs';
import multer from 'multer';

const app = express();
const port = 3001;

const upload = multer();

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  process.env.FRONTEND_URL?.replace('https://', 'https://www.') || 'http://localhost:5173'
];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
  console.error("ERRO CRÍTICO: As credenciais do Google não foram encontradas no ambiente.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const USERS_TABLE_ID = '711';
const VAGAS_TABLE_ID = '709';
const CANDIDATOS_TABLE_ID = '710';
const AGENDAMENTOS_TABLE_ID = '713';
const SALT_ROUNDS = 10;

interface BaserowJobPosting { id: number; titulo: string; usuario?: { id: number; value: string }[]; }
interface BaserowCandidate { id: number; vaga?: { id: number; value: string }[]; nome: string; telefone: string | null; email?: string | null; }

// =================================================================
// ROTAS DE DADOS E USUÁRIOS
// =================================================================

app.get('/api/users/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID do usuário não fornecido.' });
    try {
        const user = await baserowServer.getRow(USERS_TABLE_ID, parseInt(id));
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
        
        const userProfile = {
            id: user.id, nome: user.nome, email: user.Email, empresa: user.empresa,
            telefone: user.telefone, avatar_url: user.avatar_url || null,
            google_refresh_token: user.google_refresh_token || null,
        };
        res.json(userProfile);
    } catch (error: any) {
        res.status(500).json({ error: 'Erro ao buscar dados do usuário.' });
    }
});

app.get('/api/data/all/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'ID do usuário não fornecido.' });
    try {
        const { results: jobs } = await baserowServer.get(VAGAS_TABLE_ID, `?filter__usuario__link_row_has=${userId}`);
        const { results: candidates } = await baserowServer.get(CANDIDATOS_TABLE_ID, `?filter__usuario__link_row_has=${userId}`);
        
        const jobIds = jobs.map((j: any) => j.id);
        const userCandidates = candidates.filter((c: any) => c.vaga && c.vaga.some((v: any) => jobIds.includes(v.id)));

        res.json({ success: true, jobs, candidates: userCandidates });
    } catch (error: any) {
        console.error(`Erro ao buscar todos os dados para o usuário ${userId}:`, error);
        res.status(500).json({ error: 'Erro ao buscar os dados da aplicação.' });
    }
});

// =================================================================
// ROTAS DE AUTENTICAÇÃO
// =================================================================

app.post('/api/auth/signup', async (req: Request, res: Response) => {
  const { nome, empresa, telefone, email, password } = req.body;
  if (!email || !password || !nome) return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
  try {
    const emailLowerCase = email.toLowerCase();
    const { results: existingUsers } = await baserowServer.get(USERS_TABLE_ID, `?filter__Email__equal=${emailLowerCase}`);
    if (existingUsers && existingUsers.length > 0) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = await baserowServer.post(USERS_TABLE_ID, { nome, empresa, telefone, Email: emailLowerCase, senha_hash: hashedPassword });
    const userProfile = { id: newUser.id, nome: newUser.nome, email: newUser.Email, empresa: newUser.empresa, telefone: newUser.telefone, google_refresh_token: null };
    res.status(201).json({ success: true, user: userProfile });
  } catch (error: any) { res.status(500).json({ error: error.message || 'Erro ao criar conta.' }); }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  try {
    const emailLowerCase = email.toLowerCase();
    const { results: users } = await baserowServer.get(USERS_TABLE_ID, `?filter__Email__equal=${emailLowerCase}`);
    const user = users && users[0];
    if (!user || !user.senha_hash) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    const passwordMatches = await bcrypt.compare(password, user.senha_hash);
    if (passwordMatches) {
      const userProfile = { id: user.id, nome: user.nome, email: user.Email, empresa: user.empresa, telefone: user.telefone, google_refresh_token: user.google_refresh_token || null };
      res.json({ success: true, user: userProfile });
    } else { res.status(401).json({ error: 'E-mail ou senha inválidos.' }); }
  } catch (error: any) { res.status(500).json({ error: error.message || 'Erro ao fazer login.' }); }
});

// =================================================================
// ROTAS DO GOOGLE
// =================================================================

const getAuthenticatedCalendarClient = async (userId: string) => {
    const userResponse = await baserowServer.getRow(USERS_TABLE_ID, parseInt(userId));
    const refreshToken = userResponse.google_refresh_token;
    if (!refreshToken) throw new Error('Usuário não conectado ao Google Calendar.');
    const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
    auth.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth });
};

app.get('/api/google/auth/connect', (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'O ID do usuário (userId) é obrigatório.' });
  const scopes = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];
  const authorizationUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', state: userId, scope: scopes });
  res.json({ url: authorizationUrl });
});

app.get('/api/google/auth/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const userId = state as string;
  const closePopupScript = `<script>window.close();</script>`;
  if (!code || typeof code !== 'string' || !userId) return res.send(closePopupScript);
  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (tokens.refresh_token) await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { google_refresh_token: tokens.refresh_token });
    res.send(closePopupScript);
  } catch (error: any) { res.send(closePopupScript); }
});

app.post('/api/google/auth/disconnect', async (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'O ID do usuário (userId) é obrigatório.' });
    try {
        await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { google_refresh_token: null });
        res.json({ success: true, message: 'Conta Google desconectada.' });
    } catch(error: any) { res.status(500).json({ error: 'Não foi possível desconectar a conta.' }); }
});

app.get('/api/google/calendar/list-calendars', async (req: Request, res: Response) => {
    const { userId } = req.query;
    if (!userId || typeof userId !== 'string') return res.status(400).json({ success: false, message: 'O ID do usuário (userId) é obrigatório.' });
    try {
        const calendar = await getAuthenticatedCalendarClient(userId);
        const calendarList = await calendar.calendarList.list();
        if (!calendarList.data.items) return res.json({ success: true, calendars: [] });
        const simplifiedCalendars = calendarList.data.items.map(cal => ({ id: cal.id, summary: cal.summary, primary: cal.primary || false, accessRole: cal.accessRole }))
            .filter(cal => cal.accessRole === 'owner' || cal.accessRole === 'writer');
        res.json({ success: true, calendars: simplifiedCalendars });
    } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/google/calendar/create-event', async (req: Request, res: Response) => {
    const { userId, eventData, candidate, job, calendarId } = req.body;
    if (!userId || !eventData || !candidate || !job || !calendarId) return res.status(400).json({ success: false, message: 'Dados insuficientes.' });
    try {
        const calendar = await getAuthenticatedCalendarClient(userId);
        const eventDescription = `Entrevista com: ${candidate.nome}.\nEmail: ${candidate.email || 'Não informado'}`;
        const attendees = candidate.email ? [{ email: candidate.email }] : [];
        const event = {
            summary: eventData.title, description: eventDescription,
            start: { dateTime: eventData.start, timeZone: 'America/Sao_Paulo' },
            end: { dateTime: eventData.end, timeZone: 'America/Sao_Paulo' },
            attendees, reminders: { useDefault: true },
        };
        const response = await calendar.events.insert({ calendarId, requestBody: event, sendNotifications: true });
        await baserowServer.post(AGENDAMENTOS_TABLE_ID, { 'Título': eventData.title, 'Início': eventData.start, 'Fim': eventData.end, 'Detalhes': eventData.details, 'Candidato': [candidate.id], 'Vaga': [job.id], 'google_event_link': response.data.htmlLink });
        res.json({ success: true, message: 'Evento criado com sucesso!', data: response.data });
    } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

// =================================================================
// Inicialização do Servidor
// =================================================================

app.listen(port, () => {
  console.log(`Backend rodando em http://localhost:${port}`);
});