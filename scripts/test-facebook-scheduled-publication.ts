import 'dotenv/config';

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_SECRET',
  'FACEBOOK_GROUP_URL',
  'FACEBOOK_HEADLESS',
  'FACEBOOK_BROWSER_CHANNEL',
  'APP_URL',
] as const;

for (const name of REQUIRED_ENV) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Variável obrigatória ausente no .env: ${name}`);
  }
}

process.env.FACEBOOK_HEADLESS = 'false';

const { facebookService } = await import('../server/services/FacebookService.ts');

const affiliateUrl = 'https://www.lojadomecanico.com.br/produto/621944/98/1045/maquina-de-solda-inversora-multiprocesso-mig-0-sem-gas-120a-bivolt-com-mascara-de-solda-optiarc-70-boxer-99086/20889';
const groupUrl = process.env.FACEBOOK_GROUP_URL!;

const scheduled = new Date(Date.now() + 20 * 60 * 1000);
const pad = (value: number) => String(value).padStart(2, '0');
const scheduledDate = `${scheduled.getFullYear()}-${pad(scheduled.getMonth() + 1)}-${pad(scheduled.getDate())}`;
const scheduledTime = `${pad(scheduled.getHours())}:${pad(scheduled.getMinutes())}`;

const content = `TESTE REAL FORGEDEALS V2\n\nMáquina de Solda Inversora Multiprocesso MIG 0 Sem Gás 120A Bivolt — Boxer 99086.\n\nLink de teste afiliado: ${affiliateUrl}`;

console.log('=== TESTE REAL FACEBOOK ===');
console.log(`Grupo: ${groupUrl}`);
console.log(`Agendamento: ${scheduledDate} ${scheduledTime}`);
console.log(`Canal: ${process.env.FACEBOOK_BROWSER_CHANNEL}`);
console.log('Headless: false');

try {
  const session = await facebookService.connectSession();
  console.log('\nSESSÃO:', session);
  if (!session.success) process.exitCode = 1;
  else {
    const result = await facebookService.publishScheduledPublication({
      groupUrl,
      content,
      affiliateUrl,
      scheduledDate,
      scheduledTime,
    });

    console.log('\nAGENDAMENTO:', result);
    if (!result.success) process.exitCode = 1;
    else console.log('\n✅ Publicação agendada. Confirme no próprio Facebook em Publicações programadas.');
  }
} catch (error) {
  console.error('\n❌ TESTE FALHOU:', error);
  process.exitCode = 1;
}
