# CantaPedro — Karaokê Offline

Aplicativo web instalável (PWA) para organizar e reproduzir arquivos locais de karaokê sem conta, servidor ou conexão permanente.

## Executar localmente

A aplicação é estática. Sirva a pasta por HTTP local (necessário para IndexedDB e Service Worker):

```bash
python -m http.server 8080
```

Abra `http://localhost:8080`. Depois da primeira abertura, os arquivos da aplicação ficam em cache e o PWA pode funcionar offline.

## Formatos

- **KAR, MID, MIDI:** leitura de eventos MIDI, notas e eventos de letra; letras sincronizadas quando presentes no arquivo.
- **MP3, WAV, OGG, FLAC, M4A, AAC:** reprodução via recursos de áudio do navegador.
- **MP4, WebM:** reprodução via recursos de vídeo do navegador. Compatibilidade de codecs depende do navegador/ sistema.
- **Múltiplos arquivos e pastas:** importação em lote.

Os arquivos importados são guardados no IndexedDB do navegador/dispositivo. Não há upload para servidores.

## Observações técnicas

- O sintetizador MIDI inicial usa Web Audio e timbre básico; não é um banco General MIDI profissional.
- Arquivos KAR/MIDI sem eventos de letra tocam como MIDI, mas não exibem legendas sincronizadas.
- CDG+MP3, ZIP de pacotes e formatos proprietários ainda não fazem parte desta primeira versão.
- A aplicação não inclui músicas protegidas por direitos autorais. Importe somente arquivos que você tenha direito de utilizar.

## Atalhos

- **Espaço:** reproduzir/pausar.
- **/**: focar a busca.
- **Esc:** fechar a tela de letras.

## Tecnologias

HTML, CSS, JavaScript, IndexedDB, Web Audio API e Service Worker. Sem backend e sem dependências externas de execução.
