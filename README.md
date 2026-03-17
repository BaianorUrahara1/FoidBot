# 🤖 FoidBot (WhatsApp)

Bot em Node.js para automação no WhatsApp, com foco em mídia, comandos utilitários, sessões WOW e sistema de ranking

## ✨ Funcionalidades

- 🖼️ Criar figurinha com `!figurinha` ou `!s` (imagem, vídeo e gif)
- 👁️ Revelar mídia de visualização única com `!revelar` (imagem) e `!voz` (áudio)
- ⚡ Usar `wow` para reenviar mídia de visualização única
- 📸 Consultar foto de perfil com `!foto <número>`
- 🔗 Criar sessão secundária para WOW com `!conectar` e `!conectar qr`
- 📈 Sistema de progresso e ranking com `!rateme` e `!rank`
- ♻️ Restaurar mensagens apagadas com `!restaurar`
- 🛡️ Proteção de usuário/número sensível via configuração dinâmica

## 📋 Requisitos

- Node.js 18 ou superior
- npm
- ffmpeg no `PATH` (opcional, necessário para figurinhas animadas de vídeo/gif)

## 🚀 Instalação

```bash
npm install
```

## ⚙️ Configuração

1. Crie seu `.env` a partir do exemplo

Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

Linux/macOS:

```bash
cp .env.example .env
```

2. Inicie o bot com os padrões
3. Depois, ajuste pelo próprio WhatsApp com `!config` (somente dono da sessão principal)
4. Use o `.env` apenas para ajustes avançados (prefixo, logs, cache e caminhos)

## ▶️ Como iniciar

### 1) Terminal

```bash
npm start
```

### 2) Modo focado em QR (menos logs)

```bash
npm run start:qr
```

## 🧪 Scripts úteis

- `npm start`: inicia o bot
- `npm run start:qr`: inicia com logs reduzidos
- `npm run dev`: inicia com nodemon
- `npm run check`: validação rápida de sintaxe

## 💬 Comandos

| Comando | Descrição |
| --- | --- |
| `!config status` | Mostra a configuração atual |
| `!config rank aqui\|<jid>\|off` | Define o grupo do ranking |
| `!config principal aqui\|<jid>\|off` | Define o grupo principal dos comandos |
| `!config protegido @user\|<jid>\|off` | Define/remove usuário protegido |
| `!config numero <55DDDNUMERO>\|off` | Define/remove número protegido |
| `!figurinha` / `!s` | Cria figurinha de imagem/vídeo/gif |
| `!revelar` | Revela imagem view única |
| `!voz` | Revela áudio view único |
| `!foto <número>` | Busca foto de perfil do número |
| `wow` | Reenvia view única de forma silenciosa |
| `!conectar` / `!conectar qr` | Inicia sessão secundária para WOW |
| `!restaurar [@user] <quantidade>` | Restaura mensagens apagadas |
| `!rateme` | Mostra progresso/rank do usuário |
| `!rank` | Mostra top 5 do ranking |

## 🗂️ Estrutura do projeto

- `src/commands`: comandos por domínio
- `src/core/config.js`: leitura e validação de configuração
- `src/handlers/messages/messageHandler.js`: roteamento das mensagens
- `src/sessions/wowSessionManager.js`: gerenciamento das sessões WOW
- `src/storage`: persistência de dados (ranking e configurações)

## 🔧 Configuração via WhatsApp

- Apenas o dono da sessão principal pode usar `!config`
- As configurações são salvas em `data/runtime-settings.json`
- Se o grupo principal não for definido, os comandos (exceto regras específicas) funcionam em todos os chats

## ⚖️ Aviso legal

O autor não se responsabiliza por qualquer uso indevido, ilegal ou abusivo deste projeto por terceiros
Cada usuário é totalmente responsável pelos próprios atos e pelo cumprimento das leis aplicáveis
