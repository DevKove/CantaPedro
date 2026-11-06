# CantaPedro — Karaokê Desktop Offline para Windows

Aplicativo de karaokê para Windows, sem login, backend, nuvem, publicidade ou chamadas de rede em tempo de execução. Inclui menu lateral responsivo, biblioteca local, fila, favoritas, busca, importação de pastas, player e visualização de letras.

## Instalador Windows
O GitHub Actions gera um instalador `.exe` (NSIS) para Windows x64, com atalhos no Menu Iniciar e na Área de Trabalho e opção de escolher a pasta de instalação.

Acesse **Actions → Build CantaPedro for Windows** e baixe o artefato `CantaPedro-Windows-Installer` de uma execução concluída.

Para compilar no Windows com Node.js 22+:
```powershell
npm install
npm audit --audit-level=high
npm run check
npm test
npm start
npm run dist:win
```
O instalador será criado na pasta `release/`. Os testes automatizados do parser MIDI/KAR são executados antes de cada publicação.

## Execução offline
O desktop carrega a interface localmente e não depende de conexão com a internet após a instalação. O instalador precisa ser baixado uma vez. As músicas importadas ficam no armazenamento local do dispositivo.

## Plataforma
A distribuição é exclusiva para Windows x64 por meio do instalador Electron. A interface web/PWA não faz parte do produto.

## Dados e privacidade
- Arquivos importados são mantidos no armazenamento local do dispositivo.
- Não há envio de músicas ou metadados para servidores.
- Faça backup dos dados locais antes de limpar o perfil do aplicativo.

## Formatos
KAR, MID, MIDI, MP3, WAV, OGG, FLAC, M4A, AAC, MP4 e WebM. Reprodução depende do suporte a codecs do Chromium/Electron.

O leitor KAR/MIDI valida os limites de cada trilha, interpreta eventos de notas, tempo e letras, e reconhece metadados de título. A reprodução MIDI usa o SpessaSynth com o banco GeneralUser GS incluído no instalador. CDG+MP3 e arquivos ZIP não são suportados.

## Atalhos
- Espaço: reproduzir/pausar.
- /: focar a busca.
- Esc: fechar a tela de letras.
