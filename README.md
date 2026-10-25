# Dia a dia

Aplicativo local para organizar dailys, pendências e referências em uma interface simples. Funciona sem internet ou conta online, com dados salvos em SQLite no computador.

## Funcionalidades

- Daily por data, histórico e roteiro opcional.
- Tarefas com prioridade, prazo, busca e conclusão.
- Referências para anotações, senhas, códigos, web.config e imagens.
- Criptografia das referências com senha mestra.
- Até 20 imagens por referência, com upload múltiplo, colagem, visualização ampliada, download e remoção individual (até 8 MB por imagem).
- Importação de arquivos de texto e configuração.
- Temas claro e escuro com destaques azuis.
- Exportação e restauração de dailys e tarefas em JSON.

## Executar

Requer **Node.js 24 ou superior**. Não é necessário instalar pacotes npm: o aplicativo utiliza módulos nativos do Node.js.

```sh
npm start
```

Abra **http://127.0.0.1:43127**. Para encerrar a execução no terminal, pressione Ctrl+C.

### Instalação no Windows

Na pasta do projeto, execute pelo PowerShell:

```powershell
.\Instalar.ps1
```

O instalador copia o aplicativo e o runtime Node.js para `%LOCALAPPDATA%\Programs\DiaADia` e cria o atalho **Dia a dia** na Área de Trabalho e no menu Iniciar. Após a instalação, use esse atalho; o aplicativo abre no navegador padrão. **Encerrar Dia a dia**, no menu Iniciar, desliga o processo local.

## Dados e proteção

O banco fica em `%LOCALAPPDATA%\DiaADia\dia-a-dia.sqlite`, e as imagens cifradas em `%LOCALAPPDATA%\DiaADia\imagens`. Nada disso faz parte deste repositório. Em outros sistemas, sem LOCALAPPDATA, a pasta padrão é `~/DiaADia`.

As referências usam AES-256-GCM e uma chave derivada da senha mestra com PBKDF2-SHA256. A senha mestra não é enviada ao servidor local, e a chave permanece em memória enquanto a aba está desbloqueada. Não há recuperação da senha. Dailys e tarefas são armazenadas sem essa criptografia.

O servidor escuta somente em `127.0.0.1`. Não exponha sua porta na rede: esta versão foi feita para uso pessoal na própria máquina, sem autenticação de usuários remotos.

O backup JSON da interface contém dailys, tarefas e tema; não inclui referências. Para um backup completo, encerre o aplicativo e copie toda a pasta de dados, incluindo banco e imagens. Consulte [LEIA-ME.md](LEIA-ME.md) para os detalhes.

## Desenvolvimento

```sh
npm test
```

Os testes cobrem persistência em SQLite, reinicialização do aplicativo, criptografia, imagens, validação, conflitos de edição e restrições de acesso local.

Configurações opcionais:

| Variável | Uso |
| --- | --- |
| `DIA_A_DIA_DATA_DIR` | Pasta alternativa para o banco e as imagens |
| `DIA_A_DIA_PORT` | Porta local, padrão `43127` |

O atalho do Windows utiliza a pasta e a porta padrão. As variáveis são destinadas à execução pelo terminal. O servidor local encerra cerca de 8 segundos depois que a última aba do aplicativo é fechada; se o navegador terminar sem avisar, encerra após cerca de 90 segundos. Abrir o atalho novamente inicia o servidor.

### Estrutura

- `public/`: interface em HTML, CSS e JavaScript.
- `server/`: servidor HTTP local, persistência e validação.
- `drizzle/`: migrações SQL aplicadas automaticamente na inicialização.
- `tests/`: testes executados com o test runner nativo do Node.js.
- `Instalar.ps1`, `Abrir.ps1` e `Abrir Dia a dia.vbs`: instalação e abertura no Windows.

Não adicione bancos, backups, credenciais ou referências pessoais ao Git. O `.gitignore` exclui os formatos e diretórios de dados mais comuns.
