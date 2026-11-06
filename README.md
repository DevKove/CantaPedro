# CantaPedro — Karaokê Desktop Offline

Aplicativo de karaokê para Windows e Linux, sem login, backend, nuvem, publicidade ou chamadas de rede em tempo de execução. Inclui menu lateral responsivo, biblioteca local, fila, favoritas, busca, importação de pastas, player e visualização de letras.

## Instaladores
O GitHub Actions gera:
- Windows: instalador `.exe` (NSIS), com atalhos no Menu Iniciar e na Área de Trabalho.
- Linux: `.AppImage` e pacote `.deb`.

Acesse **Actions → Build CantaPedro Desktop** e baixe o artefato de uma execução concluída.

Para compilar localmente com Node.js 22+:
```bash
npm install
npm start
npm run dist:win
npm run dist:linux
```
Compile no sistema operacional de destino.

## Navegador / PWA
```bash
python -m http.server 8080
```
Abra `http://localhost:8080`. A instalação PWA requer uma primeira abertura por localhost/HTTPS; o instalador Electron é a opção para instalação e primeiro uso totalmente offline.

## Dados e privacidade
- Arquivos importados são mantidos no armazenamento local do dispositivo.
- Não há envio de músicas ou metadados para servidores.
- O desktop carrega a interface localmente, sem depender de rede.
- Faça backup dos dados locais antes de limpar o perfil do aplicativo.

## Formatos
KAR, MID, MIDI, MP3, WAV, OGG, FLAC, M4A, AAC, MP4 e WebM. Reprodução depende do suporte a codecs do Chromium/Electron. MKV pode não funcionar em alguns sistemas.

O leitor KAR/MIDI interpreta eventos MIDI e eventos de texto/letra. O sintetizador é básico. CDG+MP3, ZIP e banco General MIDI profissional ainda não estão incluídos.

## Atalhos
- Espaço: reproduzir/pausar.
- /: focar a busca.
- Esc: fechar a tela de letras.
