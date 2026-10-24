# Dia a dia — aplicativo local

Abra o atalho **Dia a dia** na Área de Trabalho. Ele inicia o aplicativo e abre seu navegador em http://127.0.0.1:43127. Não precisa de internet, conta, ChatGPT, Codex ou serviço de hospedagem. O navegador é apenas a interface; os dados são arquivos no computador.

O programa é instalado em `%LOCALAPPDATA%\Programs\DiaADia`, com seu próprio runtime Node.js. Não depende de npm, bibliotecas externas ou caminhos do Codex para executar. Para instalar a partir destes fontes, execute Instalar.ps1 em uma máquina com Node.js 24 instalado.

## Seus dados

- SQLite: `%LOCALAPPDATA%\DiaADia\dia-a-dia.sqlite`.
- Imagens das referências: `%LOCALAPPDATA%\DiaADia\imagens`.
- Não há salvamento no navegador ou envio para serviços externos.
- A aba Referências mantém a senha mestra e a criptografia local. A senha não é uma conta online. Guarde-a: não há recuperação.
- O aplicativo escuta somente em 127.0.0.1, acessível neste computador.

O backup em **Meus dados** exporta dailys, tarefas e tema em JSON e importa backups da versão anterior. Referências e imagens não estão nesse JSON. Para uma cópia completa, espere aparecer Salvo, use **Encerrar Dia a dia** no menu Iniciar e copie a pasta inteira `%LOCALAPPDATA%\DiaADia`. Copie todos os arquivos juntos, preservando imagens e banco. Para restaurar, encerre o aplicativo, preserve uma cópia dos dados atuais e restaure a pasta inteira.

A versão online antiga é independente. Instalar este aplicativo não apaga nem transfere automaticamente o que foi salvo nela.

## Encerrar e desenvolver

Ao fechar a última aba do aplicativo, o servidor local encerra em cerca de 8 segundos. Se o navegador for encerrado sem avisar, o servidor encerra após cerca de 90 segundos sem resposta. Abrir o atalho inicia novamente. Você também pode usar **Encerrar Dia a dia** no menu Iniciar. Não há inicialização automática com Windows.

Fontes sem dependências: `npm start` ou `node server/local.mjs`. Testes: `npm test` com Node.js 24. Para testes isolados, configure `DIA_A_DIA_DATA_DIR` e `DIA_A_DIA_PORT`.
