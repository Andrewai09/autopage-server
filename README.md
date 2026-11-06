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

## Planos (sites e formatos)
| Plano | Sites publicados | Formatos |
|---|---|---|
| Básico (grátis) | 1 | Landing Page, Link na bio, Cartão de visita, Perfil profissional |
| Essencial | 5 | todos |
| Pro | 15 | todos |
| Premium | 50 | todos |
O bloqueio de formato é feito no servidor (`403 format`) e, na tela, os formatos pagos aparecem com 🔒. Sites já publicados em outro formato continuam funcionando. Limite por cliente continua ajustável na aba Clientes. Para mudar a lista de formatos grátis, edite `FREE_FMTS` em `server.js`.
