import type { Lang } from "@/lib/i18n";

export const INFORMATION_SECTIONS = [
  "aplicativos",
  "aviso-legal",
  "termos-de-uso",
  "termos-de-venda",
  "privacidade",
  "cookies",
  "contacto",
] as const;

export type InformationSection = (typeof INFORMATION_SECTIONS)[number];

export interface InformationPageContent {
  title: string;
  introduction: string;
  sections: Array<{
    heading: string;
    paragraphs: string[];
    bullets?: string[];
  }>;
}

export function isInformationSection(value: string): value is InformationSection {
  return INFORMATION_SECTIONS.includes(value as InformationSection);
}

export const informationContent: Record<InformationSection, Record<Lang, InformationPageContent>> = {
  aplicativos: {
    pt: {
      title: "Aplicativos para dispositivos móveis",
      introduction: "O FilaZero pode ser utilizado no browser de telemóveis, tablets e computadores.",
      sections: [
        {
          heading: "Estado atual",
          paragraphs: [
            "Atualmente não existem aplicações nativas FilaZero publicadas na App Store (iOS) ou Google Play (Android). Desconfie de aplicações de terceiros que usem o nosso nome.",
            "A versão web permite consultar filas, emitir senhas e acompanhar o estado do atendimento através da conta FilaZero.",
          ],
        },
        {
          heading: "Atualizações e notificações",
          paragraphs: [
            "Enquanto a página da fila está aberta, o estado pode ser atualizado em tempo real pelo browser. As notificações são apresentadas dentro da experiência web.",
            "Notificações push nativas para iOS ou Android ainda não estão disponíveis. A eventual publicação de aplicações será anunciada nesta plataforma.",
          ],
        },
      ],
    },
    en: {
      title: "Mobile applications",
      introduction: "FilaZero is available in a browser on phones, tablets and computers.",
      sections: [
        {
          heading: "Current status",
          paragraphs: [
            "There are currently no native FilaZero apps published on the App Store (iOS) or Google Play (Android). Be cautious of third-party apps using our name.",
            "The web version lets you browse queues, take tickets and follow service status with a FilaZero account.",
          ],
        },
        {
          heading: "Updates and notifications",
          paragraphs: [
            "While a queue page is open, its status can update in real time in the browser. Notifications appear inside the web experience.",
            "Native push notifications for iOS or Android are not available yet. Any future app release will be announced on this platform.",
          ],
        },
      ],
    },
  },
  "aviso-legal": {
    pt: {
      title: "Aviso legal e créditos",
      introduction: "Informação sobre a plataforma, os seus conteúdos e os respetivos direitos.",
      sections: [
        {
          heading: "Titularidade e propriedade intelectual",
          paragraphs: [
            "FilaZero é o nome comercial da plataforma de gestão de filas aqui apresentada. O software, a marca, a identidade visual, a documentação e os conteúdos próprios pertencem ao respetivo titular dos direitos, salvo indicação expressa em contrário.",
            "A entidade jurídica operadora, número de registo e morada oficial não estão publicados nesta versão. Estes dados devem ser confirmados e incluídos pela entidade responsável antes da utilização deste aviso como documento contratual.",
          ],
        },
        {
          heading: "Utilização de conteúdos",
          paragraphs: [
            "Não é permitida a cópia, modificação, distribuição ou utilização comercial dos elementos próprios do FilaZero sem autorização prévia, exceto quando a lei ou uma licença aplicável o permita.",
            "Bibliotecas e componentes de terceiros mantêm os respetivos autores e licenças. Os avisos de licença aplicáveis acompanham os pacotes distribuídos pelo projeto.",
          ],
        },
      ],
    },
    en: {
      title: "Legal notice and credits",
      introduction: "Information about the platform, its content and the related rights.",
      sections: [
        {
          heading: "Ownership and intellectual property",
          paragraphs: [
            "FilaZero is the product name of the queue-management platform presented here. The software, brand, visual identity, documentation and original content belong to their respective rights holder unless stated otherwise.",
            "The legal operating entity, registration number and official address are not published in this version. The responsible entity must verify and add these details before using this notice as a contractual document.",
          ],
        },
        {
          heading: "Use of content",
          paragraphs: [
            "Copying, modifying, distributing or commercially using FilaZero-owned materials requires prior permission unless permitted by law or an applicable license.",
            "Third-party libraries and components retain their respective authors and licenses. Applicable license notices accompany packages distributed by the project.",
          ],
        },
      ],
    },
  },
  "termos-de-uso": {
    pt: {
      title: "Termos de uso",
      introduction: "Regras gerais para empresas que operam filas e cidadãos que emitem senhas.",
      sections: [
        {
          heading: "Utilização por organizações",
          paragraphs: [
            "A organização é responsável pela exatidão dos dados de registo, pela gestão das contas da sua equipa e pela configuração das suas filiais e filas.",
            "Os gestores devem atribuir acessos apenas a pessoas autorizadas, manter as credenciais seguras e utilizar os dados de clientes apenas para prestar o atendimento solicitado.",
          ],
        },
        {
          heading: "Utilização por cidadãos",
          paragraphs: [
            "Ao emitir uma senha, o cidadão deve fornecer dados corretos e utilizar a fila de acordo com as instruções da organização. A senha representa uma posição/solicitação de atendimento, não uma garantia de hora exata ou de resultado do serviço.",
            "O cidadão deve proteger as credenciais e não tentar interferir nas filas, contas, disponibilidade ou dados de outras pessoas.",
          ],
        },
        {
          heading: "Utilização aceitável e disponibilidade",
          paragraphs: [
            "É proibido utilizar o serviço para fraude, abuso, automatização não autorizada, acesso a dados de terceiros ou qualquer atividade ilícita. O acesso pode ser suspenso perante abuso ou risco de segurança.",
            "O FilaZero procura manter o serviço disponível, mas podem ocorrer interrupções por manutenção, falhas de rede ou dependências externas. As organizações continuam responsáveis pelo atendimento presencial.",
          ],
        },
      ],
    },
    en: {
      title: "Terms of use",
      introduction: "General rules for organizations operating queues and people taking tickets.",
      sections: [
        {
          heading: "Use by organizations",
          paragraphs: [
            "An organization is responsible for accurate registration details, managing team accounts and configuring its branches and queues.",
            "Managers should grant access only to authorized people, protect credentials and use customer data only to provide the requested service.",
          ],
        },
        {
          heading: "Use by customers",
          paragraphs: [
            "When taking a ticket, customers should provide accurate details and follow the organization's instructions. A ticket represents a place/request for service, not a guarantee of an exact time or service outcome.",
            "Customers must protect their credentials and must not interfere with queues, accounts, availability or other people's data.",
          ],
        },
        {
          heading: "Acceptable use and availability",
          paragraphs: [
            "Fraud, abuse, unauthorized automation, access to another party's data and unlawful activity are prohibited. Access may be suspended in response to abuse or a security risk.",
            "FilaZero aims to keep the service available, but maintenance, network failures and external dependencies may cause interruptions. Organizations remain responsible for in-person service.",
          ],
        },
      ],
    },
  },
  "termos-de-venda": {
    pt: {
      title: "Termos de venda",
      introduction: "Condições informativas para subscrições dos serviços FilaZero por organizações.",
      sections: [
        {
          heading: "Planos e preços",
          paragraphs: [
            "Os planos são contratados por organização. O preço, moeda, periodicidade e limites aplicáveis são os apresentados no catálogo ou na proposta aceite no momento da contratação.",
            "Os limites podem incluir número de filiais, filas por filial e membros de equipa. A organização deve confirmar que o plano escolhido corresponde à sua operação.",
          ],
        },
        {
          heading: "Trial, pagamentos e ativação",
          paragraphs: [
            "Quando disponibilizado, o período trial e as suas datas dependem do plano e da configuração apresentados à organização. A criação de uma transação de checkout não significa que o pagamento foi concluído.",
            "Um pagamento só é confirmado após validação do provider de pagamento. A subscrição e as funcionalidades faturáveis dependem do estado e período apresentados no painel de gestão.",
          ],
        },
        {
          heading: "Alterações e cancelamento",
          paragraphs: [
            "As condições de renovação, cancelamento, reembolso e impostos devem constar da proposta ou contrato aplicável ao plano. Como esses termos comerciais não estão publicados nesta versão, solicite confirmação escrita ao suporte antes de contratar.",
          ],
        },
      ],
    },
    en: {
      title: "Terms of sale",
      introduction: "Informational conditions for organizations subscribing to FilaZero services.",
      sections: [
        {
          heading: "Plans and pricing",
          paragraphs: [
            "Plans are purchased per organization. The applicable price, currency, billing interval and limits are those shown in the catalog or accepted proposal at purchase time.",
            "Limits may include branches, queues per branch and team members. Organizations should confirm that the selected plan fits their operation.",
          ],
        },
        {
          heading: "Trial, payments and activation",
          paragraphs: [
            "When offered, trial duration and dates depend on the plan and configuration presented to the organization. Creating a checkout transaction does not mean payment has completed.",
            "A payment is confirmed only after validation by the payment provider. Subscription status and billable features depend on the state and period shown in the manager dashboard.",
          ],
        },
        {
          heading: "Changes and cancellation",
          paragraphs: [
            "Renewal, cancellation, refund and tax conditions should be stated in the applicable proposal or plan contract. Since these commercial terms are not published in this version, request written confirmation from support before purchase.",
          ],
        },
      ],
    },
  },
  privacidade: {
    pt: {
      title: "Política de privacidade",
      introduction: "Como o FilaZero utiliza e protege os dados necessários para gerir filas.",
      sections: [
        {
          heading: "Dados tratados e finalidades",
          paragraphs: [
            "Podem ser tratados dados de conta (nome, email, telefone e credenciais protegidas), dados da organização/filial, dados necessários à senha e ao atendimento, documentos enviados no auto-registo e registos técnicos de segurança.",
            "Os dados são utilizados para autenticar utilizadores, emitir e acompanhar senhas, permitir a operação das filas, gerir subscrições e proteger o serviço contra abuso.",
          ],
        },
        {
          heading: "Segurança e isolamento",
          paragraphs: [
            "As passwords são armazenadas com bcrypt. Os tokens de sessão são opacos; a base de dados guarda um HMAC-SHA-256 do token, não o valor utilizável. O cookie de sessão é HttpOnly e usa SameSite=Lax; em produção também é Secure.",
            "Os documentos de registo são privados. O sistema armazena os bytes e um digest SHA-256 para verificação de integridade. SHA-256 é um hash, não encriptação, e não comprova por si só a autenticidade jurídica do documento.",
            "O acesso operacional é limitado por organização e filial através de autenticação e autorização no servidor. O Super Admin recebe métricas agregadas da plataforma, não históricos ou dados operacionais internos das organizações.",
          ],
        },
        {
          heading: "Conservação e pedidos",
          paragraphs: [
            "Os dados são conservados enquanto necessários à prestação do serviço, segurança, faturação e cumprimento de obrigações aplicáveis. Os prazos concretos e a entidade legal responsável pelo tratamento devem ser confirmados pelo operador oficial do serviço.",
            "Para pedidos de acesso, correção ou eliminação de dados, contacte suporte@filazero.ao e indique a conta/organização relacionada. Não envie passwords ou tokens por email.",
          ],
        },
      ],
    },
    en: {
      title: "Privacy policy",
      introduction: "How FilaZero uses and protects data needed to manage queues.",
      sections: [
        {
          heading: "Data processed and purposes",
          paragraphs: [
            "We may process account data (name, email, phone and protected credentials), organization/branch details, data needed for tickets and service, documents submitted during self-registration and technical security records.",
            "Data is used to authenticate users, issue and follow tickets, operate queues, manage subscriptions and protect the service from abuse.",
          ],
        },
        {
          heading: "Security and isolation",
          paragraphs: [
            "Passwords are stored with bcrypt. Session tokens are opaque; the database stores an HMAC-SHA-256 digest of each token, not the usable token itself. The session cookie is HttpOnly and SameSite=Lax; it is also Secure in production.",
            "Registration documents are private. The system stores file bytes and a SHA-256 digest for integrity checks. SHA-256 is a hash, not encryption, and does not by itself prove a document's legal authenticity.",
            "Operational access is scoped by organization and branch using server-side authentication and authorization. The platform Super Admin receives aggregated metrics, not organizations' internal histories or operational data.",
          ],
        },
        {
          heading: "Retention and requests",
          paragraphs: [
            "Data is retained as needed to provide the service, maintain security, handle billing and meet applicable obligations. Specific retention periods and the legal data controller should be confirmed by the official service operator.",
            "For access, correction or deletion requests, contact suporte@filazero.ao and identify the related account/organization. Do not send passwords or tokens by email.",
          ],
        },
      ],
    },
  },
  cookies: {
    pt: {
      title: "Cookies",
      introduction: "O FilaZero utiliza cookies estritamente necessários para sessão e preferências essenciais.",
      sections: [
        {
          heading: "Autenticação e sessão",
          paragraphs: [
            "O cookie filazero_session contém um token de sessão opaco, é HttpOnly, usa SameSite=Lax e expira de acordo com a configuração da sessão. Em produção recebe também o atributo Secure. Não é um JWT e não é acessível por JavaScript da página.",
          ],
        },
        {
          heading: "Preferências",
          paragraphs: [
            "Os cookies filazero_lang e filazero_theme guardam, respetivamente, o idioma e o tema escolhidos para manter a experiência entre visitas. As mesmas preferências podem também ser guardadas em localStorage.",
            "Esta versão não utiliza cookies publicitários ou de perfilagem. Os cookies essenciais não podem ser desativados sem afetar autenticação ou preferências selecionadas.",
          ],
        },
      ],
    },
    en: {
      title: "Cookies",
      introduction: "FilaZero uses cookies strictly needed for sessions and essential preferences.",
      sections: [
        {
          heading: "Authentication and session",
          paragraphs: [
            "The filazero_session cookie contains an opaque session token, is HttpOnly, uses SameSite=Lax and expires according to session configuration. In production it also has the Secure attribute. It is not a JWT and is not accessible to page JavaScript.",
          ],
        },
        {
          heading: "Preferences",
          paragraphs: [
            "The filazero_lang and filazero_theme cookies store the selected language and theme so they persist between visits. These preferences may also be stored in localStorage.",
            "This version does not use advertising or profiling cookies. Essential cookies cannot be disabled without affecting authentication or selected preferences.",
          ],
        },
      ],
    },
  },
  contacto: {
    pt: {
      title: "Contato",
      introduction: "A equipa FilaZero está disponível para pedidos de suporte e informação sobre a plataforma.",
      sections: [
        {
          heading: "Suporte oficial",
          paragraphs: [
            "Para ajuda com a conta, emissão de senhas, gestão de filas, subscrições, privacidade ou documentos de registo, escreva para o endereço oficial abaixo.",
            "Não inclua passwords, tokens de sessão, dados de pagamento completos ou documentos sensíveis no email. Para pedidos de privacidade, indique apenas os dados necessários para identificar a conta ou organização.",
          ],
        },
      ],
    },
    en: {
      title: "Contact",
      introduction: "The FilaZero team is available for support requests and platform information.",
      sections: [
        {
          heading: "Official support",
          paragraphs: [
            "For help with accounts, tickets, queue management, subscriptions, privacy or registration documents, write to the official address below.",
            "Do not include passwords, session tokens, full payment details or sensitive documents in email. For privacy requests, provide only the information needed to identify the account or organization.",
          ],
        },
      ],
    },
  },
};
