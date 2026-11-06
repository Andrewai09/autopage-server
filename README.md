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
