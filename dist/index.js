"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hikaxpro_1 = require("./hikaxpro");
const HOST = process.env.HIKAXPRO_HOST || '192.168.1.120';
const USERNAME = process.env.HIKAXPRO_USERNAME || 'admin';
const PASSWORD = process.env.HIKAXPRO_PASSWORD || 'password';
const USER_LEVEL = Number(process.env.HIKAXPRO_USER_LEVEL) || 1;
async function main() {
    const axpro = new hikaxpro_1.HikAxPro({
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
    }
    catch (err) {
        globalThis.console.error('Error:', err.message);
    }
}
if (require.main === module) {
    main();
}
