
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- Debugging Notifications ---');

    // 1. Check Rules
    const rules = await prisma.notificationRule.findMany({
        where: { event: 'SR_CREATED' },
        include: { template: true }
    });
    console.log(`Found ${rules.length} rules for SR_CREATED:`);
    rules.forEach(r => {
        console.log(`- ID: ${r.id}, Enabled: ${r.isEnabled}, Channels: ${r.channels}, Template: ${r.template ? 'Found' : 'MISSING'}`);
        console.log(`  Recipients: ${r.recipientTypes} / ${r.specificRecipientIds}`);
    });

    // 2. Check Integration Config
    const emailConfig = await prisma.integrationConfig.findUnique({
        where: { type: 'EMAIL' }
    });
    console.log('\nEmail Config:', emailConfig ? (emailConfig.isEnabled ? 'ENABLED' : 'DISABLED') : 'MISSING');
    if (emailConfig) {
        console.log(`  Host: ${emailConfig.host}, Port: ${emailConfig.port}, User: ${emailConfig.username}`);
    }

    // 3. Check Recent Logs (last 5)
    const logs = await prisma.notificationLog.findMany({
        orderBy: { sentAt: 'desc' },
        take: 5
    });
    console.log('\nLast 5 Notification Logs:');
    logs.forEach(l => {
        console.log(`- [${l.status}] ${l.type} to ${l.recipient} (Reason: ${l.triggerReason}) at ${l.sentAt}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
