import { HikAxPro } from './hikaxpro';

const HOST = process.env.HIKAXPRO_HOST || '192.168.1.120';
const USERNAME = process.env.HIKAXPRO_USERNAME || 'admin';
const PASSWORD = process.env.HIKAXPRO_PASSWORD || 'password';
const USER_LEVEL = Number(process.env.HIKAXPRO_USER_LEVEL) || 1;

async function main() {
  const axpro = new HikAxPro({
    host: HOST,
    username: USERNAME,
    password: PASSWORD,
    userLevel: USER_LEVEL,
  });
  try {
    await axpro.login();
    globalThis.console.log('Login successful!');
    const statuses = await axpro.isArmed();
    statuses.forEach((s) => {
      globalThis.console.log(`Subsystem ${s.id} (${s.name}): ${s.arming}`);
    });
  } catch (err: any) {
    globalThis.console.error('Error:', err.message);
  }
}

if (require.main === module) {
  main();
}
