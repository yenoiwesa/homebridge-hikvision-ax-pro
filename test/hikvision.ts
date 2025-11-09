import { HikAxPro } from '../src/hikaxpro';

const HOST = process.env.HIKAXPRO_HOST || '192.168.1.120';
const USERNAME = process.env.HIKAXPRO_USERNAME || 'admin';
const PASSWORD = process.env.HIKAXPRO_PASSWORD || 'password';
const USER_LEVEL = Number(process.env.HIKAXPRO_USER_LEVEL) || 1;

async function testArmDisarm(): Promise<void> {
  const axpro = new HikAxPro({
    host: HOST,
    username: USERNAME,
    password: PASSWORD,
    userLevel: USER_LEVEL,
  });
  try {
    // First request will trigger automatic login via sendRequest.
    console.log('Attempting automatic login on first request...');
    const subsystems = await axpro.fetchSubsystemStatuses();
    subsystems.forEach((s) => {
      console.log(`Subsystem ${s.id} (${s.name}): ${s.arming}`);
    });

    // Arm stay first
    try {
      const armResult = await axpro.armStay(1);
      console.log('Arm stay result:', JSON.stringify(armResult));
    } catch (e) {
      const error = e as Error;
      console.warn('Arm stay attempt failed:', error.message);
    }

    // Check status after arming
    const subsystemsAfterArm = await axpro.fetchSubsystemStatuses();
    subsystemsAfterArm.forEach((s) => {
      console.log(`After arm - Subsystem ${s.id} (${s.name}): ${s.arming}`);
    });

    // Always disarm regardless of current state
    try {
      const disarmResult = await axpro.disarm(1);
      console.log('Disarm result:', JSON.stringify(disarmResult));
    } catch (e) {
      const error = e as Error;
      console.warn('Disarm attempt failed:', error.message);
    }

    for (let i = 0; i < 60; i++) {
      const zones = await axpro.fetchZoneStatuses();
      const triggered = zones.filter((z) => z.status === 'trigger');
      if (triggered.length > 0) {
        triggered.forEach((z) => {
          console.log(`${z.name} triggered (time: ${new Date().toISOString()})`);
        });
      }
      if (i < 59) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } catch (err) {
    const error = err as Error;
    console.error('Error:', error.message);
  }
}

if (require.main === module) {
  testArmDisarm();
}
