# AutoPage server
Gera sites a partir de perfis de redes sociais e publica em `nome.kattalo.online`.
- `app.kattalo.online`: editor (login por senha). Qualquer outro subdomínio abre o site publicado.
- `build.py`: gera `public/app.html` (versão hospedada) a partir de `app.src.html`.
- Variáveis: veja `.env.example`. `npm start` / `npm test`.

## Usuários e painéis

- **Admin** (você): entra com a senha `ADMIN_PASSWORD` (e-mail em branco). Vê o painel geral (clientes, sites, visitas, cliques, agendamentos, uso de IA), a aba **Clientes** (criar acesso, trocar plano/limite, bloquear, nova senha, excluir) e todos os sites.
- **Cliente** (quem compra): você cria o acesso na aba Clientes (senha temporária gerada). Ele entra com e-mail e senha e vê só o próprio painel: seus sites, visitas, cliques, agendamentos e conta. Cada cliente só edita e apaga os próprios sites, respeitando o limite do plano (Gratuito 1, Básico 3, Pro 10, Premium 30; ajustável por cliente).

## Vendas (Mercado Pago)

Defina `MP_ACCESS_TOKEN` no Render. Na aba **Clientes → Vendas dos planos**, informe o preço de cada plano (vazio = não vende). A página pública `https://app.SEUDOMINIO/planos` leva ao checkout do Mercado Pago (Pix, cartão, boleto). Quando o pagamento é aprovado (webhook `/mp/webhook`, confirmado direto na API do Mercado Pago), o acesso é criado sozinho e o comprador define a própria senha. Cada compra vale 30 dias; vencido, a conta volta aos limites do plano Gratuito e os sites continuam no ar. Cliente logado renova ou muda de plano pelo botão no painel.

## Funções adicionais
- **Cadastro com teste grátis** (`/cadastro`): 7 dias de Pro, com link de indicação (`?ref=`), +7 dias para quem indicou quando o indicado paga.
- **Cupons** (admin → Clientes): desconto de 1% a 90%, limite de usos e validade; campo na página `/planos`.
- **Mensagens, presenças e contatos**: formulários dos sites (landing, convite com RSVP, captura de contatos) chegam ao painel, com CSV e aviso por e-mail.
- **Estatísticas por site**: visitantes únicos, recorrentes e cliques por botão (inclui o redirecionamento do Link na bio).
- **QR Code** do site (PNG e impressão), **versões** dos últimos 6 publicados com restauração, **domínio próprio** (CNAME verificado por DNS; o HTTPS exige adicionar o domínio em Render → Custom Domains).
- **Formatos novos**: Captura de contatos e Carteirinha do pet. **Melhorar site** (checklist por formato + ideias da IA) e **cor da logo**.
- **Admin**: log de atividade, backups diários (3 últimos no banco; por e-mail com `RESEND_API_KEY` + `ADMIN_EMAIL`), avisos de vencimento por e-mail.
- Variáveis: `RESEND_API_KEY`, `MAIL_FROM`, `SIGNUP`.
- **Automação**: o workflow `.github/workflows/keepalive.yml` chama `/healthz` a cada 10 min; o servidor aproveita para rodar backup diário e avisos de vencimento (no máximo a cada 6 h).

## Currículo → Perfil profissional
Nos formatos *Perfil profissional* e *Currículo online* é possível enviar o currículo (PDF até 5 MB, Word .docx, TXT ou foto). DOCX/TXT são lidos no navegador; PDF vai para `/api/ai` como `docs` (Gemini ou Claude). A IA só usa o que está no currículo (nunca inventa) e preenche nome, título, resumo, contatos, links, competências e experiência/formação.

## Padrão visual
Tema, fonte e layout dos sites novos são fixos (padrão: claro, Plus Jakarta Sans, layout dividido) e não variam por segmento. Mudança em "Padrão visual dos novos sites" na tela de criar, ou "Usar este visual como padrão" no editor. Fontes: Plus Jakarta Sans, Inter, Poppins, Playfair Display+Inter, Space Grotesk+Inter.

## Vendas (catálogo, cardápio digital e loja com carrinho)
- Cada pedido feito no site publicado é **registrado no servidor** (`POST /api/order`, validado contra os itens, estoque, cupom, frete e pedido mínimo) e **também enviado ao WhatsApp** da loja com o número do pedido (#N). Se a API estiver indisponível (ou no HTML baixado), o pedido segue direto pelo WhatsApp.
- Aba **🛒 Vendas** (login do cliente): faturamento, pedidos, ticket médio, gráfico de 14 dias, mais vendidos, estoque baixo, status do pedido (novo → confirmado → entregue / cancelado, com devolução de estoque), botão "Avisar cliente" pelo WhatsApp e exportação CSV.
- Gestão de produtos no painel: preço, nome, estoque, esgotado, ordem, adicionar/excluir (máx. 60 itens). A mudança vale na hora no site publicado.
- Dados em `sorders/<site>/…` e contador `sctr/<site>`.

## Planos (o que cada um libera)
| Plano | Sites | Formatos | Domínio próprio | IA/dia |
|---|---|---|---|---|
| Básico (grátis) | 1 | Landing, Link na bio, Cartão, Perfil profissional | não | 10 |
| Essencial | 5 | + Catálogo Zap, Cardápio, Portfólio, Apresentação, Convite, Currículo, Pet, Captura | não | 30 |
| Pro | 10 | todos (inclui Loja com carrinho e Agendamento) | sim | 80 |
| Premium | 15 | todos | sim | 200 |
O painel de Vendas aparece para quem tem Catálogo, Cardápio ou Loja (a Loja só no Pro+). Os bloqueios são feitos no servidor (`403 format`, domínio `403`) e, na tela, os formatos pagos ficam com 🔒. Sites já publicados continuam funcionando. Tudo está definido em `PLANS` (`server.js`); o limite por cliente ainda pode ser ajustado na aba Clientes. A página `/planos` lista o que cada plano libera.

## Pagamento online e frete (Mercado Pago + Melhor Envio)
Disponível nos planos Pro e Premium. Cada cliente conecta **as próprias contas** em **Vendas → Integrações** (há passo a passo na tela):
- **Mercado Pago**: o cliente cola o *Access Token* da conta dele; o checkout (Pix/cartão) é criado com o token dele, então o dinheiro cai direto na conta dele. O webhook `/api/mp/hook` confirma o pagamento consultando a API do Mercado Pago com o token do dono (não confia no corpo da notificação) e confere valor e referência do pedido.
- **Melhor Envio**: o cliente cola o token e informa CEP de origem e embalagem padrão. O frete (PAC/SEDEX dos Correios, e outros códigos de serviço se quiser) é cotado no carrinho; o servidor recalcula o valor no pedido. Peso por produto na coluna *Peso (g)*. Etiqueta e postagem continuam no painel do Melhor Envio.
- Em cada site: Editar → "Calcular frete automático" e/ou "Receber pagamento online" → Publicar.
- Tokens ficam criptografados (AES-256-GCM, chave derivada de `SESSION_SECRET`) em `integ/<dono>` e nunca voltam ao navegador. **Defina `SESSION_SECRET` no Render** (e não troque depois, senão os tokens salvos deixam de abrir). Opcionais: `ME_CONTACT` (e-mail técnico enviado no User-Agent ao Melhor Envio), `ME_URL`/`MP_URL` para testes.

## Conta do comprador (login obrigatório para comprar)
Nos sites de **Loja com carrinho, Catálogo Zap e Cardápio digital** hospedados, o comprador precisa entrar para finalizar o pedido (o servidor recusa pedidos sem login, `401 login`). Duas formas:
- **E-mail e senha**: cadastro na própria loja (senha de 8+ caracteres, guardada com scrypt, limite de tentativas por IP e por e-mail). Contas são separadas por loja.
- **Google**: botão "Continuar com o Google" (aparece quando o Google está configurado). Fluxo por redirecionamento no domínio do app (`/auth/google/start` → `/auth/google/cb`), então funciona em qualquer subdomínio e domínio próprio sem cadastrar cada um no Google.
Para ligar o Google: no Google Cloud Console crie um **ID do cliente OAuth** (tipo *Aplicativo da Web*), em **URIs de redirecionamento autorizados** coloque `https://app.SEUDOMINIO/auth/google/cb`, e defina no Render `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. Sem essas variáveis o botão some e só o e-mail/senha funciona.
O login só vale para o site hospedado (no HTML baixado não há servidor, então segue direto pelo WhatsApp). O lojista pode desligar a exigência no editor (Loja: "Exigir login do comprador"). O e-mail do comprador aparece no pedido do painel de Vendas. Ainda não há confirmação de e-mail nem "esqueci a senha".

### O que cada formato oferece (editor)
| Formato | Login do comprador | Pagamento online (Mercado Pago) | Frete automático (Melhor Envio) |
|---|---|---|---|
| Loja com carrinho | sim | sim (no carrinho) | sim (CEP no carrinho) |
| Catálogo Zap | sim | sim (botão "Pagar online" no produto) | não |
| Cardápio digital | sim | sim (botão "Pagar online" no item) | não |
| Agendamento | sim (para reservar horário) | não | não |
| Demais formatos (landing, perfil, portfólio, apresentação, convite, link na bio, cartão, currículo, captura, pet) | não se aplica | não se aplica | não se aplica |
O editor mostra só as opções que fazem sentido para o formato escolhido. O login obrigatório vale para Loja, Catálogo, Cardápio e Agendamento (desligável no editor).

## Modo exemplo (catálogo, loja e cardápio)
Ao criar um site desses formatos, o editor já traz **10 produtos de exemplo com foto** do segmento (ilustrações geradas no navegador). Eles aparecem no site com a etiqueta "Exemplo" até o cliente trocar nome, preço ou foto; ao editar, a etiqueta some sozinha. Há botões para remover todos os exemplos ou carregá-los de novo. Não são fotos reais: o cliente deve enviar as próprias.

## Exportar e importar produtos
No editor, botão **📦 Produtos (planilha)**: exporta/importa só os dados dos produtos em .csv (com ; e BOM, abre no Excel/Google Planilhas): Nome, Preço, Categoria, Descrição, Variações, Estoque, Peso, Esgotado, Emoji. Não existe exportação do site/layout de propósito (evita cópia do design). A importação atualiza pelo nome e adiciona os novos, ou substitui tudo; passa pela higienização `sane()` e protege células que começam com `= + - @` contra injeção de fórmula.
Planilha **+ fotos**: o botão "Exportar planilha + fotos (.zip)" gera `produtos.csv` com a coluna Foto (caminho `fotos/..`) e a pasta de fotos. A importação aceita o .zip (inclusive recompactado pelo Windows/Mac) ou o .csv junto com as imagens escolhidas; as fotos são reduzidas/comprimidas no navegador. Na aba Vendas há exportar/importar da planilha (sem fotos) direto nos produtos publicados (`/api/sales/product` op `import`).

## Frete manual (sem token do Melhor Envio)
Se o cliente não conseguir o token, vale o **frete manual**: no editor ele define a taxa de entrega, opcionalmente "frete grátis acima de R$ X" e um texto de prazo. Na aba **Vendas**, o pedido segue **Novo → Aceito → Separando → Processando → Enviado → Entregue** (ou Cancelado), com campo de **código de rastreio** e transportadora (botões "Salvar rastreio" e "Salvar e marcar Enviado"). "Avisar cliente" manda por WhatsApp a mensagem de cada status, com o código e o link de rastreio dos Correios quando o código tem o formato `AA123456789BR`. O servidor recalcula a taxa e o frete grátis; pedidos antigos "confirmado" aparecem como "Aceito".

## Frete automático da plataforma (um token para todas as lojas)
Defina `ME_TOKEN` no Render (token do **seu** Melhor Envio; `ME_SANDBOX=1` para testes). Com isso, o cálculo PAC/SEDEX funciona em todas as lojas que escolherem "Frete automático" e informarem só o **CEP de origem**, sem token do cliente. Se o cliente conectar a própria conta em Vendas → Integrações, o token dele tem prioridade. O token da plataforma só cota preços; compra de etiquetas e postagem continuam por conta de cada lojista (o preço cotado vem das condições da sua conta).


## Operação: senha, e-mail, termos e alerta de queda

- **Esqueci a senha (cliente):** link na tela de login → `/esqueci` → e-mail com link de 1 hora (`/redefinir`). O link vale uma vez só (assinado, amarrado à senha atual) e um aviso de “senha alterada” é enviado.
- **Esqueci a senha (comprador):** link no modal de login da loja; mesmo princípio (`/buyer/reset`).
- **Confirmação de e-mail:** só ativa quando o e-mail está configurado (`RESEND_API_KEY` + `MAIL_FROM`). Clientes novos precisam confirmar para publicar sites; compradores novos precisam confirmar para finalizar pedidos/agendamentos (login com Google já conta como confirmado). Sem e-mail configurado, nada é bloqueado e “esqueci a senha” avisa que o envio está desligado.
- **Termos de Uso e Política de Privacidade (LGPD):** `/termos` e `/privacidade`; cadastro exige o aceite. Variáveis opcionais: `LEGAL_NAME` (razão social/nome), `LEGAL_DOC` (CNPJ/CPF), `LEGAL_EMAIL` (contato/encarregado). **Os textos são um modelo: peça revisão de um advogado.**
- **Alerta de queda:** `.github/workflows/uptime.yml` consulta `/healthz` a cada 5 minutos; se falhar, o GitHub envia e-mail (mantenha as notificações de Actions ligadas). Mude o endereço pela variável do repositório `UPTIME_URL`.


## Vitrine (catálogo e loja com carrinho)

- **Carrossel “Em destaque”:** mostra os produtos marcados com ⭐ no editor (até 10). Sem nenhum marcado, usa as promoções ou os primeiros disponíveis (precisa de 4+ produtos). Avança sozinho, pausa ao tocar/passar o mouse e respeita “reduzir movimento”.
- **Preço “de/por”:** campo “De R$” no produto mostra o preço antigo riscado e a % de desconto (só exibição; o valor cobrado é sempre o preço atual).
- **Filtros:** busca, categorias com contagem, ordenar (relevância, menor/maior preço, A–Z, só promoções), “só disponíveis”, contador e mensagem de “nada encontrado”.
- **Planilha:** novas colunas “Preço de (riscado)” e “Destaque”. A aba Vendas ainda não edita esses dois campos.


## Página de vendas (produto digital / fundo de funil)

Formato `sales` (planos Essencial, Pro e Premium). Três estilos, com prévia real lado a lado (botão “Comparar os 3 estilos”, que abre sozinho na primeira vez):

- **Carta de vendas:** texto longo e direto, fundo claro, destaque amarelo, botão verde.
- **Vídeo (VSL):** fundo escuro, player do YouTube no centro (carrega só ao clicar, via youtube-nocookie).
- **Moderna:** capa do produto em destaque, cartões de benefícios e visual de lançamento.

Recursos: cronômetro (reinicia para cada visitante, opcional), botão de compra fixo ao rolar, preço de/por com % de economia, parcelamento, garantia, bônus, módulos em sanfona, depoimentos, FAQ e botão final. O botão leva ao link de compra (Hotmart, Kiwify, Eduzz, Mercado Pago…) ou, sem link, ao WhatsApp. Textos de exemplo vêm preenchidos para trocar; depoimentos **não** vêm de exemplo (só os reais do cliente).

### Página de vendas: medição, prévia e conformidade

- **Renderização:** no site publicado a página de vendas abre como documento próprio (não mais dentro de iframe), então `localStorage` (cronômetro, consentimento) e pixels funcionam. A prévia do editor continua em iframe isolado e **não** dispara pixels nem registra visitas.
- **Prévia de link / SEO:** o servidor lê os dados do site e coloca `title`, `description`, `og:*` e `twitter:*` no `<head>` (todos os formatos). A capa em data-URL é servida em `/__og`. O corpo da página ainda é montado no navegador; buscadores que executam JavaScript (Google) indexam, rastreadores simples só veem o `<head>`.
- **Medição:** visitas e cliques próprios (sem cookies) em “Meus sites”; Pixel da Meta, GA4, Google Ads (tag) e TikTok por ID validado, **somente após aceite** do aviso de cookies; `utm_*`, `fbclid`, `gclid`, `ttclid` da visita são repassados ao link de compra. A conversão de compra precisa ser configurada na plataforma do link de compra.
- **Urgência:** cronômetro por visitante ou **prazo fixo** (mostra “Oferta encerrada” ao fim); botão atrasado após o play (estilo Vídeo, YouTube ou Vimeo).
- **Conteúdo:** gerar textos com IA (só a partir da descrição do produto, sem depoimentos nem resultados inventados), editor em linhas (benefícios, módulos, bônus, FAQ, depoimentos), prints/resultados com zoom (campo de galeria), mockup do produto quando não há capa, ordem e visibilidade das seções.
- **Rodapé legal:** razão social, CNPJ/CPF, e-mail, links de Termos e Privacidade do **vendedor**, aviso de resultados (padrão quando há depoimentos/prints) e selo editável. Os modelos `/termos` e `/privacidade` da plataforma são para os clientes do AutoPage, não para a loja do vendedor.
- **Checkout próprio (opcional):** com “Receber pagamento online” ligado e o Mercado Pago do cliente conectado (Pro/Premium), o botão pede nome e e-mail, o servidor cria o pedido com o preço da página (o navegador não define valor) e leva ao Mercado Pago. Quando o webhook confirma o pagamento (status aprovado e valor igual), o comprador recebe o e-mail de acesso e o vendedor é avisado; webhook repetido não reenvia. O link de acesso fica em `sdl/<site>` no servidor, nunca no JSON público do site. Exige `RESEND_API_KEY`; se o e-mail falhar, o aviso ao vendedor diz para enviar à mão. Sem o checkout ligado, vale o link de compra externo. Reembolsos ficam no Mercado Pago.

### Melhorias de vendas e SEO (nov/2026)

- **HTML completo no servidor:** `render.js` roda o mesmo gerador do app num escopo isolado e o servidor entrega a página de vendas pronta (título, `og:*`, h1 e conteúdo no HTML). Se a renderização falhar, cai no modo antigo (montado no navegador).
- **Evento de compra:** a URL de retorno do Mercado Pago aprovado leva `ok=1`; com consentimento, dispara `Purchase` (Meta, GA4, TikTok) uma vez por pedido. Quem abrir a URL à mão também dispara o evento no próprio navegador: use a plataforma de anúncios para conferir com as vendas reais.
- **Recuperação de checkout:** um lembrete por pedido não pago, 2 h a 48 h depois (roda no tick do `/healthz`, a cada ~6 h).
- **Estorno:** o vendedor é avisado por e-mail; o acesso já enviado não é revogado automaticamente.
- **Teste A/B de headline:** campo “Headline alternativa”; metade dos visitantes vê a B (guardado no navegador); visitas e cliques por variante aparecem em “Meus sites”. Sem teste de significância estatística.
- **Meus sites:** páginas de vendas mostram vendas pagas, receita, aguardando, estornos e e-mails de acesso que falharam.
- **Correção:** o botão “Reenviar e-mail de confirmação” chamava por engano a função de restaurar versão (nome duplicado).

## Landing do produto (nov/2026)
`landing.html` apresenta o AutoPage.ai e é servida em `autopageai.kattalo.online` (e `autopage.`) e em `<app>/sobre` (CSP própria, cache 5 min). O domínio raiz `kattalo.online` e `www` ficam reservados para o futuro site da Kattalo (empresa de soluções digitais). Planos e preços vêm de `PLANS` e `config/plans`. Para ativar `autopageai.kattalo.online`, adicione-o como Custom Domain no Render (o wildcard `*.kattalo.online` já cobre, se configurado).
