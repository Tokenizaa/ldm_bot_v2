import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(filePath: string) {
  if (!fs.existsSync(filePath)) throw new Error(`Arquivo .env não encontrado: ${filePath}`);
  const text = fs.readFileSync(filePath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  process.env.FACEBOOK_HEADLESS = 'false';

  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FACEBOOK_GROUP_URL'];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Variáveis ausentes no .env: ${missing.join(', ')}`);

  console.log('SUPABASE_URL: configurada');
  console.log('SUPABASE_SERVICE_ROLE_KEY: configurada');
  console.log(`FACEBOOK_GROUP_URL: ${process.env.FACEBOOK_GROUP_URL}`);
  console.log('FACEBOOK_HEADLESS: false');

  const { facebookService } = await import('../server/services/FacebookService.ts');
  console.log('Conectando ao Facebook com o perfil persistente...');

  const result = await facebookService.connectSession();
  console.log('Resultado:', JSON.stringify(result, null, 2));

  if (!result.success) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\n❌ TESTE FALHOU');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
