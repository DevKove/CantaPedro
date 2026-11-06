# CantaPedro — Karaokê Desktop Offline para Windows

Aplicativo de karaokê para Windows, sem login, backend, nuvem, publicidade ou chamadas de rede em tempo de execução. Inclui menu lateral responsivo, biblioteca local, fila, favoritas, busca, importação de pastas, player e visualização de letras.

## Instalador Windows
O GitHub Actions gera um instalador `.exe` (NSIS) para Windows x64, com atalhos no Menu Iniciar e na Área de Trabalho e opção de escolher a pasta de instalação.

Acesse **Actions → Build CantaPedro for Windows** e baixe o artefato `CantaPedro-Windows-Installer` de uma execução concluída.

Para compilar no Windows com Node.js 22+:
```powershell
npm install
npm start
npm run dist:win
```
O instalador será criado em `release/\`.

## Execução offline
O desktop carrega a interface localmente e não depende de conexão com a internet após a instalação. O instalador precisa ser baixado uma vez. As músicas importadas ficam no armazenamento local do dispositivo.

## Navegador / PWA
A versão PWA não é o alvo de distribuição. O instalador Electron para Windows é a opção recomendada para instalação e uso offline.

## Dados e privacidade
- Arquivos importados são mantidos no armazenamento local do dispositivo.
- Não há envio de músicas ou metadados para servidores.
- Faça backup dos dados locais antes de limpar o perfil do aplicativo.

## Formatos
KAR, MID, MIDI, MP3, WAV, OGG, FLAC, M4A, AAC, MP4 e WebM. Reprodução depende do suporte a codecs do Chromium/Electron.

O leitor KAR/MIDI interpreta eventos MIDI e eventos de texto/letra. O sintetizador é básico. CDG+MP3, ZIP e banco General MIDI profissional ainda não estão incluídos.

## Atalhos
- Espaço: reproduzir/pausar.
- /: focar a busca.
- Esc: fechar a tela de letras.
